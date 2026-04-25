# Threads Remote Agent — Server Integration Guide

This document describes everything the Threads cloud platform needs to know to integrate with the on-premise Threads Remote Agent. Copy it into the Threads repo and treat it as the wire-level contract.

## Deployment model

- The agent is a single Go-built `threads-agent.exe` (~7 MB) running on a customer's Windows host as the `threads-agent` Windows Service (Local System, automatic start, 60 s restart-on-failure).
- It is strictly outbound-HTTPS. Threads opens **no** inbound ports.
- The agent polls the Threads platform on a fixed interval (default 10 s, configurable via `poll_interval_seconds`) and pulls down work to execute.
- Each agent stores `agent_id` + `api_key` locally in `agent-config.json` (sibling to the .exe). The api_key is never re-transmitted; only the headers below.

## Authentication

Two distinct credential types:

| Credential | Purpose | Lifetime |
|---|---|---|
| **Registration token** | One-time secret you mint server-side, given to the customer via the UI/email. The agent exchanges it once via `/api/agent/register` and discards it. | One-shot. After exchange, it must be marked used and rejected on reuse. |
| **Agent ID + API key** | Issued by `/api/agent/register`. Sent on every subsequent request as `X-Agent-Id` and `X-Agent-Key` headers. | Lifetime of the agent registration. |

All endpoints other than `/api/agent/register` **must** require both headers. On invalid/expired creds, return `401`. The agent treats `401` as a fatal error: it logs `Credentials rejected — re-register the agent` and the service exits with code 5 (recovery actions will keep restarting it, where it will keep failing — escalation signal for the customer).

## Endpoints

All paths are under the `base_url` the customer enters during registration. All bodies are JSON; agent always sends `Content-Type: application/json`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/agent/register` | token in body | Exchange one-time token for credentials |
| POST | `/api/agent/heartbeat` | headers | Health ping + job dispatch + control commands |
| POST | `/api/agent/data` | headers | Upload one chunk of query result rows |
| POST | `/api/agent/file-result` | headers | Upload a file body (read_file jobs) |
| POST | `/api/agent/job-complete` | headers | Final status report for a job |

### `POST /api/agent/register`

Request:
```json
{
  "token": "the-one-time-token",
  "name": "DESKTOP-ABCD123",
  "version": "1.0.0",
  "platform": "windows"
}
```

`name` is the host's `os.Hostname()` and `version` is the agent build version. Use them for your agent inventory UI.

Response (200):
```json
{
  "agent_id": "agt_...",
  "api_key": "key_...",
  "customer_id": "cust_..."
}
```

Other status codes the agent handles: `401` → token invalid / expired / already used. Anything else is reported as `unexpected status N from server` and the customer must retry.

### `POST /api/agent/heartbeat`

Sent every `poll_interval_seconds`. Request:
```json
{ "status": "online" }
```

Response (200):
```json
{
  "jobs": [ /* zero or more Job objects */ ],
  "uninstall": false
}
```

**Server contract for `jobs`:**
- Return any jobs the server has queued for this `agent_id`.
- The server **must** transition each returned job from `queued` → `running` *before* responding. The agent does not acknowledge receipt — the heartbeat response IS the dispatch. This avoids double-execution if a heartbeat reply is lost in flight: the server has already moved the job to `running` and will not re-dispatch it on the next poll. Implement timeout/orphan reaping server-side (e.g., if a `running` job has no `job-complete` after N minutes, mark `failed` and re-queue if appropriate).
- The agent runs jobs concurrently with a worker pool of 4 by default. If the response contains more jobs than free worker slots, extras are skipped with a warning and will be re-fetched if you keep returning them on subsequent heartbeats. **Recommended:** cap each heartbeat response at ~4 jobs.

**Control: `uninstall`**
- Setting `"uninstall": true` instructs the agent to remove itself. On receipt, the agent:
  1. Marks the Windows Service for deletion via the SCM.
  2. Deletes `agent-config.json` (wiping the api_key).
  3. Stops the service cleanly. The SCM finalizes deletion when the process exits.
- Logs (`agent.log`) and the binary itself remain on disk. Whoever is doing the actual machine cleanup can remove them; the agent cannot delete its own running .exe.
- After commanding uninstall, the server should mark the agent record retired and reject future heartbeats with `401`.

### Job object

```json
{
  "id": "job_...",
  "task_id": "task_...",
  "status": "running",
  "created_at": "2026-04-25T08:00:00Z",
  "payload": {
    "type": "odbc",
    "source": {
      "type": "odbc",
      "connection_string": "Driver={SQL Server};Server=...;...",
      "query": "SELECT * FROM dbo.Tickets WHERE ModifiedDate > ...",
      "delta_key": "TicketID"
    },
    "target_connection_id": "conn_...",
    "business_object": "tickets",
    "upsert_key": "ticket_id",
    "write_mode": "upsert",
    "ivanti_url": "https://...",
    "api_key": "...",
    "tenant_id": "..."
  }
}
```

The `payload.type` switches the agent's behavior. Currently supported:

| `payload.type` | Agent behavior |
|---|---|
| `"odbc"` (or any value other than `read_file`) | Run the 5-phase ODBC pipeline (query → delta filter → chunk → upload → complete). |
| `"read_file"` | Read the file at `payload.file_path` from disk and POST it base64-encoded to `/api/agent/file-result`. |

`payload.target_connection_id`, `business_object`, `upsert_key`, `write_mode`, `ivanti_url`, `api_key`, `tenant_id` are passed through unchanged — the agent does not interpret them. They exist so the server side can route the uploaded rows to the correct downstream destination.

### `POST /api/agent/data`

ODBC job rows arrive here, in order, one chunk per call.

```json
{
  "job_id": "job_...",
  "chunk_index": 0,
  "total_chunks": 7,
  "rows": [ { /* free-form ODBC row map */ }, ... ]
}
```

- Default chunk size is 500 rows (configurable per agent via `chunk_size`).
- Chunks are uploaded **sequentially**, never in parallel, in `chunk_index` order from `0` to `total_chunks - 1`.
- The server must return `200` for accepted chunks. Any non-200 triggers a single retry after 5 s. If the retry also fails the entire job fails — the server should not have to handle partial state, but be aware that chunks `0..i-1` may already have been written before chunk `i` failed. Treat the job as atomic only after `job-complete` arrives with `status: "completed"`.

### `POST /api/agent/file-result`

For `read_file` jobs only.

```json
{
  "job_id": "job_...",
  "file_b64": "<base64 of file bytes>",
  "file_name": "report.csv"
}
```

Single POST per job (no chunking on the file path). Return `200` on accept.

### `POST /api/agent/job-complete`

Sent exactly once per job, after either successful upload or an unrecoverable failure.

Success:
```json
{
  "job_id": "job_...",
  "status": "completed",
  "result": {
    "rows_extracted": 12500,
    "rows_sent": 137,
    "duration_ms": 4218
  }
}
```

`rows_sent` < `rows_extracted` is normal when delta filtering dropped unchanged rows.

Failure:
```json
{
  "job_id": "job_...",
  "status": "failed",
  "error": "ODBC query failed: <driver message>"
}
```

The server should accept both (`200`) and update the job record. The agent does not retry `job-complete`; if the call fails, the server's orphan reaper is the only recovery path. Any non-200 here is logged at `WARN` but otherwise ignored by the agent.

## Delta state

Delta filtering is **agent-local**. The server's only role:
- Set `payload.source.delta_key` to a column name on the row that uniquely identifies it (e.g. `"TicketID"`).
- Same `task_id` across heartbeats means "same delta cache." Changing `task_id` resets the cache for that stream.

The agent stores SHA-256 hashes per row keyed by `delta_key` value in `delta-cache-{task_id}.json` next to the .exe. The server has no visibility into this and should not try to manage it. To force a full resend, issue the job under a fresh `task_id`.

## Error & retry semantics — server's view

| Server returns | Agent behavior |
|---|---|
| `200` on heartbeat | Normal dispatch loop continues. |
| `401` on any authenticated endpoint | Service exits with code 5. Customer must re-register. Treat this as the eject command; only return `401` when you really mean it. |
| `5xx` / network error on heartbeat | Logged, retried on next tick. Do not assume the agent is dead. |
| Non-200 on `/api/agent/data` | One retry after 5 s. If that fails, the entire job is failed. Server should be idempotent on chunk POSTs (same `job_id` + `chunk_index` could arrive twice). |
| Non-200 on `/api/agent/job-complete` | Logged, no retry. Use server-side orphan reaping. |

## Cadence & sizing assumptions

- Heartbeat: 1 every `poll_interval_seconds` (default 10 s) per agent.
- Concurrent jobs per agent: 4 by default. Don't return more than that on one heartbeat.
- Per-job upload: serial chunks of 500 rows each. A 100 k-row job is 200 sequential `/api/agent/data` calls.
- HTTP client timeout: 30 s per request.

## Versioning

- The agent reports its `version` only at registration time. There is no version field in heartbeats today. If you need version-gated behavior, capture and store the version at registration and key off the agent record server-side.
- Currently `1.0.0`. The `uninstall` heartbeat field was added in this release; older agents will silently ignore it (the field is just absent from their `heartbeatResponse` struct, so unmarshal succeeds and the flag has no effect).

## Security notes (informational)

- TLS validation is enforced on the agent (no `InsecureSkipVerify`). The customer's `base_url` must serve a valid certificate chain.
- The agent never transmits ODBC connection strings outbound. The server includes them in `payload.source.connection_string` going *to* the agent; the agent uses them locally and discards.
- `agent-config.json` is written `0600`. The api_key in that file is the only persistent credential.
