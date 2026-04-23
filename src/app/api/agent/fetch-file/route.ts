import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

/**
 * POST /api/agent/fetch-file
 * Called by the Scheduler (browser) to request that an agent read a local file.
 *
 * Body: { agent_id: string, file_path: string, task_id?: string }
 * Response: { job_id: string }
 *
 * The agent polls agent_jobs, picks up the job, reads the file,
 * POSTs the base64 bytes to /api/agent/file-result, then calls /api/agent/job-complete.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { agent_id, file_path, task_id } = await req.json() as {
    agent_id:  string;
    file_path: string;
    task_id?:  string;
  };

  if (!agent_id || !file_path) {
    return NextResponse.json({ error: "agent_id and file_path required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify the agent exists and is online
  const { data: agent } = await admin
    .from("agents")
    .select("id, name, status, last_seen")
    .eq("id", agent_id)
    .single();

  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const lastSeen = agent.last_seen ? new Date(agent.last_seen).getTime() : 0;
  const stale    = Date.now() - lastSeen > 60_000;
  if (agent.status !== "online" || stale) {
    return NextResponse.json({ error: `Agent "${agent.name}" is offline` }, { status: 422 });
  }

  // Create the agent job
  const { data: job, error } = await admin
    .from("agent_jobs")
    .insert({
      agent_id,
      task_id:    task_id ?? null,
      status:     "pending",
      payload:    { type: "read_file", file_path },
    })
    .select("id")
    .single();

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
  }

  return NextResponse.json({ job_id: job.id });
}
