import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
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

    const { email, first_name, last_name, role, customer_id, password } = await req.json() as {
      email: string;
      first_name?: string;
      last_name?: string;
      role: "administrator" | "schedule_administrator" | "basic";
      customer_id?: string | null;
      password?: string;
    };

    if (!email || !role) {
      return NextResponse.json({ error: "email and role are required" }, { status: 400 });
    }

    const admin = createAdminClient();
    let createdUserId: string | undefined;

    if (password?.trim()) {
      // Direct creation -- no invite email sent
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: email.trim(),
        password: password.trim(),
        email_confirm: true,
        user_metadata: { first_name: first_name ?? "", last_name: last_name ?? "" },
      });
      if (createError) return NextResponse.json({ error: createError.message }, { status: 400 });
      createdUserId = created?.user?.id;
    } else {
      // Invite flow -- user sets their own password on first login
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
        email,
        {
          data: { first_name: first_name ?? "", last_name: last_name ?? "" },
          redirectTo: `${req.nextUrl.origin}/dashboard`,
        }
      );
      if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 400 });
      createdUserId = invited?.user?.id;
    }

    if (createdUserId) {
      await admin.from("profiles").upsert({
        id: createdUserId,
        email,
        first_name: first_name ?? null,
        last_name: last_name ?? null,
        role,
        user_type: role === "administrator" ? "admin" : role === "basic" ? "basic" : "user",
        customer_id: role === "schedule_administrator" ? (customer_id ?? null) : null,
      }, { onConflict: "id" });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
