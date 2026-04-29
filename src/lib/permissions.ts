import type { UserRole } from "./types";

/** Basic users and auditors have read-only access — no create, edit, or delete. */
export function isReadOnly(role: UserRole | string | null | undefined): boolean {
  return role === "basic" || role === "schedule_auditor";
}

/** Schedule Auditors — read-only scheduler view, email notifications on run complete, no mapping/endpoint access. */
export function isAuditor(role: UserRole | string | null | undefined): boolean {
  return role === "schedule_auditor";
}
