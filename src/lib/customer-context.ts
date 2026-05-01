import { cookies } from "next/headers";
import type { UserRole, UserRoleAssignment } from "./types";

const COOKIE_NAME = "active_customer_id";

/** Read the active customer ID from the request cookie (server-side only). */
export async function getActiveCustomerId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

/** Set the active customer ID cookie (server action). */
export async function setActiveCustomerId(customerId: string | null): Promise<void> {
  "use server";
  const store = await cookies();
  if (customerId) {
    store.set(COOKIE_NAME, customerId, {
      path: "/",
      httpOnly: false,   // must be readable by the client switcher for optimistic UI
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  } else {
    store.delete(COOKIE_NAME);
  }
}

/**
 * Resolve the effective customer filter for a page, given the user's active role assignment.
 *
 * - administrator  → uses the cookie-based switcher (may be null = "all")
 * - schedule_administrator / schedule_auditor → uses the assignment's customer_id
 * - basic          → null (no filtering — they can't create/edit anyway)
 */
export async function resolveCustomerFilter(
  assignment: UserRoleAssignment | null,
): Promise<string | null> {
  if (!assignment) return null;
  const role: UserRole = assignment.role;
  if (role === "schedule_administrator" || role === "schedule_auditor") {
    return assignment.customer_id ?? null;
  }
  if (role === "administrator") {
    return getActiveCustomerId();
  }
  return null;
}
