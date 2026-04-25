import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import type { IvantiConfig } from "@/lib/types";

function odataEscape(val: string): string {
  return val.replace(/'/g, "''");
}

// Best-effort: register a new subtype in Ivanti's ivnt_AssetSubtype BO.
// Checks if it already exists first, then POSTs if not.
// Never throws — always returns 200 so the caller can fire-and-forget.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { customer_id, parent_type, subtype } = (await req.json()) as {
      customer_id?: string | null;
      parent_type?: string;
      subtype?: string;
    };

    if (!customer_id || !parent_type?.trim() || !subtype?.trim()) {
      return NextResponse.json({ ok: false, reason: "missing fields" });
    }

    const admin = createAdminClient();
    const { data: conns } = await admin
      .from("endpoint_connections")
      .select("id, name, config")
      .eq("customer_id", customer_id)
      .eq("type", "ivanti");

    if (!conns?.length) {
      return NextResponse.json({ ok: true, written: 0, reason: "no ivanti connections for customer" });
    }

    const written: string[] = [];
    const skipped: string[] = [];
    const errors: { connection: string; error: string }[] = [];

    for (const c of conns) {
      const cfg = c.config as IvantiConfig;
      if (!cfg?.url || !cfg?.api_key) continue;

      const base = cfg.url.replace(/\/$/, "");
      const headers = {
        "Authorization": `rest_api_key=${cfg.api_key}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      };

      try {
        // Check if subtype already exists
        const checkUrl = `${base}/api/odata/businessobject/ivnt_AssetSubtype?$filter=ivnt_ParentAssetType eq '${odataEscape(parent_type.trim())}' and ivnt_SubType eq '${odataEscape(subtype.trim())}'&$top=1&$select=RecId`;
        const checkRes = await fetch(checkUrl, { headers, signal: AbortSignal.timeout(8000) });
        if (checkRes.ok) {
          const checkJson = await checkRes.json() as { value?: unknown[] };
          if (checkJson.value && checkJson.value.length > 0) {
            skipped.push(c.name);
            continue; // already exists — skip
          }
        }

        // POST new subtype record
        const postRes = await fetch(`${base}/api/odata/businessobject/ivnt_AssetSubtype`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ivnt_ParentAssetType: parent_type.trim(),
            ivnt_SubType: subtype.trim(),
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (postRes.ok) {
          written.push(c.name);
        } else {
          const errText = await postRes.text().catch(() => `HTTP ${postRes.status}`);
          errors.push({ connection: c.name, error: errText });
        }
      } catch (e) {
        errors.push({ connection: c.name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return NextResponse.json({ ok: errors.length === 0, written, skipped, errors });
  } catch (err) {
    // Never bubble — caller is fire-and-forget
    return NextResponse.json({ ok: false, error: String(err) });
  }
}
