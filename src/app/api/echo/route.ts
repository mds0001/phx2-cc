import { NextRequest, NextResponse } from "next/server";

/**
 * JSON echo endpoint.
 *
 * Purpose: a REST/JSON-shaped counterpart to /api/ping (which is SOAP/WSDL).
 * Used for exercising Cloud Weaver's NFSM REST integration path — specifically
 * the "Run Rest Web Service" Quick Action template. Echoes back the method,
 * path, query, headers, and body of whatever hit it, so we can confirm
 * round-trip and see exactly what NFSM puts on the wire.
 *
 * Design:
 * - Accepts any HTTP verb.
 * - Always returns application/json.
 * - Permissive CORS, no auth.
 * - Masks secret-looking header values (authorization, *key*, *token*,
 *   *secret*) so we don't leak tokens back to callers if someone wires real
 *   credentials into the test action by mistake.
 */

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store",
};

type EchoPayload = {
  ok: true;
  message: string;
  receivedAt: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
};

function maskSecretHeader(name: string, value: string): string {
  const lower = name.toLowerCase();
  const isSecret =
    lower === "authorization" ||
    lower.includes("key") ||
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("password");
  if (!isSecret) return value;
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

async function echo(req: NextRequest, method: string): Promise<NextResponse> {
  const url = new URL(req.url);

  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = maskSecretHeader(k, v);
  });

  let body: unknown = null;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const contentType = req.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        body = await req.json().catch(() => null);
      } else {
        const text = await req.text();
        body = text.length > 0 ? text : null;
      }
    } catch {
      body = null;
    }
  }

  const payload: EchoPayload = {
    ok: true,
    message: `Hello from Cloud Weaver — received ${method} ${url.pathname}`,
    receivedAt: new Date().toISOString(),
    method,
    path: url.pathname,
    query,
    headers,
    body,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  return echo(req, "GET");
}

export async function POST(req: NextRequest) {
  return echo(req, "POST");
}

export async function PUT(req: NextRequest) {
  return echo(req, "PUT");
}

export async function DELETE(req: NextRequest) {
  return echo(req, "DELETE");
}

export async function PATCH(req: NextRequest) {
  return echo(req, "PATCH");
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: JSON_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}
