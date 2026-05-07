import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      run_id?: string;
      task_id?: string;
    };

    const admin = createAdminClient();

    // Resolve target run: explicit run_id wins; otherwise the live run for task_id.
    let runId = body.run_id ?? null;
    if (!runId && body.task_id) {
      const { data: liveRun } = await admin
        .from("task_runs")
        .select("id, task_id")
        .eq("task_id", body.task_id)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (liveRun) runId = liveRun.id;
    }
    if (!runId) {
      return NextResponse.json({ error: "No active run found" }, { status: 404 });
    }

    // Verify the requesting user can see the underlying task — RLS on the user's
    // session client enforces this; we do the read on the user's client to leverage it.
    const { data: run } = await admin
      .from("task_runs")
      .select("id, task_id, status")
      .eq("id", runId)
      .single();
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const { data: taskCheck, error: taskErr } = await supabase
      .from("scheduled_tasks")
      .select("id")
      .eq("id", run.task_id)
      .single();
    if (taskErr || !taskCheck) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Pending → cancel immediately (no work done yet).
    // Running → cancelling (the tick checks at row boundaries and finalises).
    // Already terminal → no-op.
    if (run.status === "pending") {
      await admin
        .from("task_runs")
        .update({ status: "cancelled", finished_at: new Date().toISOString() })
        .eq("id", run.id);
      // Legacy UI compat — start route flipped scheduled_tasks.status to 'active';
      // revert it so the badge doesn't get stuck.
      await admin
        .from("scheduled_tasks")
        .update({ status: "cancelled" })
        .eq("id", run.task_id);
    } else if (run.status === "running") {
      await admin
        .from("task_runs")
        .update({ status: "cancelling" })
        .eq("id", run.id);
    }

    return NextResponse.json({ run_id: run.id, status: run.status === "pending" ? "cancelled" : "cancelling" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[scheduler/cancel] exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
