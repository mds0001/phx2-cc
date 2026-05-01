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

export async function POST(req: NextRequest) {
  try {
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

    const { email, first_name, last_name, roles, password } = await req.json() as {
      email: string;
      first_name?: string;
      last_name?: string;
      roles: RoleAssignmentInput[];
      password?: string;
    };

    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    const roleErr = validateRoles(roles);
    if (roleErr) return NextResponse.json({ error: roleErr }, { status: 400 });

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
        user_type: deriveUserType(roles),
      }, { onConflict: "id" });

      // Insert role assignments
      const roleRows = roles.map((r) => ({
        user_id: createdUserId,
        role: r.role,
        customer_id: (r.role === "schedule_administrator" || r.role === "schedule_auditor")
          ? (r.customer_id ?? null)
          : null,
        is_primary: !!r.is_primary,
      }));
      const { error: roleErr2 } = await admin.from("user_roles").insert(roleRows);
      if (roleErr2) return NextResponse.json({ error: roleErr2.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
