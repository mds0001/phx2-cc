import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import type { IvantiConfig } from "@/lib/types";

// ── Types ────────────────────────────────────────────────────────────
export interface AutoMapRequest {
  connectionId: string;
  boName: string;
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
}

// ── Fetch BO field list from Ivanti $metadata ──────────────────────
async function fetchBoFields(
  base: string,
  boName: string,
  authHeaders: Record<string, string>
): Promise<string[]> {
  const boLower = boName.toLowerCase();
  const boHash  = boLower.replace(/__/g, "%23").replace(/#/g, "%23");

  const attempts = [
    base + "/api/odata/businessobject/" + boName + "/$metadata",
    base + "/api/odata/businessobject/" + boLower + "/$metadata",
    base + "/api/odata/businessobject/" + boHash + "/$metadata",
  ];

  for (const url of attempts) {
    try {
      const res = await fetch(url, {
        headers: { ...authHeaders, Accept: "application/xml,text/xml,*/*" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<Property")) continue;
      const propRegex = /<Property\s[^>]*\bName="([^"]+)"/g;
      const names: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = propRegex.exec(xml)) !== null) names.push(m[1]);
      if (names.length > 0) return names;
    } catch { continue; }
  }
  return [];
}

// ── POST /api/auto-map ───────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json() as AutoMapRequest;
    const { connectionId, boName, sourceColumns, sampleRows } = body;

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
      ...(cfg.api_key ? { Authorization: "Bearer " + cfg.api_key } : {}),
      ...(cfg.tenant_id ? { "X-Tenant-Id": cfg.tenant_id } : {}),
    };

    // Fetch target BO fields from Ivanti
    const targetFields = await fetchBoFields(base, boName, authHeaders);

    // Call Claude Haiku for mapping suggestions
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

    const samplePreview = sampleRows.slice(0, 3).map((row, i) => {
      const preview = sourceColumns.slice(0, 10)
        .map(col => col + ": " + JSON.stringify(row[col] ?? ""))
        .join(", ");
      return "Row " + (i + 1) + ": { " + preview + " }";
    }).join("
");

    const prompt = "You are a data mapping expert. A user has an Excel file they want to import into a business system (Ivanti).

" +
      "SOURCE FILE COLUMNS (" + sourceColumns.length + " total):
" +
      sourceColumns.join(", ") + "

" +
      "SAMPLE DATA (first few rows):
" +
      samplePreview + "

" +
      "TARGET SYSTEM FIELDS for BO "" + boName + "" (" + targetFields.length + " total):
" +
      targetFields.join(", ") + "

" +
      "Your job: suggest the best mapping from each source column to a target field.

" +
      "Rules:
" +
      "- Match by semantic meaning, not just exact name (e.g. AssetName -> Name, AssignedUser -> Owner)
" +
      "- Only suggest a target field if you are reasonably confident
" +
      "- Each target field can only be used once
" +
      "- Use confidence: high (obvious match), medium (likely match), low (possible match)
" +
      "- If no good target match exists for a source column, omit it

" +
      "Respond with ONLY valid JSON in this exact format:
" +
      "{
" +
      "  \"suggestions\": [
" +
      "    { \"sourceField\": \"SourceColumnName\", \"targetField\": \"TargetFieldName\", \"confidence\": \"high\", \"reason\": \"Brief reason\" }
" +
      "  ]
" +
      "}";

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
    };

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
