"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "./supabase-browser";
import type { UserRoleAssignment } from "./types";

const ACTIVE_ROLE_COOKIE = "active_role_id";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string | null): void {
  if (typeof document === "undefined") return;
  if (value === null) {
    document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
  } else {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  }
}

interface UseActiveRoleResult {
  /** All role assignments for the current user. Empty before initial load. */
  availableRoles: UserRoleAssignment[];
  /** The currently active assignment (resolved via cookie, falls back to primary). */
  active: UserRoleAssignment | null;
  /** True until the initial fetch resolves. */
  loading: boolean;
  /** Switch the active role and refresh the page so server components re-render. */
  switchRole: (assignmentId: string) => void;
}

/** Client hook: fetches the current user's role assignments and tracks the active one. */
export function useActiveRole(): UseActiveRoleResult {
  const supabase = createClient();
  const router = useRouter();
  const [availableRoles, setAvailableRoles] = useState<UserRoleAssignment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => readCookie(ACTIVE_ROLE_COOKIE));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) setLoading(false); return; }
      const { data } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user.id);
      if (cancelled) return;
      setAvailableRoles((data ?? []) as UserRoleAssignment[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const active: UserRoleAssignment | null = (() => {
    if (availableRoles.length === 0) return null;
    if (activeId) {
      const m = availableRoles.find((r) => r.id === activeId);
      if (m) return m;
    }
    return availableRoles.find((r) => r.is_primary) ?? availableRoles[0];
  })();

  const switchRole = useCallback((assignmentId: string) => {
    writeCookie(ACTIVE_ROLE_COOKIE, assignmentId);
    setActiveId(assignmentId);
    router.refresh();
  }, [router]);

  return { availableRoles, active, loading, switchRole };
}
