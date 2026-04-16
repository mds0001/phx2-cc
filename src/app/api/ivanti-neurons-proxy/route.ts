import { NextRequest, NextResponse } from "next/server";

// ── Token cache (in-process, per serverless instance) ─────────
interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}
const tokenCache = new Map<string, TokenCache>();

async function getToken(authUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const cacheKey = `${authUrl}::${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(authUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
    signal:  AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token request failed — HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("No access_token in token response");

  const expiresIn = data.expires_in ?? 3600;
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 });
  return data.access_token;
}

// ── PUT: fetch all records (paginated via @odata.nextLink) ─────
// Body: { authUrl, clientId, clientSecret, baseUrl, dataset, top?, skip? }
// Returns: { rows: [...], count: N }
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as {
      authUrl: string;
      clientId: string;
      clientSecret: string;
      baseUrl: string;
      dataset?: string;
      top?: number;
      skip?: number;
    };

    const { authUrl, clientId, clientSecret, baseUrl, dataset = "devices", top, skip } = body;

    if (!authUrl || !clientId || !clientSecret || !baseUrl) {
      return NextResponse.json({ error: "Missing required fields: authUrl, clientId, clientSecret, baseUrl" }, { status: 400 });
    }

    const token = await getToken(authUrl, clientId, clientSecret);

    const params = new URLSearchParams();
    if (top)  params.set("$top",  String(top));
    if (skip) params.set("$skip", String(skip));
    const qs = params.toString();

    // Always use the canonical Neurons People & Device Inventory API path.
    // baseUrl can be the tenant root (https://<tenant>.ivanticloud.com) or already
    // include the versioned path — normalise either form.
    const apiBase = baseUrl.replace(/\/$/, "");
    const API_PATH = "/api/apigatewaydataservices/v1";
    const normalised = apiBase.includes(API_PATH)
      ? apiBase
      : apiBase + API_PATH;
    const firstUrl = `${normalised}/${dataset}` + (qs ? `?${qs}` : "");

    console.log("[ivanti-neurons-proxy] PUT fetching:", firstUrl);
    const diagnosticUrl = firstUrl;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    const allRows: Record<string, unknown>[] = [];
    let nextUrl: string | null = firstUrl;
    let pageCount = 0;

    while (nextUrl) {
      const res = await fetch(nextUrl, { method: "GET", headers, signal: AbortSignal.timeout(30_000) });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `Neurons API returned ${res.status}: ${errBody.slice(0, 300)}` },
          { status: res.status }
        );
      }

      const invCt = res.headers.get("content-type") ?? "";
      if (!invCt.includes("application/json")) {
        const raw = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `Neurons ${dataset} endpoint non-JSON (${invCt || "no content-type"}) at [${nextUrl}] response: ${raw.slice(0, 150)}` },
          { status: 502 }
        );
      }
      const json = await res.json() as { value?: unknown[]; "@odata.nextLink"?: string };
      const rows: Record<string, unknown>[] = Array.isArray(json.value)
        ? (json.value as Record<string, unknown>[])
        : [];

      allRows.push(...rows);
      pageCount++;

      // Neurons uses @odata.nextLink with a $scrollID — honour it
      nextUrl = json["@odata.nextLink"] ?? null;
      if (pageCount >= 500) break; // safety cap
    }

    console.log(`[ivanti-neurons-proxy] Fetched ${allRows.length} record(s) across ${pageCount} page(s) from ${dataset}`);
    return NextResponse.json({ rows: allRows, count: allRows.length, _url: diagnosticUrl });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    console.error("[ivanti-neurons-proxy] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── POST: write a single record to the Neurons dataset ─────────
// Body: { authUrl, clientId, clientSecret, baseUrl, dataset, data }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      authUrl: string;
      clientId: string;
      clientSecret: string;
      baseUrl: string;
      dataset?: string;
      data: Record<string, unknown>;
    };

    const { authUrl, clientId, clientSecret, baseUrl, dataset = "devices", data } = body;

    if (!authUrl || !clientId || !clientSecret || !baseUrl || !data) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const token = await getToken(authUrl, clientId, clientSecret);
    const endpoint = `${baseUrl.replace(/\/$/, "")}/${dataset}`;

    console.log("[ivanti-neurons-proxy] POST to:", endpoint);

    const res = await fetch(endpoint, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body:   JSON.stringify(data),
      signal: AbortSignal.timeout(15_000),
    });

    const ct = res.headers.get("content-type") ?? "";
    const responseBody = ct.includes("application/json") ? await res.json() : await res.text();

    console.log("[ivanti-neurons-proxy] POST response:", res.status);
    return NextResponse.json(
      { status: res.status, statusText: res.statusText, body: responseBody },
      { status: res.ok ? 200 : res.status }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    console.error("[ivanti-neurons-proxy] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
