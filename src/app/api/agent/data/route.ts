import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validateAgentRequest } from "@/lib/agent-auth";

/**
 * POST /api/agent/data
 * Agent POSTs a chunk of extracted rows for processing.
 * The cloud side forwards them to the appropriate destination
 * (e.g. Ivanti) via the existing proxy infrastructure.
 *
 * Headers: X-Agent-Id, X-Agent-Key
 * Body: {
 *   job_id:          string,
 *   chunk_index:     number,   // 0-based
 *   total_chunks:    number,
 *   rows:            object[], // extracted source rows
 * }
 * The destination config is read from the job payload stored
 * in agent_jobs.payload — not re-sent by the agent.
 *
 * Response: { ok: true, rows_accepted: number }
 */
export async function POST(req: NextRequest) {
  const agent = await validateAgentRequest(req);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { job_id, chunk_index, total_chunks, rows } = await req.json() as {
      job_id:       string;
      chunk_index:  number;
      total_chunks: number;
      rows:         Record<string, unknown>[];
    };

    if (!job_id || !Array.isArray(rows)) {
      return NextResponse.json({ error: "job_id and rows are required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Load the job to get the destination config
    const { data: job, error: jobErr } = await supabase
      .from("agent_jobs")
      .select("id, task_id, agent_id, payload")
      .eq("id", job_id)
      .eq("agent_id", agent.id)
      .single();

    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const payload = job.payload as {
      target_connection_id?: string;
      business_object?:      string;
      upsert_key?:           string;
      upsert_keys?:          string[];
      write_mode?:           string;
      mapping_slots?:        unknown[];
      ivanti_url?:           string;
      api_key?:              string;
      tenant_id?:            string;
    };

    // Log chunk receipt
    if (job.task_id) {
      await supabase.from("task_logs").insert({
        task_id:    job.task_id,
        action:     "AGENT_CHUNK",
        details:    `Chunk ${chunk_index + 1}/${total_chunks}: received ${rows.length} rows`,
        created_by: null,
      });
    }

    // If the job payload includes Ivanti destination config, forward to ivanti-proxy.
    // This is handled server-to-server — no CORS issues, credentials stay server-side.
    if (payload.ivanti_url && rows.length > 0) {
      const proxyUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/ivanti-proxy`;

      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ivantiUrl:            payload.ivanti_url,
          apiKey:               payload.api_key,
          tenantId:             payload.tenant_id,
          businessObject:       payload.business_object,
          upsertKey:            payload.upsert_key,
          upsertKeys:           payload.upsert_keys,
          method:               payload.write_mode === "create_only" ? "POST" : "PATCH",
          data:                 rows,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!proxyRes.ok) {
        const errText = await proxyRes.text();
        console.error("[agent/data] proxy error:", errText);
        return NextResponse.json({ error: "Destination write failed", detail: errText }, { status: 502 });
      }
    }

    return NextResponse.json({ ok: true, rows_accepted: rows.length });
  } catch (err) {
    console.error("[agent/data] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
