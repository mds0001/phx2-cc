import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import type { UserRole } from "@/lib/types";

interface RoleAssignmentInput {
  role: UserRole;
  customer_id?: string | null;
  is_primary?: boolean;
}

function deriveUserType(roles: RoleAssignmentInput[]): "admin" | "user" | "basic" {
  if (roles.some((r) => r.role === "administrator")) return "admin";
  if (roles.length > 0 && roles.every((r) => r.role === "basic" || r.role === "schedule_auditor")) return "basic";
  return "user";
}

function validateRoles(roles: RoleAssignmentInput[]): string | null {
  if (!Array.isArray(roles) || roles.length === 0) return "At least one role is required.";
  const validRoles: UserRole[] = ["administrator", "schedule_administrator", "basic", "schedule_auditor"];
  for (const r of roles) {
    if (!validRoles.includes(r.role)) return `Invalid role: ${r.role}`;
    if ((r.role === "schedule_administrator" || r.role === "schedule_auditor") && !r.customer_id) {
      return `${r.role} assignment requires a customer.`;
    }
  }
  const primaryCount = roles.filter((r) => r.is_primary).length;
  if (primaryCount !== 1) return "Exactly one role must be marked primary.";
  return null;
}

// PATCH — update profile fields and/or replace role assignments
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
      .select("user_type")
      .eq("id", user.id)
      .single();

    if (callerProfile?.user_type !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json() as {
      first_name?: string;
      last_name?: string;
      roles?: RoleAssignmentInput[];
      password?: string;
    };

    // Last-administrator guard: prevent the caller from removing their own admin role
    // when no other administrators exist.
    if (body.roles && id === user.id) {
      const willBeAdmin = body.roles.some((r) => r.role === "administrator");
      if (!willBeAdmin) {
        const { data: otherAdmins } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "administrator")
          .neq("user_id", user.id);
        if (!otherAdmins || otherAdmins.length === 0) {
          return NextResponse.json(
            { error: "Cannot remove the administrator role from the last administrator." },
            { status: 400 }
          );
        }
      }
    }

    const adminClient = createAdminClient();

    // Update password if provided
    if (body.password) {
      if (body.password.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
      }
      const { error: pwErr } = await adminClient.auth.admin.updateUserById(id, {
        password: body.password,
      });
      if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 400 });
    }

    // Build profile patch
    const patch: Record<string, unknown> = {};
    if (body.first_name !== undefined) patch.first_name = body.first_name;
    if (body.last_name  !== undefined) patch.last_name  = body.last_name;
    if (body.roles      !== undefined) {
      const roleErr = validateRoles(body.roles);
      if (roleErr) return NextResponse.json({ error: roleErr }, { status: 400 });
      patch.user_type = deriveUserType(body.roles);
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await adminClient
        .from("profiles")
        .update(patch)
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Replace role assignments (if provided)
    if (body.roles !== undefined) {
      const { error: delErr } = await adminClient
        .from("user_roles")
        .delete()
        .eq("user_id", id);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

      const roleRows = body.roles.map((r) => ({
        user_id: id,
        role: r.role,
        customer_id: (r.role === "schedule_administrator" || r.role === "schedule_auditor")
          ? (r.customer_id ?? null)
          : null,
        is_primary: !!r.is_primary,
      }));
      const { error: insErr } = await adminClient.from("user_roles").insert(roleRows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — remove user from auth + profile (cascade to user_roles)
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
      .select("user_type")
      .eq("id", user.id)
      .single();

    if (callerProfile?.user_type !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Use service-role client to delete from auth.users (profile + user_roles cascade via FK)
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
