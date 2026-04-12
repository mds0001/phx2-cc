import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// ── Simple in-memory token cache ──────────────────────────────
interface TokenEntry {
  token: string;
  expiresAt: number; // ms epoch
}

const tokenCache = new Map<string, TokenEntry>();

async function getToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  forwardedClientId: string,
  scope: string
): Promise<string> {
  const cacheKey = `${baseUrl}::${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const tokenUrl = `${baseUrl.replace(/\/$/, "")}/auth/oauth/v2/token`;
  const body = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     clientId,
    client_secret: clientSecret,
    scope,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(forwardedClientId ? { "X-FORWARDED-CLIENT-ID": forwardedClientId } : {}),
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dell OAuth failed — HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error("No access_token in Dell OAuth response");

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return data.access_token;
}

// ── Route handler ─────────────────────────────────────────────
//
// POST /api/dell-proxy
// Body: {
//   connectionId: string,   // endpoint_connections row id
//   path: string,           // API path, e.g. "/PROD/CatalogAPI/..."
//   method?: string,        // default "GET"
//   body?: unknown,         // request body for POST/PUT
//   params?: Record<string, string>  // query params appended to path
// }
//
export async function POST(request: NextRequest) {
  try {
    const { connectionId, path, method = "GET", body, params } = (await request.json()) as {
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
    if (conn.type !== "dell") {
      return NextResponse.json({ error: "Connection is not a Dell connection" }, { status: 400 });
    }

    const cfg = conn.config as Record<string, string>;
    const {
      base_url = "https://apigtwb2c.us.dell.com",
      client_id,
      client_secret,
      forwarded_client_id = "",
      premier_account_id,
      scope = "oob",
    } = cfg;

    if (!client_id || !client_secret) {
      return NextResponse.json({ error: "Dell connection missing client credentials" }, { status: 400 });
    }

    // ── Obtain OAuth token ────────────────────────────────────
    const token = await getToken(base_url, client_id, client_secret, forwarded_client_id, scope);

    // ── Build the full Dell API URL ───────────────────────────
    const urlBase = `${base_url.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    const url = new URL(urlBase);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    if (premier_account_id && !url.searchParams.has("customerNumber")) {
      url.searchParams.set("customerNumber", premier_account_id);
    }

    // ── Forward the request ───────────────────────────────────
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(forwarded_client_id ? { "X-FORWARDED-CLIENT-ID": forwarded_client_id } : {}),
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(15_000),
    };

    if (body && method !== "GET") {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(body);
    }

    const dellRes = await fetch(url.toString(), fetchOptions);
    const contentType = dellRes.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const data = await dellRes.json();
      return NextResponse.json(data, { status: dellRes.status });
    }

    const text = await dellRes.text();
    return new NextResponse(text, {
      status: dellRes.status,
      headers: { "Content-Type": contentType || "text/plain" },
    });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
