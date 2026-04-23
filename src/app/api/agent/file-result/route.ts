import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validateAgentRequest } from "@/lib/agent-auth";

/**
 * POST /api/agent/file-result
 * Agent posts the base64-encoded contents of a file it was asked to read.
 *
 * Headers: X-Agent-Id, X-Agent-Key
 * Body: { job_id: string, file_b64: string, file_name: string }
 *
 * Stores the result in agent_jobs.result so the scheduler can retrieve it.
 */
export async function POST(req: NextRequest) {
  const agent = await validateAgentRequest(req);
  if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { job_id, file_b64, file_name } = await req.json() as {
    job_id:    string;
    file_b64:  string;
    file_name: string;
  };

  if (!job_id || !file_b64) {
    return NextResponse.json({ error: "job_id and file_b64 required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify the job belongs to this agent
  const { data: job } = await admin
    .from("agent_jobs")
    .select("id, agent_id")
    .eq("id", job_id)
    .eq("agent_id", agent.id)
    .single();

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Store result and mark completed
  const { error } = await admin
    .from("agent_jobs")
    .update({
      status:       "completed",
      result:       { file_b64, file_name },
      completed_at: new Date().toISOString(),
    })
    .eq("id", job_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
