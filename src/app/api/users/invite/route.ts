import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    // Verify the caller is an authenticated administrator
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (callerProfile?.role !== "administrator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse body
    const { email, first_name, last_name, role } = await req.json() as {
      email: string;
      first_name?: string;
      last_name?: string;
      role: "administrator" | "schedule_administrator";
    };

    if (!email || !role) {
      return NextResponse.json({ error: "email and role are required" }, { status: 400 });
    }

    // Use service-role client to invite the user
    const admin = createAdminClient();

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      email,
      {
        data: { first_name: first_name ?? "", last_name: last_name ?? "" },
        redirectTo: `${req.nextUrl.origin}/dashboard`,
      }
    );

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 });
    }

    // Upsert profile row with the chosen role (the auth trigger may already have created it)
    if (invited?.user) {
      await admin.from("profiles").upsert({
        id: invited.user.id,
        email,
        first_name: first_name ?? null,
        last_name: last_name ?? null,
        role,
        user_type: role === "administrator" ? "admin" : "user",
      }, { onConflict: "id" });
    }

    return NextResponse.json({ success: true, user: invited?.user });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
