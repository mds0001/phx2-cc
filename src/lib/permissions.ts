import { cookies } from "next/headers";
import { createClient as createServerClient } from "./supabase-server";
import type { UserRole, UserRoleAssignment } from "./types";

export const ACTIVE_ROLE_COOKIE = "active_role_id";

/** Basic users and auditors have read-only access — no create, edit, or delete. */
export function isReadOnly(role: UserRole | string | null | undefined): boolean {
  return role === "basic" || role === "schedule_auditor";
}

/** Schedule Auditors — read-only scheduler view, email notifications on run complete, no mapping/endpoint access. */
export function isAuditor(role: UserRole | string | null | undefined): boolean {
  return role === "schedule_auditor";
}

/**
 * Resolve the active role assignment for a user.
 *
 * Reads the `active_role_id` cookie; if it points to a row belonging to this user,
 * that row is returned. Otherwise falls back to the user's primary assignment.
 * Returns null only if the user has no role assignments at all.
 */
export async function getActiveRoleAssignment(
  userId: string,
): Promise<UserRoleAssignment | null> {
  const supabase = await createServerClient();
  const store = await cookies();
  const activeId = store.get(ACTIVE_ROLE_COOKIE)?.value ?? null;

  // Fetch all assignments for this user — small set, single round trip
  const { data: rows } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId);

  if (!rows || rows.length === 0) return null;

  if (activeId) {
    const match = rows.find((r) => r.id === activeId) as UserRoleAssignment | undefined;
    if (match) return match;
  }
  // Fallback: primary, else first row.
  const primary = rows.find((r) => r.is_primary) as UserRoleAssignment | undefined;
  return primary ?? (rows[0] as UserRoleAssignment);
}

/** Convenience: load active role assignment for the currently authenticated user. */
export async function getCurrentUserAssignment(): Promise<{
  userId: string;
  assignment: UserRoleAssignment | null;
} | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const assignment = await getActiveRoleAssignment(user.id);
  return { userId: user.id, assignment };
}

/** Server action: switch the active role assignment for the current user (sets cookie). */
export async function setActiveRoleId(assignmentId: string | null): Promise<void> {
  "use server";
  const store = await cookies();
  if (assignmentId) {
    store.set(ACTIVE_ROLE_COOKIE, assignmentId, {
      path: "/",
      httpOnly: false, // client-readable for optimistic UI
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  } else {
    store.delete(ACTIVE_ROLE_COOKIE);
  }
}
