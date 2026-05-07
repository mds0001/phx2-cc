import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { runChunk, createPendingRun, findRecurringTaskDue, type ClaimedRun } from "@/lib/taskRunner";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cron-driven tick. Fired every minute by Vercel cron, or manually by an admin
 * during dev. Claims the next eligible task_run via FOR UPDATE SKIP LOCKED and
 * advances its state.
 *
 *   pending     -> running (transitions, then falls through to runChunk so the
 *                 same tick gets actual work done — saves a 60s round-trip)
 *   cancelling  -> cancelled (sets finished_at, syncs scheduled_tasks.status)
 *   running     -> runChunk() processes one budget-bounded chunk
 */
async function authorize(req: NextRequest): Promise<{ ok: boolean; reason?: string }> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true };
  }

  // Fallback: authenticated admin user (for manual ticks during development).
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "no session" };
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_type")
      .eq("id", user.id)
      .single();
    if (profile?.user_type !== "admin") return { ok: false, reason: "not admin" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "auth failed" };
  }
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  const admin = createAdminClient();

  let { data: run, error: claimErr } = await admin.rpc("scheduler_claim_next_run");
  if (claimErr) {
    console.error("[scheduler/tick] claim error:", claimErr.message);
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  // No run claimable — check for a recurring task whose start_date_time has
  // elapsed and which has no live run. Auto-create a pending row and re-claim.
  if (!run) {
    const dueTask = await findRecurringTaskDue(admin);
    if (!dueTask) {
      return NextResponse.json({ status: "idle" });
    }
    const created = await createPendingRun({ admin, task: dueTask, triggeredBy: null });
    if (!created.ok) {
      // Rare race: someone else claimed it between our query and insert.
      return NextResponse.json({ status: "idle", note: created.error });
    }
    await admin.from("task_logs").insert({
      task_id: dueTask.id,
      action: "INFO",
      details: `Auto-started recurring run (${dueTask.recurrence}) — task "${dueTask.task_name}"`,
    });
    // Re-claim now that a fresh pending row exists.
    const reclaim = await admin.rpc("scheduler_claim_next_run");
    if (reclaim.error || !reclaim.data) {
      // Edge case: created but couldn't reclaim immediately. Will be picked up next tick.
      return NextResponse.json({ status: "auto-created", run_id: created.run_id });
    }
    run = reclaim.data;
  }

  // The RPC returns the row, but to guard against PostgREST schema cache lag
  // and any composite-type serialization quirks, refetch by id so the runner
  // gets the canonical full row including freshly-added columns.
  const claimedId = (run as { id?: string } | null)?.id;
  if (!claimedId) {
    return NextResponse.json({ status: "idle" });
  }
  const { data: fullRow, error: fetchErr } = await admin
    .from("task_runs")
    .select("*")
    .eq("id", claimedId)
    .single();
  if (fetchErr || !fullRow) {
    console.error("[scheduler/tick] failed to refetch claimed run:", fetchErr?.message);
    return NextResponse.json({ error: "claimed run not found", run_id: claimedId }, { status: 500 });
  }
  const claimed = fullRow as ClaimedRun & {
    status: "pending" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
  };
  const nowIso = new Date().toISOString();

  if (claimed.status === "cancelling") {
    await admin
      .from("task_runs")
      .update({ status: "cancelled", finished_at: nowIso })
      .eq("id", claimed.id);
    await admin
      .from("scheduled_tasks")
      .update({ status: "cancelled" })
      .eq("id", claimed.task_id);
    return NextResponse.json({ status: "cancelled", run_id: claimed.id });
  }

  if (claimed.status === "pending") {
    await admin
      .from("task_runs")
      .update({ status: "running", started_at: nowIso })
      .eq("id", claimed.id);
    claimed.status = "running";
  }

  // Status is now "running" — run one chunk.
  try {
    const result = await runChunk(claimed, admin, {
      origin: req.nextUrl.origin,
      cronSecret: process.env.CRON_SECRET,
    });
    return NextResponse.json({
      status: result.result,
      run_id: result.run_id,
      processed: result.processed,
      total: result.total,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[scheduler/tick] runChunk error:", msg);
    await admin
      .from("task_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_message: msg })
      .eq("id", claimed.id);
    await admin
      .from("scheduled_tasks")
      .update({ status: "completed_with_errors" })
      .eq("id", claimed.task_id);
    await admin.from("task_logs").insert({
      task_id: claimed.task_id,
      action: "ERROR",
      details: `Runner exception: ${msg}`,
    });
    return NextResponse.json({ status: "failed", run_id: claimed.id, error: msg }, { status: 500 });
  }
}
