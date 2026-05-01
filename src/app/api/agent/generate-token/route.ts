import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { randomBytes } from "crypto";

/**
 * POST /api/agent/generate-token
 * Generates a one-time registration token for a new agent.
 * Admin only. Token expires in 1 hour.
 *
 * Body: { customer_id: string, label?: string }
 * Response: { token: string, expires_at: string }
 */
export async function POST(req: NextRequest) {
  try {
    // Verify caller is an authenticated admin
    const supabaseUser = await createClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabaseUser
      .from("profiles")
      .select("user_type")
      .eq("id", user.id)
      .single();

    if (profile?.user_type !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { customer_id } = await req.json() as { customer_id: string };
    if (!customer_id) {
      return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
    }

    const token      = randomBytes(24).toString("hex"); // 48-char hex
    const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("agent_registration_tokens")
      .insert({ token, customer_id, created_by: user.id, expires_at });

    if (error) {
      console.error("[agent/generate-token] insert error:", error);
      return NextResponse.json({ error: "Failed to create token" }, { status: 500 });
    }

    return NextResponse.json({ token, expires_at });
  } catch (err) {
    console.error("[agent/generate-token] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
