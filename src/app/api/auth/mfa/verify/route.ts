import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  verifyMfaChallenge,
  buildMfaCookieValue,
  MFA_COOKIE_NAME,
  MFA_COOKIE_TTL_MS,
} from "@/lib/mfa-server";

/**
 * POST /api/auth/mfa/verify
 *
 * Verifies the 6-digit OTP the user entered.  On success, sets an
 * httpOnly signed cookie (mfa_verified) that the middleware accepts
 * as proof the second factor was completed for this session.
 *
 * Body: { otp: string }
 * Returns: { success: true } | { error: string }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { otp } = (await req.json()) as { otp?: string };
    if (!otp || !/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: "Invalid verification code format" }, { status: 400 });
    }

    const valid = await verifyMfaChallenge(user.id, otp);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect or expired verification code" }, { status: 400 });
    }

    // Issue the mfa_verified cookie — httpOnly so JS can't read or delete it
    const cookieValue = buildMfaCookieValue(user.id);
    const maxAgeSec = Math.floor(MFA_COOKIE_TTL_MS / 1000);

    const response = NextResponse.json({ success: true });
    response.cookies.set(MFA_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: maxAgeSec,
    });

    return response;
  } catch (err) {
    console.error("[mfa/verify] error:", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
