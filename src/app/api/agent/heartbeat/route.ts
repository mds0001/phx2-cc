import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validateAgentRequest } from "@/lib/agent-auth";

/**
 * POST /api/agent/heartbeat
 * Called by the agent every poll_interval_seconds (default 10s).
 * Updates last_seen + status, returns pending jobs.
 *
 * If pending_uninstall is set, returns { jobs: [], uninstall: true }
 * and immediately marks the agent as retired. Future heartbeats from
 * a retired agent will receive 401 (validateAgentRequest rejects them).
 *
 * Headers: X-Agent-Id, X-Agent-Key
 * Body:    { status?: "online" | "error" }
 * Response: { jobs: AgentJob[], uninstall: boolean }
 */
export async function POST(req: NextRequest) {
  const agent = await validateAgentRequest(req);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({})) as { status?: string };
    const reportedStatus = body.status === "error" ? "error" : "online";

    const supabase = createAdminClient();

    // Fetch full agent record to check pending_uninstall flag
    const { data: agentRecord } = await supabase
      .from("agents")
      .select("pending_uninstall")
      .eq("id", agent.id)
      .single();

    const shouldUninstall = agentRecord?.pending_uninstall === true;

    if (shouldUninstall) {
      // Mark retired immediately — future heartbeats will get 401
      await supabase
        .from("agents")
        .update({
          status:            "retired",
          pending_uninstall: false,
          last_seen:         new Date().toISOString(),
          updated_at:        new Date().toISOString(),
        })
        .eq("id", agent.id);

      return NextResponse.json({ jobs: [], uninstall: true });
    }

    // Normal heartbeat — update last_seen and status
    await supabase
      .from("agents")
      .update({
        last_seen:  new Date().toISOString(),
        status:     reportedStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", agent.id);

    // Return pending jobs for this agent (cap at 4 per spec)
    const { data: jobs } = await supabase
      .from("agent_jobs")
      .select("id, task_id, status, payload, created_at")
      .eq("agent_id", agent.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(4);

    // Mark returned jobs as running before responding — prevents double-dispatch
    if (jobs && jobs.length > 0) {
      await supabase
        .from("agent_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .in("id", jobs.map((j) => j.id));
    }

    return NextResponse.json({ jobs: jobs ?? [], uninstall: false });
  } catch (err) {
    console.error("[agent/heartbeat] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
