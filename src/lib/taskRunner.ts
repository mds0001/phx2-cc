/**
 * Server-side task runner — Phase 3a-2.
 *
 * Called once per tick by /api/scheduler/tick when the claimed run is in
 * `running` state. Does a budget-bounded chunk of work, persists progress
 * after every row, and returns. Subsequent ticks resume from the persisted
 * (current_slot_idx, current_row_idx) cursor.
 *
 * Phase 3a-2 supports:
 *   - Source: Insight (single fetch on the first chunk, cached to the
 *     `task_run_buffers` storage bucket as JSON for resumption).
 *   - Steps: a flat slot list derived from either `task.insight_steps`
 *     (FK-ordered, enabled-only) OR `task.mapping_slots` OR the legacy
 *     single `task.mapping_profile_id`.
 *   - Filter: `mapping_profile.filter_expression` (existing evaluator).
 *   - Mapping: standard transforms via `applyMappingProfile`. Skipped:
 *     ai_lookup, ai_guess, sku_lookup, on_order_status, embedded_image,
 *     attachment rules, link-field auto-create. Phase 3c will add these.
 *   - Target: Ivanti REST (existing /api/ivanti-proxy, no inner auth).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyMappingProfile,
  type MappingProfile,
  type MappingSlot,
  type ScheduledTask,
  type EndpointConnection,
  type InsightStep,
  type InsightRecordType,
} from "@/lib/types";
import { evaluateFilter } from "@/lib/filterExpression";

const TICK_BUDGET_MS = 250_000;
const FK_ORDER: InsightRecordType[] = ["purchase_order", "purchase_line_item", "ci"];

export interface ClaimedRun {
  id: string;
  task_id: string;
  status: string;
  current_slot_idx: number;
  current_row_idx: number;
  total_rows: number | null;
  counters: Record<string, number> | null;
  sku_exceptions: SkuException[] | null;
  source_buffer_path: string | null;
  /** 1-based row indices to include — when set, all other rows are skipped without processing. */
  row_filter: number[] | null;
  task_snapshot: ScheduledTask | null;
  mapping_snapshots: Record<string, MappingProfile> | null;
  source_connection_snap: { primary: EndpointConnection | null; all: Record<string, EndpointConnection> } | null;
  target_connection_snap: { primary: EndpointConnection | null; all: Record<string, EndpointConnection> } | null;
}

interface SkuException {
  sku: string;
  row: number;
  targetField: string;
}

export interface ChunkResult {
  result: "chunked" | "succeeded" | "cancelled";
  run_id: string;
  processed?: number;
  total?: number | null;
}

interface RunCtx {
  origin: string;
  cronSecret?: string;
}

/** Internal slot shape that unifies multi-slot tasks and insight_steps tasks. */
interface UnifiedSlot {
  label: string;
  mapping_profile_id: string | null;
  /** Optional override for target connection at the slot level. */
  target_connection_id?: string | null;
}

export async function runChunk(run: ClaimedRun, admin: SupabaseClient, ctx: RunCtx): Promise<ChunkResult> {
  const startMs = Date.now();
  const nowIso = () => new Date().toISOString();
  const task = run.task_snapshot;
  if (!task) throw new Error("Run has no task_snapshot");

  const slots = resolveSlots(task);
  if (slots.length === 0) throw new Error("No enabled slots / steps to execute");

  const counters: Record<string, number> = { ...(run.counters ?? {}) };
  const exceptions: SkuException[] = [...(run.sku_exceptions ?? [])];
  // 1-based row indices to include. Used by exception-rerun: re-process only the
  // rows that previously failed instead of the whole source.
  const rowFilterSet =
    run.row_filter && run.row_filter.length > 0 ? new Set(run.row_filter) : null;

  // ── First chunk: fetch source, cache to storage, log STARTED ────────────
  let rows: Record<string, unknown>[];
  if (!run.source_buffer_path) {
    const sourceConnId =
      firstSlotSourceConn(slots, run.mapping_snapshots) ??
      task.source_connection_id ??
      null;
    const sourceConn = sourceConnId ? run.source_connection_snap?.all?.[sourceConnId] : null;
    if (!sourceConn) throw new Error(`Source connection not in snapshot (${sourceConnId})`);

    if (sourceConn.type === "insight") {
      rows = await fetchInsightRows(task, sourceConnId!, ctx);
    } else if (sourceConn.type === "file") {
      rows = await fetchFileRows(task, sourceConn, admin);
    } else {
      throw new Error(`Phase 3b runner supports insight + file sources; got "${sourceConn.type}"`);
    }
    const path = `${run.id}.json`;
    const blob = new Blob([JSON.stringify(rows)], { type: "application/json" });
    const { error: upErr } = await admin.storage
      .from("task_run_buffers")
      .upload(path, blob, { upsert: true, contentType: "application/json" });
    if (upErr) throw new Error(`Failed to cache source buffer: ${upErr.message}`);

    run.source_buffer_path = path;
    run.total_rows = rows.length * slots.length;

    await admin
      .from("task_runs")
      .update({ source_buffer_path: path, total_rows: rows.length * slots.length })
      .eq("id", run.id);

    await admin.from("task_logs").insert({
      task_id: run.task_id,
      action: "STARTED",
      details: `Run ${run.id} started for "${task.task_name}" — ${rows.length} row(s) × ${slots.length} step(s)`,
    });
  } else {
    const { data: blob, error: dlErr } = await admin.storage
      .from("task_run_buffers")
      .download(run.source_buffer_path);
    if (dlErr || !blob) throw new Error(`Cached source buffer missing: ${run.source_buffer_path}`);
    rows = JSON.parse(await blob.text()) as Record<string, unknown>[];
  }

  // ── Process loop: resume at (current_slot_idx, current_row_idx) ────────
  let slotIdx = run.current_slot_idx;
  let rowIdx = run.current_row_idx;

  while (slotIdx < slots.length) {
    const slot = slots[slotIdx];
    const mp = slot.mapping_profile_id ? run.mapping_snapshots?.[slot.mapping_profile_id] ?? null : null;
    if (!mp) throw new Error(`Slot ${slotIdx} (${slot.label}) has no mapping profile in snapshot`);

    const targetConnId =
      mp.target_connection_id ??
      slot.target_connection_id ??
      task.target_connection_id ??
      null;
    const targetConn = targetConnId ? run.target_connection_snap?.all?.[targetConnId] : null;
    if (!targetConn) throw new Error(`Target connection not in snapshot for slot ${slotIdx}`);
    if (targetConn.type !== "ivanti") {
      throw new Error(`Phase 3a-2 only supports ivanti target; slot ${slotIdx} is "${targetConn.type}"`);
    }

    const upsertKeys = (mp.mappings ?? [])
      .filter((m) => m.isKey)
      .map((m) => mp.target_fields.find((f) => f.id === m.targetFieldId)?.name)
      .filter((n): n is string => !!n);

    // Phase 3c-3: link field metadata for ivanti-proxy. Mappings flagged
    // isLinkField AND sku_lookup-with-manufacturer are both treated as link
    // fields (matches legacy executeTask).
    const linkMappingsList = (mp.mappings ?? []).filter(
      (m) => m.isLinkField || (m.transform === "sku_lookup" && m.skuResultField === "manufacturer")
    );
    const targetFieldName = (id: string) => mp.target_fields.find((f) => f.id === id)?.name;
    const linkFieldNames = linkMappingsList
      .map((m) => targetFieldName(m.targetFieldId))
      .filter((n): n is string => !!n);
    const linkFieldBoNames: Record<string, string> = {};
    const linkFieldLookupFields: Record<string, string> = {};
    for (const m of linkMappingsList) {
      const fn = targetFieldName(m.targetFieldId);
      if (fn && m.linkFieldBoName) linkFieldBoNames[fn] = m.linkFieldBoName;
      if (fn && m.linkFieldLookupField) linkFieldLookupFields[fn] = m.linkFieldLookupField;
    }
    const autoCreateLinkFields = (mp.mappings ?? [])
      .filter((m) => m.linkFieldAutoCreate)
      .map((m) => targetFieldName(m.targetFieldId))
      .filter((n): n is string => !!n);
    const preserveOnOrderFields = (mp.mappings ?? [])
      .filter((m) => m.transform === "on_order_status")
      .map((m) => targetFieldName(m.targetFieldId))
      .filter((n): n is string => !!n);

    // SKU lookup pre-fetch setup (Phase 3c-1).
    // Keyed cache scoped to this chunk — re-fetched on next tick if needed.
    // Cache values: the resolved taxonomy field, OR sentinels "__IGNORED__" / "__NOT_FOUND__".
    const skuLookupMappings = (mp.mappings ?? []).filter((m) => m.transform === "sku_lookup");
    const skuLookupCache = new Map<string, string>();

    while (rowIdx < rows.length) {
      // Time budget: persist & exit
      if (Date.now() - startMs > TICK_BUDGET_MS) {
        await persistProgress(admin, run.id, slotIdx, rowIdx, counters, exceptions);
        return { result: "chunked", run_id: run.id, processed: counters.processed, total: run.total_rows };
      }

      // Cancellation check (cheap query each row — we want fast cancel response)
      const { data: live } = await admin
        .from("task_runs")
        .select("status")
        .eq("id", run.id)
        .single();
      if (live?.status === "cancelling") {
        await persistProgress(admin, run.id, slotIdx, rowIdx, counters, exceptions);
        await finishCancelled(admin, run);
        return { result: "cancelled", run_id: run.id };
      }

      // row_filter (rerun): bypass rows not in the explicit allow-list. We
      // don't increment any counter — these rows are simply not part of this run.
      if (rowFilterSet && !rowFilterSet.has(rowIdx + 1)) {
        rowIdx++;
        await persistProgress(admin, run.id, slotIdx, rowIdx, counters, exceptions);
        continue;
      }

      const row = rows[rowIdx] as Record<string, unknown>;

      // Filter expression
      let pass = true;
      if (mp.filter_expression) {
        const result = evaluateFilter(row, mp.filter_expression);
        pass = result.pass;
      }

      if (!pass) {
        counters.filtered = (counters.filtered ?? 0) + 1;
      } else {
        // Pre-fetch SKU lookup results for this row. If any lookup returns an
        // __IGNORED__ or __NOT_FOUND__ sentinel, skip the row entirely (matches
        // existing client-side executeTask behavior).
        let skipReason: string | null = null;
        const skuLookupResults: Record<string, string> = {};
        for (const sm of skuLookupMappings) {
          const srcField = mp.source_fields.find((f) => f.id === sm.sourceFieldId);
          if (!srcField) continue;
          const skuRaw = String(row[srcField.name] ?? "").trim().toUpperCase();
          if (!skuRaw) continue;
          const cacheKey = `${sm.id}:${skuRaw}`;
          let resolved = skuLookupCache.get(cacheKey);
          if (resolved === undefined) {
            try {
              const res = await fetch(`${ctx.origin}/api/sku-lookup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sku: skuRaw,
                  result_field: sm.skuResultField ?? "type",
                  customer_id: task.customer_id ?? null,
                  context: Object.fromEntries(
                    Object.entries(row)
                      .filter(([, v]) => typeof v === "string" || typeof v === "number")
                      .map(([k, v]) => [k, String(v)])
                  ),
                }),
              });
              const json = (await res.json()) as { found?: boolean; value?: string | null };
              if (json.value === "__IGNORED__") {
                resolved = "__IGNORED__";
              } else if (json.found && json.value) {
                resolved = json.value;
              } else {
                resolved = "__NOT_FOUND__";
              }
            } catch {
              resolved = "__NOT_FOUND__";
            }
            skuLookupCache.set(cacheKey, resolved);
          }
          if (resolved === "__IGNORED__") {
            skipReason = `SKU "${skuRaw}" is marked as ignored`;
            break;
          }
          if (resolved === "__NOT_FOUND__") {
            skipReason = `SKU "${skuRaw}" not in taxonomy (queued for research)`;
            const tgtFieldName =
              mp.target_fields.find((f) => f.id === sm.targetFieldId)?.name ??
              sm.skuResultField ??
              "type";
            // Dedupe per (sku, row, targetField) so multiple lookups in the
            // same row don't double-record.
            const dupe = exceptions.find(
              (e) => e.sku === skuRaw && e.row === rowIdx + 1 && e.targetField === tgtFieldName
            );
            if (!dupe) exceptions.push({ sku: skuRaw, row: rowIdx + 1, targetField: tgtFieldName });
            break;
          }
          skuLookupResults[sm.id] = resolved;
        }

        if (skipReason) {
          counters.skipped = (counters.skipped ?? 0) + 1;
          await admin.from("task_logs").insert({
            task_id: run.task_id,
            action: "SKIP",
            details: `[S${slotIdx + 1}] Row ${rowIdx + 1}: ${skipReason} — skipped`,
          });
        } else {
          const mapped = applyMappingProfile(row, mp, undefined, undefined, skuLookupResults);
          await postRowToIvanti({
            admin,
            run,
            slotIdx,
            rowIdx,
            mapped,
            targetConn,
            businessObject: mp.target_business_object ?? undefined,
            upsertKeys,
            linkFieldNames,
            linkFieldBoNames,
            linkFieldLookupFields,
            autoCreateLinkFields,
            preserveOnOrderFields,
            counters,
            ctx,
          });
        }
      }

      counters.processed = (counters.processed ?? 0) + 1;
      rowIdx++;

      await persistProgress(admin, run.id, slotIdx, rowIdx, counters, exceptions);
    }

    // Slot done — advance
    slotIdx++;
    rowIdx = 0;
    await persistProgress(admin, run.id, slotIdx, rowIdx, counters, exceptions);
  }

  // ── All slots done ─────────────────────────────────────────────────────
  await admin
    .from("task_runs")
    .update({ status: "succeeded", finished_at: nowIso(), last_heartbeat_at: null })
    .eq("id", run.id);
  const finalTaskStatus =
    (counters.errored ?? 0) > 0 ? "completed_with_errors" : "completed";

  // For recurring tasks: advance start_date_time by one interval so the next
  // tick auto-creates the next run when the new time elapses.
  const taskUpdate: Record<string, unknown> = { status: finalTaskStatus };
  if (task.recurrence && task.recurrence !== "one-time") {
    const nextStart = advanceStartDateTime(task.start_date_time, task.recurrence);
    taskUpdate.start_date_time = nextStart;
    await admin.from("task_logs").insert({
      task_id: run.task_id,
      action: "INFO",
      details: `Next run scheduled for ${new Date(nextStart).toLocaleString()} (${task.recurrence})`,
    });
  }
  await admin
    .from("scheduled_tasks")
    .update(taskUpdate)
    .eq("id", run.task_id);
  await admin.from("task_logs").insert({
    task_id: run.task_id,
    action: "COMPLETED",
    details:
      `Done — ${counters.created ?? 0} created, ${counters.updated ?? 0} updated, ` +
      `${counters.skipped ?? 0} skipped, ${counters.filtered ?? 0} filtered, ${counters.errored ?? 0} errored` +
      (exceptions.length > 0 ? `, ${exceptions.length} SKU exception(s) queued` : ""),
  });

  // Record SKU exceptions for the Research/Exceptions UI + email admins.
  await recordSkuExceptions(run, exceptions, ctx);

  if (run.source_buffer_path) {
    await admin.storage.from("task_run_buffers").remove([run.source_buffer_path]).catch(() => null);
  }

  return { result: "succeeded", run_id: run.id, processed: counters.processed, total: run.total_rows };
}

async function recordSkuExceptions(run: ClaimedRun, exceptions: SkuException[], ctx: RunCtx) {
  if (!ctx.cronSecret) return; // Already validated at fetch time, but be safe.
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${ctx.cronSecret}`,
  };
  const task = run.task_snapshot;
  if (exceptions.length === 0) {
    // Clean run — auto-archive any prior exception entries for this task.
    await fetch(`${ctx.origin}/api/sku-run-exceptions`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ task_id: run.task_id }),
    }).catch(() => null);
    return;
  }
  // Record + notify (best-effort; failures logged but don't fail the run).
  try {
    await fetch(`${ctx.origin}/api/sku-run-exceptions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: run.task_id,
        task_name: task?.task_name ?? "(unknown)",
        customer_id: task?.customer_id ?? null,
        customer_name: null,                       // resolved server-side from task_id
        exceptions,
      }),
    });
  } catch (e) {
    console.warn("[runner] sku-run-exceptions record failed:", e);
  }
  try {
    await fetch(`${ctx.origin}/api/sku-exception-notify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: run.task_id,
        task_name: task?.task_name ?? "(unknown)",
        exceptions,
      }),
    });
  } catch (e) {
    console.warn("[runner] sku-exception-notify failed:", e);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function resolveSlots(task: ScheduledTask): UnifiedSlot[] {
  // Insight steps take precedence: enabled-only, FK-ordered.
  const insightSteps = (task.insight_steps as InsightStep[] | null) ?? [];
  if (insightSteps.length > 0) {
    return FK_ORDER
      .map((rt) => insightSteps.find((s) => s.record_type === rt))
      .filter((s): s is InsightStep => !!s && s.enabled !== false)
      .map((s) => ({
        label: s.record_type,
        mapping_profile_id: s.mapping_profile_id,
        target_connection_id: s.target_connection_id,
      }));
  }
  // Multi-slot
  const slots = (task.mapping_slots as MappingSlot[] | null) ?? [];
  const enabled = slots.filter((s) => s.enabled !== false);
  if (enabled.length > 0) {
    return enabled.map((s) => ({
      label: s.label ?? s.id,
      mapping_profile_id: s.mapping_profile_id,
    }));
  }
  // Legacy single mapping_profile
  if (task.mapping_profile_id) {
    return [{ label: "default", mapping_profile_id: task.mapping_profile_id }];
  }
  return [];
}

function firstSlotSourceConn(
  slots: UnifiedSlot[],
  snapshots: Record<string, MappingProfile> | null | undefined
): string | null {
  for (const s of slots) {
    if (!s.mapping_profile_id) continue;
    const mp = snapshots?.[s.mapping_profile_id];
    if (mp?.source_connection_id) return mp.source_connection_id;
  }
  return null;
}

/**
 * Create a `pending` task_run row with frozen snapshots of the task, mapping
 * profiles, and connections. Used by:
 *   - /api/scheduler/start  (user-initiated Server Run)
 *   - /api/scheduler/tick   (auto-create for recurring tasks past start_date_time)
 *
 * Returns { ok: true, run_id } on success, or { ok: false, error, live_run_id? }
 * if a non-terminal run already exists for the task (single-flight guard).
 */
export async function createPendingRun(args: {
  admin: SupabaseClient;
  task: ScheduledTask;
  triggeredBy?: string | null;
  rowFilter?: number[] | null;
}): Promise<{ ok: true; run_id: string } | { ok: false; error: string; live_run_id?: string }> {
  const { admin, task, triggeredBy = null, rowFilter = null } = args;

  // Single-flight: reject if a non-terminal run already exists for this task.
  const { data: liveRun } = await admin
    .from("task_runs")
    .select("id, status")
    .eq("task_id", task.id)
    .in("status", ["pending", "running", "cancelling"])
    .limit(1)
    .maybeSingle();
  if (liveRun) {
    return {
      ok: false,
      error: "A run is already in progress for this task",
      live_run_id: liveRun.id,
    };
  }

  // Slot list: multi-slot tasks override the legacy single profile.
  const slots = Array.isArray(task.mapping_slots) && task.mapping_slots.length > 0
    ? (task.mapping_slots as MappingSlot[])
    : [{ id: "legacy", mapping_profile_id: task.mapping_profile_id ?? null }];

  const mappingIds = [...new Set(
    slots.map((s) => s.mapping_profile_id).filter((id): id is string => !!id)
  )];

  const mappingSnapshots: Record<string, unknown> = {};
  if (mappingIds.length > 0) {
    const { data: mps } = await admin
      .from("mapping_profiles")
      .select("*")
      .in("id", mappingIds);
    for (const mp of mps ?? []) {
      mappingSnapshots[mp.id] = mp;
    }
  }

  // Connection snapshot: gather every distinct id referenced by mapping profiles
  // and the task itself, then resolve the effective source/target the same way
  // the runner will resolve them.
  const connIds = new Set<string>();
  for (const id of mappingIds) {
    const mp = mappingSnapshots[id] as { source_connection_id?: string | null; target_connection_id?: string | null } | undefined;
    if (mp?.source_connection_id) connIds.add(mp.source_connection_id);
    if (mp?.target_connection_id) connIds.add(mp.target_connection_id);
  }
  if (task.source_connection_id) connIds.add(task.source_connection_id);
  if (task.target_connection_id) connIds.add(task.target_connection_id);

  let sourceConnectionSnap: unknown = null;
  let targetConnectionSnap: unknown = null;
  if (connIds.size > 0) {
    const { data: conns } = await admin
      .from("endpoint_connections")
      .select("*")
      .in("id", [...connIds]);
    const connMap = new Map<string, unknown>();
    for (const c of conns ?? []) connMap.set(c.id, c);

    const firstSlotMp = slots[0]?.mapping_profile_id
      ? (mappingSnapshots[slots[0].mapping_profile_id] as { source_connection_id?: string | null; target_connection_id?: string | null })
      : undefined;
    const srcId = firstSlotMp?.source_connection_id ?? task.source_connection_id ?? null;
    const tgtId = firstSlotMp?.target_connection_id ?? task.target_connection_id ?? null;
    sourceConnectionSnap = { primary: srcId ? connMap.get(srcId) ?? null : null, all: Object.fromEntries(connMap) };
    targetConnectionSnap = { primary: tgtId ? connMap.get(tgtId) ?? null : null, all: Object.fromEntries(connMap) };
  }

  const { data: run, error: insErr } = await admin
    .from("task_runs")
    .insert({
      task_id: task.id,
      status: "pending",
      task_snapshot: task,
      mapping_snapshots: mappingSnapshots,
      source_connection_snap: sourceConnectionSnap,
      target_connection_snap: targetConnectionSnap,
      row_filter: rowFilter,
      triggered_by: triggeredBy,
      customer_id: task.customer_id ?? null,
    })
    .select("id")
    .single();
  if (insErr || !run) {
    return { ok: false, error: insErr?.message ?? "Failed to create run" };
  }

  await admin
    .from("scheduled_tasks")
    .update({ status: "active" })
    .eq("id", task.id);

  return { ok: true, run_id: run.id };
}

/**
 * Find the next recurring task whose start_date_time has elapsed and which has
 * no live run. Returns the task or null if none. Caller is responsible for
 * calling createPendingRun() with it.
 */
export async function findRecurringTaskDue(admin: SupabaseClient): Promise<ScheduledTask | null> {
  const now = new Date();
  const nowIso = now.toISOString();
  // Candidate set: recurring (not one-time), start_date_time elapsed.
  // We filter end_date_time in JS to avoid PostgREST .or() quirks with ISO
  // timestamps that contain colons.
  const { data: candidates } = await admin
    .from("scheduled_tasks")
    .select("*")
    .neq("recurrence", "one-time")
    .lte("start_date_time", nowIso)
    .order("start_date_time", { ascending: true })
    .limit(20);
  if (!candidates || candidates.length === 0) return null;

  const stillActive = candidates.filter((t) => {
    const end = (t as { end_date_time: string | null }).end_date_time;
    return !end || new Date(end) > now;
  });
  if (stillActive.length === 0) return null;

  // Skip candidates that already have a live (non-terminal) task_run.
  const ids = stillActive.map((t) => t.id as string);
  const { data: liveRuns } = await admin
    .from("task_runs")
    .select("task_id")
    .in("task_id", ids)
    .in("status", ["pending", "running", "cancelling"]);
  const liveSet = new Set((liveRuns ?? []).map((r) => r.task_id as string));

  for (const t of stillActive) {
    if (!liveSet.has(t.id as string)) return t as ScheduledTask;
  }
  return null;
}

/** Advance a recurring task's start_date_time by one interval. */
export function advanceStartDateTime(currentIso: string, recurrence: string): string {
  const next = new Date(currentIso);
  switch (recurrence) {
    case "hourly":  next.setHours(next.getHours() + 1); break;
    case "daily":   next.setDate(next.getDate() + 1);   break;
    case "weekly":  next.setDate(next.getDate() + 7);   break;
    case "monthly": next.setMonth(next.getMonth() + 1); break;
    default: return currentIso; // one-time or unknown — leave it alone
  }
  return next.toISOString();
}

async function fetchFileRows(
  task: ScheduledTask,
  sourceConn: EndpointConnection,
  admin: SupabaseClient
): Promise<Record<string, unknown>[]> {
  const cfg = sourceConn.config as unknown as {
    file_path?: string;
    file_name?: string;
    file_mode?: string;
    file_type?: string;
  };
  const fileMode = cfg.file_mode ?? "file";

  if (fileMode === "local") {
    throw new Error(
      "Phase 3b doesn't yet support local/agent file mode (file_mode=\"local\"). " +
      "Defer this task to the agent-fetch sub-phase, or set the connection to use Supabase storage."
    );
  }

  const taskDir = task.source_file_path?.trim().replace(/\/$/, "") ?? null;
  const resolvedPath =
    cfg.file_path ||
    (taskDir && cfg.file_name ? `${taskDir}/${cfg.file_name}` : null);
  if (!resolvedPath) {
    throw new Error(
      `Source connection "${sourceConn.name}" has no file configured. Set a Source Directory on the task or a file_path on the connection.`
    );
  }

  const fileType = (cfg.file_type ?? "xlsx").toLowerCase();
  if (fileType !== "xlsx") {
    throw new Error(`Phase 3b only supports xlsx files; got file_type="${fileType}".`);
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from("task_files")
    .download(resolvedPath);
  if (dlErr || !blob) {
    throw new Error(`Failed to download "${resolvedPath}" from task_files bucket: ${dlErr?.message ?? "not found"}`);
  }
  const arrayBuffer = await blob.arrayBuffer();

  // Lazy-load xlsx — keep cold-start of /api/scheduler/tick fast for non-file runs.
  const XLSX = await import("xlsx");
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error(`Workbook "${resolvedPath}" has no sheets`);
  }
  // defval: null preserves empty cells so mapped fields are never silently dropped.
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null }) as Record<string, unknown>[];
}

async function fetchInsightRows(
  task: ScheduledTask,
  sourceConnId: string,
  ctx: RunCtx
): Promise<Record<string, unknown>[]> {
  // Resolve date window — same precedence as the existing client-side path.
  let shipDateFrom: string | undefined;
  let shipDateTo: string | undefined;
  if (task.lookback_days && task.lookback_days > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const start = new Date(today);
    start.setDate(today.getDate() - task.lookback_days);
    shipDateFrom = start.toISOString().split("T")[0];
    shipDateTo = yesterday.toISOString().split("T")[0];
  } else if (task.import_window_start && task.import_window_end) {
    shipDateFrom = task.import_window_start;
    shipDateTo = task.import_window_end;
  }

  if (!ctx.cronSecret) {
    throw new Error(
      "CRON_SECRET env var is not set. Server-side runner needs it to authenticate against /api/insight-proxy. Add it to .env.local (dev) and Vercel env vars (prod)."
    );
  }

  const res = await fetch(`${ctx.origin}/api/insight-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ctx.cronSecret}`,
    },
    body: JSON.stringify({
      connection_id: sourceConnId,
      ...(shipDateFrom ? { ship_date_from: shipDateFrom } : {}),
      ...(shipDateTo ? { ship_date_to: shipDateTo } : {}),
      ...(task.expand_serials ? { expand_serials: true } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Insight proxy failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { rows: Record<string, unknown>[] };
  return json.rows ?? [];
}

async function postRowToIvanti(args: {
  admin: SupabaseClient;
  run: ClaimedRun;
  slotIdx: number;
  rowIdx: number;
  mapped: Record<string, unknown>;
  targetConn: EndpointConnection;
  businessObject: string | undefined;
  upsertKeys: string[];
  linkFieldNames: string[];
  linkFieldBoNames: Record<string, string>;
  linkFieldLookupFields: Record<string, string>;
  autoCreateLinkFields: string[];
  preserveOnOrderFields: string[];
  counters: Record<string, number>;
  ctx: RunCtx;
}) {
  const {
    admin, run, slotIdx, rowIdx, mapped, targetConn, businessObject,
    upsertKeys, linkFieldNames, linkFieldBoNames, linkFieldLookupFields,
    autoCreateLinkFields, preserveOnOrderFields, counters, ctx,
  } = args;
  const cfg = targetConn.config as unknown as Record<string, string>;
  const slotPrefix = `[S${slotIdx + 1}]`;
  try {
    const res = await fetch(`${ctx.origin}/api/ivanti-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ivantiUrl: cfg.url,
        data: mapped,
        apiKey: cfg.api_key,
        businessObject,
        tenantId: cfg.tenant_id,
        ...(upsertKeys.length > 0 && { upsertKeys }),
        ...(linkFieldNames.length > 0 && { linkFieldNames }),
        ...(Object.keys(linkFieldBoNames).length > 0 && { linkFieldBoNames }),
        ...(Object.keys(linkFieldLookupFields).length > 0 && { linkFieldLookupFields }),
        ...(autoCreateLinkFields.length > 0 && { autoCreateLinkFields }),
        ...(preserveOnOrderFields.length > 0 && { preserveOnOrderFields }),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (json._skip) {
      counters.skipped = (counters.skipped ?? 0) + 1;
      await admin.from("task_logs").insert({
        task_id: run.task_id,
        action: "SKIP",
        details: `${slotPrefix} Row ${rowIdx + 1}: ${String(json.reason ?? "skipped")}`,
      });
    } else if (!res.ok) {
      counters.errored = (counters.errored ?? 0) + 1;
      await admin.from("task_logs").insert({
        task_id: run.task_id,
        action: "ERROR",
        details: `${slotPrefix} Row ${rowIdx + 1} failed (${res.status}): ${JSON.stringify(json).slice(0, 800)}`,
      });
    } else {
      const upsertMethod = (json.upsert as { method?: string } | undefined)?.method;
      if (upsertMethod === "PATCH") counters.updated = (counters.updated ?? 0) + 1;
      else counters.created = (counters.created ?? 0) + 1;
      await admin.from("task_logs").insert({
        task_id: run.task_id,
        action: "SUCCESS",
        details: `${slotPrefix} Row ${rowIdx + 1}: ${JSON.stringify(json).slice(0, 1500)}`,
      });
    }
  } catch (err) {
    counters.errored = (counters.errored ?? 0) + 1;
    await admin.from("task_logs").insert({
      task_id: run.task_id,
      action: "ERROR",
      details: `${slotPrefix} Row ${rowIdx + 1} exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

async function persistProgress(
  admin: SupabaseClient,
  runId: string,
  slotIdx: number,
  rowIdx: number,
  counters: Record<string, number>,
  exceptions: SkuException[]
) {
  await admin
    .from("task_runs")
    .update({
      current_slot_idx: slotIdx,
      current_row_idx: rowIdx,
      counters,
      sku_exceptions: exceptions,
      last_heartbeat_at: null,                   // tick finished cleanly — release in-progress lock
      next_tick_at: new Date().toISOString(),    // immediately eligible
    })
    .eq("id", runId);
}

async function finishCancelled(admin: SupabaseClient, run: ClaimedRun) {
  await admin
    .from("task_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString(), last_heartbeat_at: null })
    .eq("id", run.id);
  await admin
    .from("scheduled_tasks")
    .update({ status: "cancelled" })
    .eq("id", run.task_id);
  await admin.from("task_logs").insert({
    task_id: run.task_id,
    action: "CANCELLED",
    details: `Run ${run.id} cancelled at slot ${run.current_slot_idx} row ${run.current_row_idx}`,
  });
  if (run.source_buffer_path) {
    await admin.storage.from("task_run_buffers").remove([run.source_buffer_path]).catch(() => null);
  }
}
