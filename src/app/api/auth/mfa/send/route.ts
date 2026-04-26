import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createMfaChallenge, sendOtpEmail } from "@/lib/mfa-server";

/**
 * POST /api/auth/mfa/send
 *
 * Called immediately after a successful signInWithPassword when the user
 * has MFA enabled. Generates a 6-digit OTP, stores a hashed challenge in
 * the DB, and emails the code to the user.
 *
 * Requires: valid Supabase session (user just logged in with password).
 * Returns:  { mfa_required: true } on success.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Fetch profile to get name for the email greeting
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("first_name, email, mfa_enabled")
      .eq("id", user.id)
      .single();

    // Safety check — only send if MFA is actually enabled
    if (!profile?.mfa_enabled) {
      return NextResponse.json({ mfa_required: false });
    }

    const email = profile.email ?? user.email;
    if (!email) {
      return NextResponse.json({ error: "No email on file" }, { status: 400 });
    }

    // Create the challenge and send the email
    const { otp } = await createMfaChallenge(user.id);

    await sendOtpEmail({
      to: email,
      otp,
      firstName: profile.first_name ?? null,
    });

    return NextResponse.json({ mfa_required: true });
  } catch (err) {
    console.error("[mfa/send] error:", err);
    return NextResponse.json({ error: "Failed to send verification code" }, { status: 500 });
  }
}
