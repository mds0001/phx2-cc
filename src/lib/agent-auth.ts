import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase-admin";

export function generateApiKey(): string {
  return randomBytes(32).toString("hex"); // 64-char hex string
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Validates X-Agent-Id and X-Agent-Key headers.
 * Returns the agent row on success, null on failure.
 */
export async function validateAgentRequest(request: Request) {
  const agentId  = request.headers.get("X-Agent-Id");
  const agentKey = request.headers.get("X-Agent-Key");

  if (!agentId || !agentKey) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("agents")
    .select("id, customer_id, name, status, api_key_hash")
    .eq("id", agentId)
    .single();

  if (error || !data) return null;
  if (hashApiKey(agentKey) !== data.api_key_hash) return null;

  return data;
}
