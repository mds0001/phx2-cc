import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

// PATCH — update profile (name, role)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Prevent the last administrator from demoting themselves
    const body = await req.json() as {
      first_name?: string;
      last_name?: string;
      role?: "administrator" | "schedule_administrator" | "basic";
    };

    if (body.role && body.role !== "administrator" && id === user.id) {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "administrator");
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot demote the last administrator." },
          { status: 400 }
        );
      }
    }

    const patch: Record<string, unknown> = {};
    if (body.first_name !== undefined) patch.first_name = body.first_name;
    if (body.last_name  !== undefined) patch.last_name  = body.last_name;
    if (body.role       !== undefined) {
      patch.role      = body.role;
      patch.user_type = body.role === "administrator" ? "admin" : body.role === "basic" ? "basic" : "user";
    }

    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — remove user from auth + profile
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (id === user.id) {
      return NextResponse.json({ error: "Cannot delete your own account." }, { status: 400 });
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (callerProfile?.role !== "administrator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Use service-role client to delete from auth.users (profile cascades via FK)
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
