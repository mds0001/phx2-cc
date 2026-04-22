import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const MAX_RETRIES     = 3;
const BASE_DELAY_MS   = 1_000;

export interface AnalyzeRunBody {
  /** Human-readable task name */
  taskName: string;
  /** Current iteration number (1-based) */
  iteration: number;
  /** Maximum iterations allowed */
  maxIterations: number;
  /** Final status written by executeTask */
  finalStatus: string;
  /** Log entries from this run — caller should pre-filter to relevant entries */
  logs: { action: string; details: string; created_at: string }[];
  /** Server-side binary upload telemetry from /api/dev-log (BinaryRowEntry[]) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverTelemetry?: any[];
}

export interface AnalyzeRunResult {
  /** Should the loop fire the task again? */
  shouldRetry: boolean;
  /** One-line summary of what happened */
  analysis: string;
  /** Concrete suggestion for what might fix it */
  suggestion: string;
  /** Whether the failure looks transient (network, rate-limit, timeout) */
  isTransient: boolean;
}

async function callClaude(
  apiKey: string,
  system: string,
  user: string,
  maxTokens = 600,
): Promise<string> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      lastErr = new Error(`Anthropic HTTP ${res.status}: ${txt.slice(0, 200)}`);
      if ((res.status === 429 || res.status === 529) && attempt < MAX_RETRIES) continue;
      throw lastErr;
    }
    const data = await res.json();
    return data?.content?.[0]?.type === "text" ? (data.content[0].text as string) : "";
  }
  throw lastErr ?? new Error("callClaude: max retries exceeded");
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const body = (await req.json()) as AnalyzeRunBody;
    const { taskName, iteration, maxIterations, finalStatus, logs, serverTelemetry = [] } = body;

    // ── Build a compact task-log digest ──────────────────────────────────────
    // Prioritise: ERROR > WARN > SUMMARY > COMPLETED > everything else
    const priority = (action: string) =>
      action === "ERROR" ? 0
      : action === "WARN" ? 1
      : action === "SUMMARY" ? 2
      : action === "COMPLETED" ? 3
      : 4;

    const sorted = [...logs].sort((a, b) => priority(a.action) - priority(b.action));
    const errors   = sorted.filter((l) => l.action === "ERROR");
    const warnings = sorted.filter((l) => l.action === "WARN");
    const rest     = sorted.filter((l) => l.action !== "ERROR" && l.action !== "WARN").slice(0, 20);
    const digest   = [...errors, ...warnings, ...rest]
      .map((l) => `[${l.action}] ${(l.details ?? "").slice(0, 300)}`)
      .join("\n");

    // ── Build server telemetry digest (binary upload strategy results) ────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const telemetryDigest = serverTelemetry.slice(0, 20).map((entry: any) => {
      const attempts = (entry.attempts ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((a: any) => `    [${a.strategy}] ${a.detail} → HTTP ${a.status ?? "?"} (${a.result}) ok=${a.ok}`)
        .join("\n");
      return (
        `Row ${entry.rowIndex ?? "?"} recId=${entry.recId ?? "?"} field=${entry.field ?? "?"} ` +
        `size=${entry.sizeKB ?? "?"}KB mime=${entry.mimeType ?? "?"} uploaded=${entry.uploaded}\n` +
        (attempts ? attempts : "    (no strategy attempts recorded)")
      );
    }).join("\n---\n");

    const remainingAttempts = maxIterations - iteration;

    const system = `You are an automated task-run analyst for a data-integration pipeline that pushes IT asset records from Excel files into Ivanti ISM (an IT service management system). Your job is to read the run logs and server telemetry, then decide whether another attempt is worth making.

Key facts about this system:
- The task reads Excel rows, maps fields, then POSTs/PATCHes records via the Ivanti REST API.
- Binary/image fields are uploaded via a waterfall of strategies:
  - Strategy G: SOAP UpdateObject with BinaryData (the only confirmed method for varbinary(max) fields)
  - Strategy A0/A/B/C/F: REST-based fallbacks (multipart, base64 JSON, OData patch, attachment endpoint)
  - uploaded=true means a strategy succeeded; uploaded=false means all strategies failed for that field.
- Server telemetry shows per-row, per-field strategy-by-strategy HTTP status codes and results.
- HTTP 401/403 = auth failure — NOT transient, do not retry.
- HTTP 404 on SOAP endpoint = wrong URL variant, different endpoint may work — IS worth retrying.
- HTTP 429 / "rate limit" / "timeout" / "ECONNRESET" / "ENOTFOUND" = transient, retry.
- HTTP 500 from Ivanti on binary upload often means wrong data format — may not be transient.
- A SUMMARY log line summarises rows created/updated/skipped/errored.
- finalStatus "completed" = zero errors, task is fixed. Do not retry.
- finalStatus "completed_with_warnings" = non-fatal issues. Assess whether retry makes sense.
- finalStatus "completed_with_errors" = something failed. Assess based on error type.

Respond with ONLY a JSON object — no markdown, no explanation:
{
  "shouldRetry": boolean,
  "analysis": "one concise sentence describing what happened",
  "suggestion": "one concise sentence on what might fix it, or 'No further action needed' if fixed",
  "isTransient": boolean
}`;

    const user = `Task: "${taskName}"
Iteration: ${iteration} of ${maxIterations} (${remainingAttempts} attempt${remainingAttempts !== 1 ? "s" : ""} remaining)
Final status: ${finalStatus}

=== TASK LOGS (most important first) ===
${digest || "(no task logs captured)"}

=== SERVER TELEMETRY — binary upload strategy results ===
${telemetryDigest || "(no server telemetry captured — dev-log may be empty or binary uploads not attempted)"}

Should this task be retried?`;

    const raw = await callClaude(apiKey, system, user);
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    let result: AnalyzeRunResult;
    try {
      result = JSON.parse(cleaned) as AnalyzeRunResult;
    } catch {
      // Fallback if Claude didn't return clean JSON
      const isFixed = finalStatus === "completed";
      result = {
        shouldRetry: !isFixed && iteration < maxIterations,
        analysis: isFixed ? "Task completed successfully." : "Analysis parse error — defaulting based on status.",
        suggestion: isFixed ? "No further action needed." : "Retry and inspect logs.",
        isTransient: false,
      };
    }

    // Hard overrides: never retry if at max iterations, or if already fixed
    if (finalStatus === "completed") {
      result.shouldRetry = false;
      result.analysis = result.analysis || "Task completed successfully with no errors.";
      result.suggestion = "No further action needed.";
    }
    if (iteration >= maxIterations) {
      result.shouldRetry = false;
    }

    console.log(`[ai-analyze-run] "${taskName}" iter=${iteration}/${maxIterations} status=${finalStatus} shouldRetry=${result.shouldRetry} isTransient=${result.isTransient}`);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-analyze-run] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
