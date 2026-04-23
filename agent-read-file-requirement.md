# Agent: `read_file` Job Handler — Implementation Requirement

## Background

The Threads agent (`threads-agent.exe`) communicates with the Threads cloud backend via a job queue stored in the `agent_jobs` Supabase table. The agent currently polls this table for pending jobs and handles job types such as ODBC data extraction and Ivanti writes.

A new job type — `read_file` — has been added to the server side. The agent currently does **not** handle this job type and falls through to its ODBC handler, producing the error:

```
ping connection: SQLDriverConnect: {IM002} [Microsoft][ODBC Driver Manager] Data source name not found and no default driver specified
```

This document specifies exactly what the agent must do when it encounters a `read_file` job.

---

## How the Agent Job Queue Works (existing pattern)

1. The agent polls `GET /api/agent/heartbeat` (or similar) to pick up pending jobs.
2. Each job row in `agent_jobs` has a `payload` JSON field that contains a `type` discriminator.
3. The agent inspects `payload.type` and dispatches to the appropriate handler.
4. On completion the agent calls `POST /api/agent/job-complete` with the outcome.

The agent authenticates all requests using two custom headers:
- `X-Agent-Id: <agent UUID>`
- `X-Agent-Key: <raw API key>`

These are the same credentials already used for heartbeat and all other agent→cloud calls.

---

## New Job Type: `read_file`

### Job payload shape (from `agent_jobs.payload`)

```json
{
  "type": "read_file",
  "file_path": "C:\\Users\\mdsto\\projects\\phx2\\MikeCoSKU.xlsx"
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `string` | Always `"read_file"` for this handler |
| `file_path` | `string` | Absolute path on the local machine where the agent is running |

---

## Required Agent Behaviour

When the agent picks up a job where `payload.type === "read_file"`, it must:

### Step 1 — Read the file

Read the entire file at `payload.file_path` into memory as raw bytes. This file will typically be an `.xlsx` file but the handler must be file-type agnostic — just read bytes, do not parse.

If the file does not exist or cannot be read, skip to **Step 4 (failure path)**.

### Step 2 — Base64-encode the bytes

Encode the raw bytes as a standard Base64 string (no line breaks).

### Step 3 — POST result to `/api/agent/file-result`

```
POST https://<app-host>/api/agent/file-result
Headers:
  Content-Type: application/json
  X-Agent-Id:  <agent id>
  X-Agent-Key: <agent api key>

Body:
{
  "job_id":    "<the job UUID from agent_jobs.id>",
  "file_b64":  "<base64-encoded file bytes>",
  "file_name": "<just the filename portion, e.g. MikeCoSKU.xlsx>"
}
```

`file_name` should be the bare filename (not the full path). Extract it from `file_path` using whatever path utility is available in the agent's language.

The server will respond `{ "ok": true }` on success. If the server returns an error, treat it as a failure (see Step 4).

### Step 4 — Call `/api/agent/job-complete`

Always call this endpoint to signal the job is finished, regardless of success or failure.

**Success:**
```
POST https://<app-host>/api/agent/job-complete
Headers:
  Content-Type: application/json
  X-Agent-Id:  <agent id>
  X-Agent-Key: <agent api key>

Body:
{
  "job_id": "<job UUID>",
  "status": "completed"
}
```

**Failure (file not found, read error, or file-result POST failed):**
```
Body:
{
  "job_id": "<job UUID>",
  "status": "failed",
  "error":  "<human-readable error message, e.g. 'File not found: C:\\path\\to\\file.xlsx'>"
}
```

---

## Dispatch Logic (where to add the check)

Find the section of agent code that inspects `payload.type` (or equivalent job type field) and dispatches to a handler. Add a new branch **before** the ODBC/default handler so that `read_file` jobs never reach ODBC code:

```
if payload.type == "read_file":
    handle_read_file(job)
else if payload.type == "odbc" (or existing default):
    handle_odbc(job)
```

The exact syntax depends on the agent's implementation language.

---

## Server Endpoints Reference

All base URLs use the same host the agent already talks to (the `THREADS_API_URL` or equivalent config value in the agent).

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/agent/file-result` | POST | X-Agent-Id + X-Agent-Key | Upload base64 file bytes |
| `/api/agent/job-complete` | POST | X-Agent-Id + X-Agent-Key | Signal job done/failed |

### `/api/agent/file-result` — full contract

**Request:**
```json
{
  "job_id":    "f88f8308-3cac-4e8a-9b1a-7b71d76afb7d",
  "file_b64":  "UEsDBBQAAAAI...",
  "file_name": "MikeCoSKU.xlsx"
}
```

**Success response (200):**
```json
{ "ok": true }
```

**Error responses:**
- `401` — invalid agent credentials
- `404` — job not found or doesn't belong to this agent
- `400` — missing required fields
- `500` — server error

### `/api/agent/job-complete` — full contract

**Request:**
```json
{
  "job_id": "f88f8308-3cac-4e8a-9b1a-7b71d76afb7d",
  "status": "completed"
}
```

or on failure:
```json
{
  "job_id": "f88f8308-3cac-4e8a-9b1a-7b71d76afb7d",
  "status": "failed",
  "error":  "File not found: C:\\Users\\mdsto\\projects\\phx2\\MikeCoSKU.xlsx"
}
```

**Success response (200):**
```json
{ "ok": true }
```

---

## End-to-End Flow Diagram

```
Scheduler (browser)
  │
  ├─ POST /api/agent/fetch-file  { agent_id, file_path }
  │       ↓
  │   Server creates agent_jobs row:
  │     { status: "pending", payload: { type: "read_file", file_path } }
  │       ↓
  │   Returns { job_id }
  │
  └─ Polls agent_jobs for status === "completed"
         │
         │ (agent picks up job on its poll cycle)
         │
Agent
  ├─ Sees payload.type === "read_file"
  ├─ Reads file at payload.file_path → bytes
  ├─ Base64-encodes bytes
  ├─ POST /api/agent/file-result  { job_id, file_b64, file_name }
  └─ POST /api/agent/job-complete { job_id, status: "completed" }
         │
Scheduler (browser)
  └─ Detects job status === "completed"
  └─ Reads agent_jobs.result.file_b64
  └─ Decodes → ArrayBuffer → processes as Excel file
```

---

## Acceptance Criteria

1. When the agent picks up a job with `payload.type === "read_file"`, it does **not** attempt an ODBC connection.
2. The file at `payload.file_path` is read as raw bytes and base64-encoded correctly (the scheduler must be able to decode it back to a valid `.xlsx`).
3. `/api/agent/file-result` returns `{ ok: true }` (verify in agent logs).
4. `/api/agent/job-complete` is called with `status: "completed"` after a successful upload.
5. If the file does not exist, `/api/agent/job-complete` is called with `status: "failed"` and a descriptive `error` string — no crash, no retry loop.
6. The scheduler run log shows the task completing (or failing due to SKU lookup logic) rather than the ODBC error message.
