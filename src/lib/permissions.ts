import type { UserRole } from "./types";

/** Basic users have read-only access — no create, edit, or delete. */
export function isReadOnly(role: UserRole | string | null | undefined): boolean {
  return role === "basic";
}
