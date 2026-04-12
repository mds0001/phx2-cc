import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// ── Route handler ─────────────────────────────────────────────
//
// POST /api/cdw-proxy
// Body: {
//   connectionId: string,           // endpoint_connections row id
//   path: string,                   // API path, e.g. "/po-status"
//   method?: string,                // default "POST" (most CDW APIs use POST)
//   body?: unknown,                 // request body
//   params?: Record<string, string> // optional query params
// }
//
// CDW uses Azure API Management — auth is via the
// "Ocp-Apim-Subscription-Key" header. No OAuth token exchange needed.
//
export async function POST(request: NextRequest) {
  try {
    const { connectionId, path, method = "POST", body, params } = (await request.json()) as {
      connectionId: string;
      path: string;
      method?: string;
      body?: unknown;
      params?: Record<string, string>;
    };

    if (!connectionId) {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }
    if (!path) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    // ── Load connection from Supabase ─────────────────────────
    const supabase = await createClient();
    const { data: conn, error: connErr } = await supabase
      .from("endpoint_connections")
      .select("config, type")
      .eq("id", connectionId)
      .single();

    if (connErr || !conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (conn.type !== "cdw") {
      return NextResponse.json({ error: "Connection is not a CDW connection" }, { status: 400 });
    }

    const cfg = conn.config as Record<string, string>;
    const {
      base_url = "https://portal.apiconnect.cdw.com",
      subscription_key,
      account_number,
    } = cfg;

    if (!subscription_key) {
      return NextResponse.json({ error: "CDW connection missing subscription key" }, { status: 400 });
    }

    // ── Build the full CDW API URL ────────────────────────────
    const urlBase = `${base_url.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    const url = new URL(urlBase);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    // ── Forward the request ───────────────────────────────────
    const headers: Record<string, string> = {
      "Ocp-Apim-Subscription-Key": subscription_key,
      Accept: "application/json",
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(15_000),
    };

    if (body && method !== "GET") {
      // Inject account number into body if it isn't already present
      const bodyWithAccount =
        account_number && typeof body === "object" && body !== null && !("accountNumber" in body)
          ? { accountNumber: account_number, ...(body as Record<string, unknown>) }
          : body;

      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(bodyWithAccount);
    }

    const cdwRes = await fetch(url.toString(), fetchOptions);
    const contentType = cdwRes.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const data = await cdwRes.json();
      return NextResponse.json(data, { status: cdwRes.status });
    }

    const text = await cdwRes.text();
    return new NextResponse(text, {
      status: cdwRes.status,
      headers: { "Content-Type": contentType || "text/plain" },
    });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
