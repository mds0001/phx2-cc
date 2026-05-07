import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createPendingRun } from "@/lib/taskRunner";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      task_id?: string;
      row_filter?: number[];
    };
    if (!body.task_id) {
      return NextResponse.json({ error: "task_id required" }, { status: 400 });
    }

    // RLS-aware load — confirms the user can see this task.
    const { data: task, error: taskErr } = await supabase
      .from("scheduled_tasks")
      .select("*")
      .eq("id", body.task_id)
      .single();
    if (taskErr || !task) {
      return NextResponse.json({ error: "Task not found or access denied" }, { status: 404 });
    }

    const admin = createAdminClient();
    const result = await createPendingRun({
      admin,
      task,
      triggeredBy: user.id,
      rowFilter: body.row_filter ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, run_id: result.live_run_id },
        { status: 409 }
      );
    }

    return NextResponse.json({ run_id: result.run_id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[scheduler/start] exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
