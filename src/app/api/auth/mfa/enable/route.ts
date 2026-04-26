import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * POST /api/auth/mfa/enable
 *
 * Enables MFA for the currently signed-in user.
 * Updates both the profiles table and app_metadata (so middleware can
 * check without an extra DB query).
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
      .update({ mfa_enabled: true })
      .eq("id", user.id);
    if (profileErr) throw profileErr;

    // Update app_metadata so middleware can read it from the session JWT
    const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, mfa_enabled: true },
    });
    if (metaErr) throw metaErr;

    return NextResponse.json({ success: true, mfa_enabled: true });
  } catch (err) {
    console.error("[mfa/enable] error:", err);
    return NextResponse.json({ error: "Failed to enable MFA" }, { status: 500 });
  }
}
