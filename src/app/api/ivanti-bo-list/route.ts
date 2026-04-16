import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import type { IvantiConfig } from "@/lib/types";

// Common Ivanti Neurons ITSM business objects — used as fallback when $metadata is unavailable
const IVANTI_COMMON_BOS = [
  "Account", "Address", "Alert", "Announcement",
  "Asset", "AssetLease", "AssetLifecycle", "AssetReceiving",
  "Change", "CI", "CI__Computers", "CI__MobileDevice", "CI__NetworkDevice",
  "CI__Printer", "CI__Server", "CI__Software", "CI__Monitor",
  "ConfigurationItem", "Contract",
  "Department", "Employee",
  "Incident", "IPAddress",
  "KnowledgeArticle",
  "Location",
  "Manufacturer",
  "Network",
  "Problem", "PurchaseOrder", "PurchaseRequisition",
  "Release",
  "ServiceReq", "SLA", "Software", "SoftwareLicense",
  "Task",
  "Vendor",
  "WorkOrder",
].sort();

// GET /api/ivanti-bo-list?connectionId=xxx
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get("connectionId");
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: conn } = await supabase
      .from("endpoint_connections")
      .select("*")
      .eq("id", connectionId)
      .single();

    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    const cfg = conn.config as IvantiConfig;
    const base = (cfg.url ?? "").replace(/\/+$/, "");
    const headers: Record<string, string> = {
      Accept: "application/xml,text/xml,*/*",
      Authorization: "rest_api_key=" + cfg.api_key,
    };
    if (cfg.tenant_id) headers["X-Tenant-Id"] = cfg.tenant_id;

    // Try live $metadata first (works on most on-prem Ivanti instances)
    try {
      const res = await fetch(base + "/api/odata/$metadata", { headers });
      if (res.ok) {
        const xml = await res.text();
        const setRegex = /<EntitySet\s[^>]*\bName="([^"]+)"/g;
        const bos: { name: string; url: string; live: boolean }[] = [];
        let m: RegExpExecArray | null;
        while ((m = setRegex.exec(xml)) !== null) {
          bos.push({ name: m[1], url: "businessobject/" + m[1], live: true });
        }
        if (bos.length > 0) {
          return NextResponse.json({ bos: bos.sort((a, b) => a.name.localeCompare(b.name)), live: true });
        }
      }
    } catch { /* fall through to static list */ }

    // Fallback: return curated common BO list
    const bos = IVANTI_COMMON_BOS.map((name) => ({ name, url: "businessobject/" + name, live: false }));
    return NextResponse.json({ bos, live: false });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
