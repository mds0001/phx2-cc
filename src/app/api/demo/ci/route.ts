import { NextResponse } from "next/server";

/**
 * Demo CI record endpoint.
 *
 * Purpose: returns a minimal CI#Computers-shaped JSON payload so a Cloud
 * Weaver-hosted NFSM Quick Action can practice the full REST → Insert Object
 * loop without depending on a real external vendor API.
 *
 * Shape matches the minimum fields NFSM requires to create a CI#Computers
 * record: Name, SerialNumber, Status, CIType.
 *
 * Each call generates unique Name and SerialNumber values so repeat QA
 * invocations create distinct records (no duplicate-key collisions) and
 * provide obvious proof the data flowed through.
 *
 * Namespacing: lives under /api/demo/ci (generic CI demo). The
 * /api/demo/mikeco/* namespace is reserved for future MikeCo-specific
 * mock data routes.
 */

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store",
};

type DemoCi = {
  Name: string;
  SerialNumber: string;
  Status: string;
  CIType: string;
};

function randSuffix(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function buildCi(): DemoCi {
  const ts = Date.now();
  const suffix = randSuffix();
  return {
    Name: `CW-TEST-${ts}-${suffix}`,
    SerialNumber: `SN-${ts}-${suffix}`,
    Status: "Production",
    CIType: "Computer",
  };
}

function respond() {
  return new NextResponse(JSON.stringify(buildCi(), null, 2), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

export async function GET() {
  return respond();
}

export async function POST() {
  return respond();
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}
