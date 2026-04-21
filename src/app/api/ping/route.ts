import { NextResponse } from "next/server";

/**
 * Dial-tone / heartbeat endpoint.
 *
 * Purpose: a stable, self-hosted "I'm here" endpoint that Cloud Weaver owns.
 * Used as a reachable target for external systems that validate URLs on save
 * (e.g. Ivanti NFSM Web Service Connection Manager validates a Service
 * Reference base URL by calling it during Save; an unreachable host fails
 * with "No such host is known"). Also useful as a reusable probe for
 * Postman/curl/monitoring checks and recorded demos.
 *
 * Design goals:
 * - Accepts any HTTP verb — validators vary in which method they use.
 * - Responds 200 with small JSON payload echoing the method and timestamp.
 * - Permissive CORS so browser-based testers can hit it.
 * - No auth, no body parsing. Zero attack surface.
 * - No caching so each call is fresh (timestamp is useful for debugging).
 */

const JSON_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store",
};

function buildResponse(method: string) {
  return NextResponse.json(
    {
      ok: true,
      message: "I'm here",
      method,
      receivedAt: new Date().toISOString(),
    },
    { status: 200, headers: JSON_HEADERS }
  );
}

export async function GET() {
  return buildResponse("GET");
}

export async function POST() {
  return buildResponse("POST");
}

export async function PUT() {
  return buildResponse("PUT");
}

export async function DELETE() {
  return buildResponse("DELETE");
}

export async function PATCH() {
  return buildResponse("PATCH");
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
