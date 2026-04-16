import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import type { IvantiConfig } from "@/lib/types";

// Types
export interface AutoMapRequest {
  connectionId: string;
  boName: string;
  boUrl?: string;
  sourceColumns: string[];
  sampleRows: Record<string, unknown>[];
}

export interface MappingSuggestion {
  sourceField: string;
  targetField: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface AutoMapResponse {
  suggestions: MappingSuggestion[];
  targetFields: string[];
  unmappedSource: string[];
  unmappedTarget: string[];
  warning?: string;
}

// Fetch BO field list from Ivanti — tries OData $metadata (per-BO and global) then REST schema
async function fetchBoFields(
  base: string,
  boName: string,
  authHeaders: Record<string, string>,
  boUrl?: string
): Promise<{ fields: string[]; log: string[] }> {
  const attemptLog: string[] = [];
  const boLower = boName.toLowerCase();
  const boHash  = boLower.replace(/__/g, "%23");

  // Strategy A: OData $metadata
  // NOTE: metadata URLs do NOT use /businessobject/ — that prefix is only for data queries.
  // Metadata: /api/odata/{boName}/$metadata  or  /api/odata/$metadata (global)
  // Data:     /api/odata/businessobject/{boName}
  const metaAttempts: Array<{ url: string; perBo: boolean }> = [
    { url: base + "/api/odata/" + boName + "/$metadata",  perBo: true  },
    { url: base + "/api/odata/" + boLower + "/$metadata", perBo: true  },
    { url: base + "/api/odata/" + boHash + "/$metadata",  perBo: true  },
    { url: base + "/api/odata/$metadata",                 perBo: false },
  ];

  for (const { url, perBo } of metaAttempts) {
    try {
      const res = await fetch(url, { headers: { ...authHeaders, Accept: "application/xml,text/xml,*/*" } });
      attemptLog.push(url + " -> HTTP " + res.status);
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<Property")) { attemptLog.push(url + " -> no <Property> elements"); continue; }

      let searchXml = xml;
      if (!perBo) {
        const candidates = [boName, boName.replace(/__/g, "_"), boName.replace(/.*__/, ""), boLower];
        let found = false;
        for (const c of candidates) {
          const start = xml.indexOf("<EntityType Name=\"" + c + "\"");
          if (start === -1) continue;
          const end = xml.indexOf("</EntityType>", start);
          if (end === -1) continue;
          searchXml = xml.slice(start, end + "</EntityType>".length);
          found = true;
          break;
        }
        if (!found) { attemptLog.push(url + " -> no EntityType matched " + boName); continue; }
      }

      const propRegex = /<Property\s[^>]*\bName="([^"]+)"/g;
      const names: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = propRegex.exec(searchXml)) !== null) names.push(m[1]);
      if (names.length > 0) return { fields: names, log: attemptLog };
    } catch (e) { attemptLog.push(url + " -> error: " + String(e)); continue; }
  }

  // Strategy B: REST schema endpoint
  for (const name of [boName, boLower]) {
    const schemaUrl = base + "/api/rest/businessobject/" + name + "/schema";
    try {
      const res = await fetch(schemaUrl, { headers: { ...authHeaders, Accept: "application/json" } });
      attemptLog.push(schemaUrl + " -> HTTP " + res.status);
      if (!res.ok) continue;
      const schema = await res.json() as Record<string, unknown>;
      const fields = (schema.Fields ?? schema.fields ?? schema.Properties ?? schema.properties) as unknown;
      if (Array.isArray(fields)) {
        const names = fields
          .map((f) => (f as Record<string, unknown>).Name ?? (f as Record<string, unknown>).name)
          .filter((n): n is string => typeof n === "string" && n.length > 0);
        if (names.length > 0) return { fields: names, log: attemptLog };
      }
    } catch (e) { attemptLog.push(schemaUrl + " -> error: " + String(e)); continue; }
  }

  // Strategy C: fetch a sample record and infer fields from JSON keys
  const samplePaths = boUrl
    ? [boUrl, "businessobject/" + boName, "businessobject/" + boName + "s", "businessobject/" + boLower, "businessobject/" + boLower + "s"]
    : ["businessobject/" + boName, "businessobject/" + boName + "s", "businessobject/" + boLower, "businessobject/" + boLower + "s", "businessobject/" + boHash];
  for (const path of samplePaths) {
    const sampleUrl = base + "/api/odata/" + path.replace(/^\//, "") + "?$top=1";
    try {
      const res = await fetch(sampleUrl, { headers: { ...authHeaders, Accept: "application/json" } });
      attemptLog.push(sampleUrl + " -> HTTP " + res.status);
      if (!res.ok) continue;
      const json = await res.json() as { value?: Record<string, unknown>[] };
      const rows = json.value ?? [];
      if (rows.length > 0) {
        const names = Object.keys(rows[0]).filter((k) => !k.startsWith("@"));
        if (names.length > 0) return { fields: names, log: attemptLog };
      }
    } catch (e) { attemptLog.push(sampleUrl + " -> error: " + String(e)); continue; }
  }

  return { fields: [], log: attemptLog };
}

// POST /api/auto-map
export async function POST(req: Request) {
  try {
    const body = await req.json() as AutoMapRequest;
    const { connectionId, boName, boUrl, sourceColumns, sampleRows } = body;

    // Get Ivanti connection credentials
    const supabase = await createClient();
    const { data: conn } = await supabase
      .from("endpoint_connections")
      .select("*")
      .eq("id", connectionId)
      .single();

    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    const cfg = conn.config as IvantiConfig;
    const base = (cfg.url ?? "").replace(/\/+$/, "");
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(cfg.api_key ? { Authorization: "rest_api_key=" + cfg.api_key } : {}),
      ...(cfg.tenant_id ? { "X-Tenant-Id": cfg.tenant_id } : {}),
    };

    // Fetch target BO fields from Ivanti
    const { fields: targetFields, log: fetchLog } = await fetchBoFields(base, boName, authHeaders, boUrl);
    const targetFieldsKnown = targetFields.length > 0;

    // Call Claude Haiku for mapping suggestions
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

    const samplePreview = sampleRows.slice(0, 3).map((row, i) => {
      const preview = sourceColumns.slice(0, 10)
        .map(col => col + ": " + JSON.stringify(row[col] ?? ""))
        .join(", ");
      return "Row " + (i + 1) + ": { " + preview + " }";
    }).join("\n");

    const prompt =
      "You are a data mapping expert. A user has an Excel file they want to import into a business system (Ivanti)." +
      "\n\n" +
      "SOURCE FILE COLUMNS (" + sourceColumns.length + " total):" +
      "\n" +
      sourceColumns.join(", ") +
      "\n\n" +
      "SAMPLE DATA (first few rows):" +
      "\n" +
      samplePreview +
      "\n\n" +
      (targetFieldsKnown
        ? "TARGET SYSTEM FIELDS for BO \"" + boName + "\" (" + targetFields.length + " total):\n" + targetFields.join(", ")
        : "TARGET SYSTEM: Ivanti BO \"" + boName + "\". You do NOT have the live field list. Use your knowledge of Ivanti \"" + boName + "\" fields to suggest mappings.") +
      "\n\n" +
      "Your job: suggest the best mapping from each source column to a target field." +
      "\n\n" +
      "Rules:" +
      "\n" +
      "- Match by semantic meaning, not just exact name (e.g. AssetName -> Name, AssignedUser -> Owner)" +
      "\n" +
      "- Only suggest a target field if you are reasonably confident" +
      "\n" +
      "- Each target field can only be used once" +
      "\n" +
      "- Use confidence: high (obvious), medium (likely), low (possible)" +
      "\n" +
      "- If no good target match exists for a source column, omit it" +
      "\n\n" +
      "Respond with ONLY valid JSON: { \"suggestions\": [ { \"sourceField\": \"ColName\", \"targetField\": \"FieldName\", \"confidence\": \"high\", \"reason\": \"why\" } ] }";

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return NextResponse.json({ error: "Claude API error: " + errText.slice(0, 200) }, { status: 500 });
    }

    const claudeJson = await claudeRes.json() as { content: { type: string; text: string }[] };
    const text = claudeJson.content?.[0]?.type === "text" ? claudeJson.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: "Claude returned no JSON" }, { status: 500 });

    const { suggestions } = JSON.parse(jsonMatch[0]) as { suggestions: MappingSuggestion[] };

    const mappedSources = new Set(suggestions.map(s => s.sourceField));
    const mappedTargets = new Set(suggestions.map(s => s.targetField));

    const result: AutoMapResponse = {
      suggestions,
      targetFields,
      unmappedSource: sourceColumns.filter(c => !mappedSources.has(c)),
      unmappedTarget: targetFields.filter(f => !mappedTargets.has(f)),
      ...(!targetFieldsKnown ? { warning: "Could not retrieve the live field list for \"" + boName + "\" from Ivanti. Suggestions are based on Claude" + String.fromCharCode(39) + "s general knowledge of Ivanti fields — review carefully before applying." } : {}),
    };

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
