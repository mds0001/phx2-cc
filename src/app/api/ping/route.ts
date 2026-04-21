import { NextRequest, NextResponse } from "next/server";

/**
 * Dial-tone / heartbeat endpoint.
 *
 * Purpose: a stable, self-hosted "I'm here" endpoint that Cloud Weaver owns.
 * Used as a reachable target for external systems that validate URLs on save
 * (e.g. Ivanti NFSM Web Service Connection Manager validates a Service
 * Reference base URL by calling it during Save; it parses the response as
 * XML, so returning JSON only trips "Data at the root level is invalid").
 * Also useful as a reusable probe for Postman/curl/monitoring checks and
 * recorded demos.
 *
 * Design goals:
 * - Accepts any HTTP verb — validators vary in which method they use.
 * - Content negotiation: JSON by default; XML when caller asks for it via
 *   Accept header (application/xml, text/xml, soap) OR ?format=xml query.
 *   This keeps curl/browser/Postman getting JSON while SOAP-style validators
 *   get a parseable XML document.
 * - Permissive CORS so browser-based testers can hit it.
 * - No auth, no body parsing. Zero attack surface.
 * - No caching so each call is fresh (timestamp is useful for debugging).
 */

const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store",
};

const XML_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  "Content-Type": "application/xml; charset=utf-8",
};

function wantsXml(request: NextRequest): boolean {
  const format = new URL(request.url).searchParams.get("format");
  if (format === "xml" || format === "soap") return true;
  const accept = (request.headers.get("accept") || "").toLowerCase();
  if (
    accept.includes("application/xml") ||
    accept.includes("text/xml") ||
    accept.includes("application/soap") ||
    accept.includes("soap+xml")
  ) {
    return true;
  }
  return false;
}

function buildJsonResponse(method: string) {
  return NextResponse.json(
    {
      ok: true,
      message: "I'm here",
      method,
      receivedAt: new Date().toISOString(),
    },
    { status: 200, headers: BASE_HEADERS }
  );
}

function buildXmlResponse(method: string) {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ping>` +
    `<ok>true</ok>` +
    `<message>I'm here</message>` +
    `<method>${method}</method>` +
    `<receivedAt>${new Date().toISOString()}</receivedAt>` +
    `</ping>`;
  return new NextResponse(body, { status: 200, headers: XML_HEADERS });
}

function respond(request: NextRequest, method: string) {
  return wantsXml(request) ? buildXmlResponse(method) : buildJsonResponse(method);
}

export async function GET(request: NextRequest) {
  return respond(request, "GET");
}

export async function POST(request: NextRequest) {
  return respond(request, "POST");
}

export async function PUT(request: NextRequest) {
  return respond(request, "PUT");
}

export async function DELETE(request: NextRequest) {
  return respond(request, "DELETE");
}

export async function PATCH(request: NextRequest) {
  return respond(request, "PATCH");
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: BASE_HEADERS });
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
