import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { MFA_COOKIE_NAME } from "@/lib/mfa-server";

/**
 * POST /api/auth/mfa/disable
 *
 * Disables MFA for the currently signed-in user.
 * Also clears the mfa_verified cookie so the middleware re-evaluates state.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdminClient();

    // Update profiles
    const { error: profileErr } = await admin
      .from("profiles")
      .update({ mfa_enabled: false })
      .eq("id", user.id);
    if (profileErr) throw profileErr;

    // Update app_metadata
    const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, mfa_enabled: false },
    });
    if (metaErr) throw metaErr;

    // Clear any pending MFA challenges for this user
    await admin
      .from("mfa_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("used_at", null);

    const response = NextResponse.json({ success: true, mfa_enabled: false });
    // Clear the mfa_verified cookie
    response.cookies.set(MFA_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (err) {
    console.error("[mfa/disable] error:", err);
    return NextResponse.json({ error: "Failed to disable MFA" }, { status: 500 });
  }
}
