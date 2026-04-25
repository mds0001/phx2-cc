import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/insight-qa/oauth/token
 *
 * Insight Enterprises Digital Platform API stand-in.
 * Accepts any Basic-Auth client_credentials request and returns a stub bearer token.
 * Does NOT validate client_id / client_secret — that's intentional for QA.
 */
export async function POST(req: NextRequest) {
  // Accept any non-empty Authorization header (Basic base64(id:secret))
  const auth = req.headers.get("authorization") ?? "";
  if (!auth) {
    return NextResponse.json(
      { error: "authorization header required" },
      { status: 401 }
    );
  }

  // Generate a stub token — unique per call via crypto
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const accessToken = `stub-${rand}`;

  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "insight.invoices.read",
  });
}
