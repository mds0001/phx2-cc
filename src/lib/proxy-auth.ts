import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/**
 * Auth guard for the destination proxy routes (/api/ivanti-proxy, ...).
 * middleware.ts skips /api/*, so each proxy must gate itself.
 *
 * Two legitimate callers:
 *   - the browser (SchedulerClient / MappingEditorClient) -> Supabase session cookie
 *   - the server-side task runner and /api/agent/data      -> CRON_SECRET bearer
 *     (they call the proxy over HTTP and carry no user session; same bypass
 *     insight-proxy and the scheduler routes already use)
 *
 * Returns a 401 response to send back, or null when the caller is authorized.
 */
export async function requireProxyAuth(req: NextRequest): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader && bearerMatches(authHeader, cronSecret)) return null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

function bearerMatches(authHeader: string, secret: string): boolean {
  const a = Buffer.from(authHeader);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
