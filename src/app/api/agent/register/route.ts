import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { generateApiKey, hashApiKey } from "@/lib/agent-auth";

/**
 * POST /api/agent/register
 * Called by the agent on first run with a one-time registration token.
 * Returns the agent's scoped API key — only returned once, store it locally.
 *
 * Body: { token: string, name: string, version: string, platform?: string }
 * Response: { agent_id: string, api_key: string, customer_id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { token, name, version, platform = "windows" } = await req.json() as {
      token:     string;
      name:      string;
      version:   string;
      platform?: string;
    };

    if (!token || !name || !version) {
      return NextResponse.json({ error: "token, name, and version are required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Validate the registration token
    const { data: reg, error: regErr } = await supabase
      .from("agent_registration_tokens")
      .select("id, customer_id, expires_at, used_at, created_by")
      .eq("token", token)
      .single();

    if (regErr || !reg) {
      return NextResponse.json({ error: "Invalid registration token" }, { status: 401 });
    }
    if (reg.used_at) {
      return NextResponse.json({ error: "Registration token already used" }, { status: 401 });
    }
    if (new Date(reg.expires_at) < new Date()) {
      return NextResponse.json({ error: "Registration token expired" }, { status: 401 });
    }

    // Generate scoped API key
    const apiKey     = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    // Create the agent record
    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .insert({
        customer_id:  reg.customer_id,
        name,
        version,
        platform,
        api_key_hash: apiKeyHash,
        status:       "online",
        last_seen:    new Date().toISOString(),
        created_by:   reg.created_by,
      })
      .select("id, customer_id")
      .single();

    if (agentErr || !agent) {
      console.error("[agent/register] insert error:", agentErr);
      return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
    }

    // Mark token as used
    await supabase
      .from("agent_registration_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", reg.id);

    return NextResponse.json({
      agent_id:    agent.id,
      api_key:     apiKey,  // plaintext — only time it's ever sent
      customer_id: agent.customer_id,
    });
  } catch (err) {
    console.error("[agent/register] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
