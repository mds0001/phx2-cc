import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validateAgentRequest } from "@/lib/agent-auth";

/**
 * POST /api/agent/heartbeat
 * Called by the agent every ~10 seconds.
 * Updates last_seen + status, returns any pending jobs.
 *
 * Headers: X-Agent-Id, X-Agent-Key
 * Body: { status?: 'online' | 'error' }
 * Response: { jobs: AgentJob[] }
 */
export async function POST(req: NextRequest) {
  const agent = await validateAgentRequest(req);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({})) as { status?: string };
    const status = body.status === "error" ? "error" : "online";

    const supabase = createAdminClient();

    // Update agent heartbeat
    await supabase
      .from("agents")
      .update({ last_seen: new Date().toISOString(), status, updated_at: new Date().toISOString() })
      .eq("id", agent.id);

    // Return pending jobs for this agent
    const { data: jobs } = await supabase
      .from("agent_jobs")
      .select("id, task_id, status, payload, created_at")
      .eq("agent_id", agent.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5);

    // Mark returned jobs as 'running'
    if (jobs && jobs.length > 0) {
      await supabase
        .from("agent_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .in("id", jobs.map((j) => j.id));
    }

    return NextResponse.json({ jobs: jobs ?? [] });
  } catch (err) {
    console.error("[agent/heartbeat] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
