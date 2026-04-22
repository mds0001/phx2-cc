/**
 * dev-log.ts — module-level ring buffer for binary-upload diagnostics.
 *
 * The ivanti-proxy route pushes one BinaryRunEntry per field per row as it
 * works through the strategy waterfall.  The /api/dev-log route reads (and
 * optionally clears) the buffer so an external observer (e.g. Claude) can
 * fetch http://HOST/api/dev-log and see exactly what happened without the
 * user having to copy-paste server logs.
 *
 * Lives in module scope so it survives across requests within one Node.js
 * process lifetime (i.e. one `npm run dev` session).  Resets on server restart.
 */

export interface StrategyAttempt {
  strategy: string;        // "G", "A0", "A", "B", "C", "F", "E", "D"
  detail:   string;        // short description of what was tried
  status:   number | null; // HTTP status, or null if a JS exception occurred
  result:   string;        // truncated response body / error message
  ok:       boolean;       // did this strategy set uploaded=true?
}

export interface BinaryRowEntry {
  runId:     string;              // shared across all rows in one task run
  ts:        string;              // ISO timestamp when this row's upload completed
  rowIndex:  number;              // 0-based row index within the task run
  recId:     string;              // Ivanti record RecId
  field:     string;              // field name, e.g. "ivnt_CatalogImage"
  sizeKB:    number;
  mimeType:  string;
  attempts:  StrategyAttempt[];
  uploaded:  boolean;
  finalResult: string;            // binaryUploadResults[field] value
}

export interface DevLogEntry {
  runId:    string;
  runStart: string;              // ISO timestamp of first row in this run
  rows:     BinaryRowEntry[];
}

// ── Ring buffer ───────────────────────────────────────────────────────────────
const MAX_RUNS = 10;
const runs: DevLogEntry[] = [];

/** Return a copy of all buffered runs, newest first. */
export function getDevLog(): DevLogEntry[] {
  return [...runs].reverse();
}

/** Discard all buffered runs. */
export function clearDevLog(): void {
  runs.length = 0;
}

/** Push (or update) a row entry.  Call once per field per row when done. */
export function pushBinaryRow(entry: BinaryRowEntry): void {
  let run = runs.find(r => r.runId === entry.runId);
  if (!run) {
    run = { runId: entry.runId, runStart: entry.ts, rows: [] };
    runs.push(run);
    if (runs.length > MAX_RUNS) runs.shift();
  }
  // Replace if already present (idempotent), otherwise append.
  const idx = run.rows.findIndex(r => r.rowIndex === entry.rowIndex && r.field === entry.field);
  if (idx >= 0) run.rows[idx] = entry; else run.rows.push(entry);
}
