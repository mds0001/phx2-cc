# Scheduler Times Out Waiting for `read_file` Agent Result

## Symptom

When a scheduled task fires a `read_file` job, the scheduler reports:

```
[3:28:08 PM] AGENT_COMPLETE: Agent job completed
[3:29:08 PM] ERROR: [S1/1] Timed out waiting for agent to deliver file (60s). Is the agent online?
[3:29:08 PM] COMPLETED: [S1/1] Completed with errors
[3:29:08 PM] SUMMARY: Duration: 1m 2s | Rows Processed: 1 | Errors: 1
```

The scheduler observes the job marked completed, then waits 60 seconds for a file to appear, then times out.

## The Agent Side Is Fine

`threads-agent.exe` (rebuilt 2026-04-23 15:27, running as PID 26344, Windows service `threads-agent`) executes the new `read_file` handler exactly as specified in `agent-read-file-requirement.md`.

Agent log for job `f76525c5-e063-4d38-8580-0736a2d7a2c2`:

```
[2026-04-23 15:28:09] [INFO] Job f76525c5-... started
[2026-04-23 15:28:09] [INFO] Job f76525c5-...: read_file C:\Users\mdsto\projects\phx2\MikeCoSKU.xlsx
[2026-04-23 15:28:09] [INFO] Job f76525c5-...: Uploaded 5053 bytes of MikeCoSKU.xlsx
[2026-04-23 15:28:09] [INFO] Job f76525c5-...: Completed in 670ms
```

What the log proves:

1. The agent picked up the job and read 5053 bytes from disk.
2. `POST /api/agent/file-result` with `{ job_id, file_b64, file_name }` returned **HTTP 200** — the agent only logs `Uploaded N bytes` on a 200 response. Any non-200 logs `Upload failed: server returned <code>` and triggers a `failed` job-complete instead.
3. `POST /api/agent/job-complete` with the spec-mandated bare body `{ job_id: "f76525c5-...", status: "completed" }` (no `result` field — see "Earlier Misfire" below) returned **HTTP 200**.
4. End-to-end took 670ms. The agent never saw an error.

## Where the Bug Must Be

The scheduler polls `agent_jobs.result.file_b64` (per the end-to-end flow diagram in `agent-read-file-requirement.md` lines 188–215). Three places this can break, all server-side:

### 1. `/api/agent/file-result` accepts the POST but doesn't persist the bytes (most likely)

The handler returns 200 OK to the agent but either doesn't write to `agent_jobs.result` at all, writes to a different column, or writes under a different JSON key than `file_b64` / `file_name`.

### 2. RLS / authorization silently drops the write

The agent authenticates with `X-Agent-Id` + `X-Agent-Key`. If the server uses a row-level-security policy keyed on the agent and the policy is misconfigured, the UPDATE may run with zero rows affected while the endpoint still returns 200.

### 3. `job-complete` clobbers `result` after `file-result` writes it

The agent calls `file-result` first, then `job-complete`. If the `job-complete` handler does an unconditional `UPDATE agent_jobs SET result = $newResult` (even with the bare `{job_id, status}` body the agent now sends), it could null/overwrite the file bytes. The agent has already been changed to send no `result` field for read_file completions, so the server should not be assigning anything to that column. Verify the server handler treats `result` as additive, not a wholesale replace.

## Diagnostic — Run This First

In the Supabase SQL editor:

```sql
select id, status, result, updated_at
from agent_jobs
where id = 'f76525c5-e063-4d38-8580-0736a2d7a2c2';
```

Interpret the result:

| What you see | What it means |
|---|---|
| `result` is `null` or `{}` | `/api/agent/file-result` is not persisting — bug case 1 or 2 |
| `result` has `rows_extracted` / `rows_sent` keys but no `file_b64` | `job-complete` clobbered the file bytes — bug case 3 |
| `result.file_b64` is present and non-empty | Scheduler is reading the wrong place — check the scheduler poll query |

## Fix Targets (Server Code)

Inspect, in order:

1. The handler at route `POST /api/agent/file-result`. Confirm it does an `UPDATE agent_jobs SET result = jsonb_set(coalesce(result,'{}'::jsonb), '{file_b64}', to_jsonb($1::text))` (or equivalent) and that the WHERE clause matches on the authenticated agent. Add logging.
2. The handler at route `POST /api/agent/job-complete`. Confirm it only writes `status` (and `error` when failed) for `read_file` jobs and does NOT touch `result`. If it always writes `result`, switch to a merge / `jsonb_set` instead of a replace.
3. The scheduler poll — confirm it reads `agent_jobs.result->>'file_b64'` (or whatever the column actually is). If it's reading from a different table (`agent_files`?), `/api/agent/file-result` needs to write there.

## Acceptance

After the fix, the same SQL query should show `result.file_b64` populated within ~1s of the agent's `Uploaded N bytes` log line, and the scheduler should pick it up well inside the 60s window.

## Earlier Misfire (already corrected on the agent)

The first attempt sent `result: { rows_extracted: 0, rows_sent: 0, duration_ms }` on every successful `job-complete`, including `read_file`. That object overwrote the file bytes the `/api/agent/file-result` endpoint had just stored. The agent now sends a bare `{job_id, status: "completed"}` per the spec for read_file completions only — the ODBC pipeline still sends the row-count summary as before. Despite that fix, the scheduler still times out, which is what makes 1 / 2 above the leading suspects.
