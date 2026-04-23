import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validateAgentRequest } from "@/lib/agent-auth";

/**
 * POST /api/agent/job-complete
 * Agent signals a job has finished (success or failure).
 * Updates the job record and the parent scheduled task status.
 *
 * Headers: X-Agent-Id, X-Agent-Key
 * Body: {
 *   job_id:  string,
 *   status:  'completed' | 'failed' | 'cancelled',
 *   result?: { rows_extracted: number, rows_sent: number, duration_ms: number },
 *   error?:  string
 * }
 */
export async function POST(req: NextRequest) {
  const agent = await validateAgentRequest(req);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { job_id, status, result, error: jobError } = await req.json() as {
      job_id:  string;
      status:  "completed" | "failed" | "cancelled";
      result?: { rows_extracted: number; rows_sent: number; duration_ms: number };
      error?:  string;
    };

    if (!job_id || !status) {
      return NextResponse.json({ error: "job_id and status are required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Verify the job belongs to this agent
    const { data: job, error: jobFetchErr } = await supabase
      .from("agent_jobs")
      .select("id, task_id, agent_id")
      .eq("id", job_id)
      .eq("agent_id", agent.id)
      .single();

    if (jobFetchErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Update job record — only overwrite `result` if the caller explicitly
    // provided one. Omitting it preserves any data already written by a
    // prior call (e.g. /api/agent/file-result storing file_b64).
    const jobUpdate: Record<string, unknown> = {
      status,
      error:        jobError ?? null,
      completed_at: new Date().toISOString(),
    };
    if (result !== undefined) {
      jobUpdate.result = result;
    }

    await supabase
      .from("agent_jobs")
      .update(jobUpdate)
      .eq("id", job_id);

    // Update the parent scheduled task status
    if (job.task_id) {
      const taskStatus = status === "completed"  ? "completed"
                       : status === "failed"     ? "completed_with_errors"
                       : "cancelled";

      await supabase
        .from("scheduled_tasks")
        .update({ status: taskStatus, updated_at: new Date().toISOString() })
        .eq("id", job.task_id);

      // Write a task log entry
      await supabase.from("task_logs").insert({
        task_id:    job.task_id,
        action:     status === "completed" ? "AGENT_COMPLETE" : "AGENT_FAILED",
        details:    result
          ? `Agent job ${status}. Extracted: ${result.rows_extracted}, Sent: ${result.rows_sent}, Duration: ${(result.duration_ms / 1000).toFixed(1)}s`
          : (jobError 
          ?? `Agent job ${status}`),
        created_by: null,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[agent/job-complete] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
