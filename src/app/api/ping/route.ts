import { NextResponse } from "next/server";

/**
 * Dial-tone / heartbeat endpoint.
 *
 * Purpose: a stable, self-hosted "I'm here" endpoint that Cloud Weaver owns.
 * Used as a reachable target for external systems that validate URLs on save
 * (e.g. Ivanti NFSM Web Service Connection Manager validates a Service
 * Reference base URL by calling it during Save; it parses the response as
 * XML). Also useful as a reusable probe for Postman/curl/monitoring checks
 * and recorded demos.
 *
 * Design goals:
 * - Accepts any HTTP verb — validators vary in which method they use.
 * - ALWAYS returns a minimal XML document, regardless of Accept header or
 *   query string. We tried content negotiation (XML on ?format=xml or
 *   Accept: application/xml) but NFSM's validator strips query strings and
 *   sends GET without an XML-specific Accept header, so the fallback still
 *   served JSON and tripped "Data at the root level is invalid." Always-XML
 *   removes all guesswork.
 * - Permissive CORS so browser-based testers can hit it.
 * - No auth, no body parsing. Zero attack surface.
 * - No caching so each call is fresh (timestamp is useful for debugging).
 */

const XML_HEADERS: Record<string, string> = {
  "Content-Type": "application/xml; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store",
};

function xmlBody(method: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ping>` +
    `<ok>true</ok>` +
    `<message>I'm here</message>` +
    `<method>${method}</method>` +
    `<receivedAt>${new Date().toISOString()}</receivedAt>` +
    `</ping>`
  );
}

function respond(method: string) {
  return new NextResponse(xmlBody(method), { status: 200, headers: XML_HEADERS });
}

export async function GET() {
  return respond("GET");
}

export async function POST() {
  return respond("POST");
}

export async function PUT() {
  return respond("PUT");
}

export async function DELETE() {
  return respond("DELETE");
}

export async function PATCH() {
  return respond("PATCH");
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: XML_HEADERS });
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
