#!/usr/bin/env node
// watch-logs.js — polls Supabase task_logs and writes to watch-logs-output.json
// Also polls the Next.js /api/dev-log endpoint for detailed binary-strategy diagnostics.
// Claude ↔ Run-Until-Fixed signal handshake:
//   - Writes ai-fix-needed.json when AI_FIX_NEEDED appears in logs
//   - Watches ai-fix-signal.json; when Claude writes it, POSTs AI_FIX_APPLIED or AI_FIX_STUCK to Supabase
// Run with: node watch-logs.js

const SUPABASE_URL = "https://lxcentwfpiefosjkarlx.supabase.co";
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4Y2VudHdmcGllZm9zamthcmx4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjUwOTUxMiwiZXhwIjoyMDkyMDg1NTEyfQ.oD0PKENBFvYc_EUkfbss3pYEL3lc3-LfU7T5BwEpX30";

const OUTPUT_FILE      = "./watch-logs-output.json";
const DEV_LOG_FILE     = "./dev-log-output.json";   // written from Next.js /api/dev-log
const AI_NEEDED_FILE   = "./ai-fix-needed.json";   // written by watcher when AI_FIX_NEEDED seen
const AI_SIGNAL_FILE   = "./ai-fix-signal.json";   // written by Claude to trigger Supabase write
const POLL_INTERVAL_MS = 3000;
const LOOK_BACK_ROWS   = 150;
const DEV_SERVER_URL   = "http://localhost:3000";

const fs    = require("fs");
const https = require("https");
const http  = require("http");

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function supabaseGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${SUPABASE_URL}${path}`,
      { method: "GET", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: "application/json" } },
      (res) => { let b = ""; res.on("data", c => b += c); res.on("end", () => { try { resolve(JSON.parse(b)); } catch { reject(new Error(b.slice(0, 200))); } }); }
    );
    req.on("error", reject);
    req.end();
  });
}

function supabasePost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      `${SUPABASE_URL}${path}`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
      },
      (res) => { let b = ""; res.on("data", c => b += c); res.on("end", () => resolve({ status: res.statusCode, body: b })); }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Dev-log polling (Next.js /api/dev-log) ───────────────────────────────────
// Fetches detailed binary-strategy diagnostics from the running dev server and
// writes them to dev-log-output.json so Claude can read them without terminal access.

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { method: "GET", headers: { Accept: "application/json" } }, (res) => {
      let b = "";
      res.on("data", c => b += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, json: null, raw: b.slice(0, 200) }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(new Error("timeout")); });
    req.end();
  });
}

async function pollDevLog() {
  try {
    const result = await httpGet(`${DEV_SERVER_URL}/api/dev-log`);
    if (result.status === 200 && Array.isArray(result.json) && result.json.length > 0) {
      const output = {
        fetched_at: new Date().toISOString(),
        run_count: result.json.length,
        runs: result.json,
      };
      fs.writeFileSync(DEV_LOG_FILE, JSON.stringify(output, null, 2));
    }
  } catch {
    // Dev server not running — silently skip
  }
}

// ── Signal file processing ────────────────────────────────────────────────────
// Claude writes ai-fix-signal.json with { action: "applied"|"stuck", task_id, details }
// We read it, POST to Supabase, then delete it.

let lastSignalMtime = 0;

async function checkSignal() {
  if (!fs.existsSync(AI_SIGNAL_FILE)) return;
  try {
    const stat = fs.statSync(AI_SIGNAL_FILE);
    if (stat.mtimeMs <= lastSignalMtime) return;
    lastSignalMtime = stat.mtimeMs;

    const signal = JSON.parse(fs.readFileSync(AI_SIGNAL_FILE, "utf8"));
    const { action, task_id, details } = signal;
    if (!task_id || !action) return;

    const supabaseAction = action === "applied" ? "AI_FIX_APPLIED" : "AI_FIX_STUCK";
    const res = await supabasePost("/rest/v1/task_logs", {
      task_id,
      action: supabaseAction,
      details: details ?? `Claude signalled ${supabaseAction}`,
    });

    if (res.status >= 200 && res.status < 300) {
      console.log(`\n✅ Wrote ${supabaseAction} to Supabase for task ${task_id.slice(0, 8)}...`);
      fs.unlinkSync(AI_SIGNAL_FILE);
    } else {
      console.log(`\n⚠️  Supabase POST ${supabaseAction} returned HTTP ${res.status}: ${res.body.slice(0, 100)}`);
    }
  } catch (err) {
    console.log(`\n[signal error] ${err.message}`);
  }
}

// ── Main poll ─────────────────────────────────────────────────────────────────

let lastSeenNeedId = null;

async function poll() {
  try {
    const logs = await supabaseGet(
      `/rest/v1/task_logs?select=id,task_id,action,details,created_at&order=created_at.desc&limit=${LOOK_BACK_ROWS}`
    );

    const chronological = [...logs].reverse();

    // Find the most recent AI_FIX_NEEDED
    const needEntry = [...logs].find(r => r.action === "AI_FIX_NEEDED");

    if (needEntry && needEntry.id !== lastSeenNeedId) {
      lastSeenNeedId = needEntry.id;
      const needed = {
        detected_at: new Date().toISOString(),
        task_id: needEntry.task_id,
        created_at: needEntry.created_at,
        details: needEntry.details,
      };
      fs.writeFileSync(AI_NEEDED_FILE, JSON.stringify(needed, null, 2));
      console.log(`\n🔔 AI_FIX_NEEDED detected! Written to ${AI_NEEDED_FILE}`);
    }

    const output = {
      polled_at: new Date().toISOString(),
      row_count: logs.length,
      pending_fix: needEntry ? { task_id: needEntry.task_id, id: needEntry.id } : null,
      logs: chronological,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    process.stdout.write(`\r[${new Date().toLocaleTimeString()}] ${logs.length} rows | pending_fix=${needEntry ? "YES ⚡" : "none"}`);
  } catch (err) {
    process.stdout.write(`\r[ERROR] ${err.message}`);
  }

  await pollDevLog();
  await checkSignal();
}

console.log(`Polling Supabase every ${POLL_INTERVAL_MS / 1000}s → ${OUTPUT_FILE}`);
console.log(`Polling Next.js dev-log every ${POLL_INTERVAL_MS / 1000}s → ${DEV_LOG_FILE}`);
console.log(`Signal handshake: write ${AI_SIGNAL_FILE} to unblock the loop.`);
console.log("Press Ctrl+C to stop.\n");

poll();
setInterval(poll, POLL_INTERVAL_MS);
