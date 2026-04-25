import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * POST /api/agent/uninstall
 * Body: { agent_id: string }
 *
 * Sets pending_uninstall=true on the agent record.
 * The next heartbeat from that agent will receive uninstall:true
 * and the server will immediately mark the agent as retired.
 * Requires authenticated admin user.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { agent_id } = await req.json() as { agent_id?: string };
    if (!agent_id) return NextResponse.json({ error: "agent_id required" }, { status: 400 });

    const admin = createAdminClient();

    // Verify agent exists and is not already retired
    const { data: agent, error: fetchErr } = await admin
      .from("agents")
      .select("id, name, status")
      .eq("id", agent_id)
      .single();

    if (fetchErr || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    if (agent.status === "retired") {
      return NextResponse.json({ error: "Agent is already retired" }, { status: 409 });
    }

    await admin
      .from("agents")
      .update({ pending_uninstall: true, updated_at: new Date().toISOString() })
      .eq("id", agent_id);

    return NextResponse.json({ ok: true, agent_id, name: agent.name });
  } catch (err) {
    console.error("[agent/uninstall] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
