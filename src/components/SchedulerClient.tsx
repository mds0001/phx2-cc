"use client";

import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import * as XLSX from "xlsx";
import {
  ArrowLeft,
  Plus,
  Play,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronUp,
  Copy,
  X,
  Clock,
  CheckCircle2,
  Check,
  Activity,
  AlertCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Zap,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type {
  Profile,
  ScheduledTask,
  TaskLog,
  RecurrenceType,
  MappingProfile,
  EndpointConnection,
  ZipFileEntry,
} from "@/lib/types";
import { applyMappingProfile, MappingSlot } from "@/lib/types";
import { evaluateFilter } from "@/lib/filterExpression";
import { extractZipFile } from "@/lib/zip";
import { GitMerge, Plug, BookOpen } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────

function toLocalDatetimeString(isoUtc: string): string {
  const d = new Date(isoUtc);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function formatLocalDateTime(isoUtc: string): string {
  return new Date(isoUtc).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_BADGE: Record<string, { label: string; class: string }> = {
  waiting: {
    label: "Waiting",
    class: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  },
  active: {
    label: "Active",
    class: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  },
  completed: {
    label: "Completed",
    class: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  },
  completed_with_errors: {
    label: "Completed w/ Errors",
    class: "bg-red-500/15 text-red-400 border-red-500/25",
  },
  completed_with_warnings: {
    label: "Completed w/ Warnings",
    class: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  },
  cancelled: {
    label: "Cancelled",
    class: "bg-gray-500/15 text-gray-400 border-gray-500/25",
  },
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  waiting: <Clock className="w-3 h-3" />,
  active: <Activity className="w-3 h-3" />,
  completed: <CheckCircle2 className="w-3 h-3" />,
  completed_with_errors: <AlertCircle className="w-3 h-3" />,
  completed_with_warnings: <AlertTriangle className="w-3 h-3" />,
  cancelled: <AlertCircle className="w-3 h-3" />,
};

const RECURRENCES: RecurrenceType[] = [
  "one-time",
  "daily",
  "weekly",
  "monthly",
];

const POLL_KEY = "phx2_poll_interval";
const DEFAULT_POLL = 30;

// ─── Types ───────────────────────────────────────────────────

interface Props {
  profile: Profile | null;
  initialTasks: ScheduledTask[];
  userId: string;
}

interface FormState {
  taskName: string;
  startDateTime: string;
  recurrence: RecurrenceType;
  mappingProfileId: string | null;
  mappingSlots: MappingSlot[];
  writeMode: "upsert" | "create_only";
}

const EMPTY_FORM: FormState = {
  taskName: "",
  startDateTime: "",
  recurrence: "one-time",
  mappingProfileId: null,
  mappingSlots: [{ id: "slot-new-0", mapping_profile_id: null }],
  writeMode: "upsert",
};

// ─── Component ───────────────────────────────────────────────

export default function SchedulerClient({
  profile,
  initialTasks,
  userId,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const isAdmin = profile?.user_type === "admin";
  const canControlPoll =
    profile?.role === "administrator" || profile?.role === "schedule_administrator";

  const [tasks, setTasks] = useState<ScheduledTask[]>(initialTasks);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editTask, setEditTask] = useState<ScheduledTask | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);


  // Copy-mapping mini-modal state
  // target: which form to apply the result to ("create" | "edit")
  const [copyMappingTarget, setCopyMappingTarget] = useState<"create" | "edit" | null>(null);
  const [copyMappingSourceId, setCopyMappingSourceId] = useState<string>("");
  const [copyMappingName, setCopyMappingName] = useState<string>("");
  const [copyMappingBusy, setCopyMappingBusy] = useState(false);

  async function handleCopyMapping() {
    if (!copyMappingSourceId || !copyMappingName.trim()) return;
    setCopyMappingBusy(true);
    try {
      const src = mappingProfiles.find((m) => m.id === copyMappingSourceId);
      if (!src) throw new Error("Source profile not found");
      const { data, error } = await supabase
        .from("mapping_profiles")
        .insert({
          name: copyMappingName.trim(),
          description: src.description,
          source_fields: src.source_fields,
          target_fields: src.target_fields,
          mappings: src.mappings,
          source_connection_id: src.source_connection_id,
          target_connection_id: src.target_connection_id,
          filter_expression: src.filter_expression,
          created_by: src.created_by,
        })
        .select("*")
        .single();
      if (error) throw error;
      // Add to local list so it appears immediately
      setMappingProfiles((prev) => [...prev, data as typeof prev[0]]);
      // Apply to the right form
      if (copyMappingTarget === "create") {
        setForm((p) => ({ ...p, mappingProfileId: data.id }));
        applyMappingDefaults(data.id, setForm);
      } else {
        setEditForm((p) => ({ ...p, mappingProfileId: data.id }));
        applyMappingDefaults(data.id, setEditForm);
      }
      setCopyMappingTarget(null);
    } catch (err) {
      alert("Copy failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCopyMappingBusy(false);
    }
  }
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [taskLogs, setTaskLogs] = useState<Record<string, TaskLog[]>>({});
  const [logsLoading, setLogsLoading] = useState<Record<string, boolean>>({});
  const [logCounts, setLogCounts] = useState<Record<string, number>>({});
  const [fullscreenTaskId, setFullscreenTaskId] = useState<string | null>(null);
  // Summary popover: last SUMMARY log shown when user clicks the status badge.
  // Uses fixed positioning (via getBoundingClientRect) so no ancestor clip can hide it.
  const [summaryPopoverId, setSummaryPopoverId] = useState<string | null>(null);
  const [summaryPopoverPos, setSummaryPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [lastSummaries, setLastSummaries] = useState<Record<string, { details: string; created_at: string } | null>>({});
  // Refs so the realtime log subscription sees current state without stale closures
  const expandedLogsRef = useRef<Record<string, boolean>>({});
  const fullscreenTaskIdRef = useRef<string | null>(null);

  const [runningTasks, setRunningTasks] = useState<Set<string>>(new Set());
  const [cancellingTasks, setCancellingTasks] = useState<Set<string>>(new Set());
  const [mappingProfiles, setMappingProfiles] = useState<MappingProfile[]>([]);
  const [endpointConnections, setEndpointConnections] = useState<EndpointConnection[]>([]);

  // Fetch log counts for the initial task list on mount (tasks are SSR'd, counts are not)
  useEffect(() => {
    if (initialTasks.length === 0) return;
    supabase
      .from("task_logs")
      .select("task_id")
      .in("task_id", initialTasks.map((t) => t.id))
      .then(({ data }) => {
        if (!data) return;
        const tally: Record<string, number> = {};
        for (const row of data) tally[row.task_id] = (tally[row.task_id] ?? 0) + 1;
        setLogCounts(tally);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch mapping profiles, endpoint connections, and rule types once on mount
  useEffect(() => {
    supabase
      .from("mapping_profiles")
      .select("id, name, source_fields, target_fields, mappings, source_connection_id, target_connection_id")
      .order("name")
      .then(({ data }) => {
        if (data) setMappingProfiles(data as MappingProfile[]);
      });
    supabase
      .from("endpoint_connections")
      .select("id, name, type, config")
      .order("name")
      .then(({ data }) => {
        if (data) setEndpointConnections(data as EndpointConnection[]);
      });
  }, [supabase]);

  /** When a mapping profile is selected, auto-fill source + target connections from its defaults. */
  function applyMappingDefaults(mpId: string, setter: Dispatch<SetStateAction<FormState>>) {
    const mp = mappingProfiles.find((m) => m.id === mpId);
    if (!mp) return;
    setter((prev) => ({
      ...prev,
    }));
  }

  const [pollInterval, setPollInterval] = useState<number>(DEFAULT_POLL);
  const [pollCustom, setPollCustom] = useState<string>("");
  const [pollCountdown, setPollCountdown] = useState<number>(0);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const executingRef = useRef<Set<string>>(new Set());
  // cancelledRef: task IDs for which the user has requested cancellation.
  // executeTask checks this at each record boundary and aborts early.
  const cancelledRef = useRef<Set<string>>(new Set());
  // taskAbortControllers: one AbortController per running task.
  // Aborting it immediately interrupts any in-flight fetch (AI pre-fetch, proxy calls, etc.)
  const taskAbortControllers = useRef<Map<string, AbortController>>(new Map());

  // ── Fetch tasks ──────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from("scheduled_tasks")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setTasks(data);

    // Fetch log counts for all tasks
    const { data: counts } = await supabase
      .from("task_logs")
      .select("task_id");
    if (counts) {
      const tally: Record<string, number> = {};
      for (const row of counts) {
        tally[row.task_id] = (tally[row.task_id] ?? 0) + 1;
      }
      setLogCounts(tally);
    }
  }, [supabase]);

  // ── Fetch helper with retry (handles transient "Failed to fetch" errors) ──
  async function fetchWithRetry(url: string, options: RequestInit, retries = 2, delayMs = 1000): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, options);
        return res;
      } catch (err) {
        // Never retry an abort — surface it immediately so the caller can handle cancellation.
        if (err instanceof Error && err.name === "AbortError") throw err;
        if (attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
    throw new Error("fetchWithRetry: unreachable");
  }

  // ── Execute a single task ─────────────────────────────────
  const executeTask = useCallback(
    async (task: ScheduledTask) => {
      // Hard guard: prevent concurrent runs of the same task
      if (executingRef.current.has(task.id)) return;
      executingRef.current.add(task.id);
      setRunningTasks((p) => new Set(p).add(task.id));
      // Create an AbortController so Cancel can immediately interrupt any in-flight fetch.
      const taskAbort = new AbortController();
      taskAbortControllers.current.set(task.id, taskAbort);
      const taskStartTime = Date.now();
      console.log(
        `[Execute] Starting task "${task.task_name}"`
      );

      await supabase
        .from("scheduled_tasks")
        .update({ status: "active" })
        .eq("id", task.id);

      await supabase.from("task_logs").insert({
        task_id: task.id,
        action: "STARTED",
        details: `Task "${task.task_name}" started at ${new Date().toISOString()}`,
      });

      try {
        // ── Build slot list — multi-slot tasks override the legacy single profile ──
        const rawSlots = (task.mapping_slots ?? []) as MappingSlot[];
        const slots: MappingSlot[] = rawSlots.length > 0
          ? rawSlots
          : [{ id: "legacy", mapping_profile_id: task.mapping_profile_id, label: undefined }];
        const isMultiSlot = slots.length > 1;

        let filteredCount     = 0;
        let rowErrorCount     = 0;
        let rowWarnCount      = 0;
        let rowSkipCount      = 0;
        let rowCreatedCount   = 0;
        let rowUpdatedCount   = 0;
        let totalInputTokens  = 0;
        let totalOutputTokens = 0;

        for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
          const slot = slots[slotIdx];

          // Check cancellation before starting each slot
          if (cancelledRef.current.has(task.id)) break;

          if (isMultiSlot) {
            const slotLabel = slot.label ? `: ${slot.label}` : "";
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `── Slot ${slotIdx + 1} of ${slots.length}${slotLabel} ──`,
            });
          }

        // ── Step 1: Load mapping profile ─────────────────────
        let mappingProfile: MappingProfile | null = null;
        if (slot.mapping_profile_id) {
          const { data: mp } = await supabase
            .from("mapping_profiles")
            .select("*")
            .eq("id", slot.mapping_profile_id)
            .single();
          mappingProfile = mp ?? null;
          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: mappingProfile
              ? `Using mapping profile "${mappingProfile.name}" (${mappingProfile.mappings.length} mappings)`
              : "No mapping profile — sending raw row data",
          });
        }

        // ── Step 2: Resolve source connection (file endpoint) ─
        const resolvedSourceConnId =
          mappingProfile?.source_connection_id ?? null;
        let sourceConnFileConfig: { file_path?: string; file_name?: string } | null = null;
        let sourceConnType: string | null = null;
        let sourceConnRawConfig: Record<string, unknown> | null = null;
        if (resolvedSourceConnId) {
          const { data: srcConn } = await supabase
            .from("endpoint_connections")
            .select("*")
            .eq("id", resolvedSourceConnId)
            .single();
          if (srcConn) {
            sourceConnType = srcConn.type;
            sourceConnRawConfig = srcConn.config as Record<string, unknown>;
            const src = "mapping profile";
            if (srcConn.type === "file") {
              sourceConnFileConfig = srcConn.config as { file_path?: string; file_name?: string };
              await supabase.from("task_logs").insert({
                task_id: task.id,
                action: "INFO",
                details: `Source connection (${src}): "${srcConn.name}" [FILE] — ${sourceConnFileConfig.file_name ?? sourceConnFileConfig.file_path ?? "no file configured"}`,
              });
            } else {
              await supabase.from("task_logs").insert({
                task_id: task.id,
                action: "INFO",
                details: `Source connection (${src}): "${srcConn.name}" [${srcConn.type.toUpperCase()}]`,
              });
            }
          }
        }

        // ── Step 3: Resolve target connection ─────────────────
        let targetConnection: Record<string, string> | null = null;
        let targetConnRawConfig: Record<string, unknown> | null = null;
        let targetConnType: string | null = null;
        const resolvedTargetConnId =
          mappingProfile?.target_connection_id ?? null;
        if (resolvedTargetConnId) {
          const { data: conn } = await supabase
            .from("endpoint_connections")
            .select("*")
            .eq("id", resolvedTargetConnId)
            .single();
          if (conn) {
            targetConnection = conn.config as Record<string, string>;
            targetConnRawConfig = conn.config as Record<string, unknown>;
            targetConnType = conn.type as string;
            const src = "mapping profile";
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `Target connection (${src}): "${conn.name}" [${conn.type.toUpperCase()}]${targetConnection.url ? ` — ${targetConnection.url}` : ""}`,
            });
          }
        }

        // ── Step 4: Route by source connection type ──────────────
        // All source/destination info comes exclusively from the endpoint
        // connections referenced by the mapping profile. No task-level overrides.
        // Priority: manual override > task file path > source connection file config
        const resolvedSourceFilePath = sourceConnFileConfig?.file_path ?? null;

        if (sourceConnType === "file") {
          if (!resolvedSourceFilePath) {
            throw new Error("Source endpoint is a file type but no file_path is configured in the connection.");
          }

          const fileCfg = sourceConnRawConfig as { zip_mode?: string; zip_file_filter?: string; file_name?: string } | null;
          const isZipMode = fileCfg?.zip_mode === "true";

          // Build list of { label, buffer } to process — one entry for normal mode, N for zip mode
          const fileEntries: { label: string; buffer: ArrayBuffer; targetConnId?: string | null; mappingProfileId?: string | null }[] = [];

          if (isZipMode) {
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `ZIP mode: downloading archive ${resolvedSourceFilePath}`,
            });
            const { data: zipData, error: zipErr } = await supabase.storage
              .from("task_files")
              .download(resolvedSourceFilePath!);
            if (zipErr || !zipData)
              throw new Error("Failed to download ZIP: " + zipErr?.message);
            const zipBuffer = await zipData.arrayBuffer();

            const rawOrder = mappingProfile?.zip_file_order ?? [];
            const fileOrder: ZipFileEntry[] = rawOrder.map((e) =>
              typeof e === "string" ? { path: e as string } : e as ZipFileEntry
            );
            if (fileOrder.length === 0)
              throw new Error("ZIP mode: no file execution order defined in mapping profile. Edit the mapping profile to configure the ZIP file order.");

            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `ZIP mode: processing ${fileOrder.length} file(s) in order: ${fileOrder.map((e) => e.path.split("/").pop()).join(", ")}`,
            });

            for (const zipEntry of fileOrder) {
              const buf = await extractZipFile(zipBuffer, zipEntry.path);
              fileEntries.push({
                label: zipEntry.path,
                buffer: buf,
                targetConnId: zipEntry.target_connection_id ?? null,
                mappingProfileId: zipEntry.mapping_profile_id ?? null,
              });
            }
          } else {
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `Downloading file: ${resolvedSourceFilePath}`,
            });
            const { data: fileData, error: dlError } = await supabase.storage
              .from("task_files")
              .download(resolvedSourceFilePath!);
            if (dlError || !fileData)
              throw new Error("Failed to download file: " + dlError?.message);
            const label = fileCfg?.file_name ?? resolvedSourceFilePath.split("/").pop() ?? "file";
            fileEntries.push({ label, buffer: await fileData.arrayBuffer() });
          }

          for (const fileEntry of fileEntries) {
          const arrayBuffer = fileEntry.buffer;

          const wb = XLSX.read(arrayBuffer, { type: "array" });
          const sheetName = wb.SheetNames[0];
          let rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(
            wb.Sheets[sheetName],
            { defval: null }   // include empty cells as null so mapped fields are never silently dropped
          );

          // Resolve per-file target connection override (if any)
          let fileTargetConnection = targetConnection;
          let fileTargetConnType = targetConnType;
          let fileTargetConnId = resolvedTargetConnId;
          if (fileEntry.targetConnId) {
            const { data: overrideConn } = await supabase
              .from("endpoint_connections").select("*").eq("id", fileEntry.targetConnId).single();
            if (overrideConn) {
              fileTargetConnection = overrideConn.config as Record<string, string>;
              fileTargetConnType = overrideConn.type as string;
              fileTargetConnId = overrideConn.id as string;
              await supabase.from("task_logs").insert({
                task_id: task.id, action: "INFO",
                details: `[${fileEntry.label}] Target override: "${overrideConn.name}" [${overrideConn.type.toUpperCase()}]`,
              });
            }
          }

          // Resolve per-file mapping profile override (if any)
          let fileMappingProfile = mappingProfile;
          if (fileEntry.mappingProfileId) {
            const { data: overrideMp } = await supabase
              .from("mapping_profiles").select("*").eq("id", fileEntry.mappingProfileId).single();
            if (overrideMp) {
              fileMappingProfile = overrideMp as MappingProfile;
              await supabase.from("task_logs").insert({
                task_id: task.id, action: "INFO",
                details: `[${fileEntry.label}] Mapping override: "${overrideMp.name}"`,
              });
            }
          }

          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: `[${fileEntry.label}] Parsed ${rows.length} rows from sheet "${sheetName}"`,
          });

          // Resolve effective connection from target endpoint
          const effectiveUrl            = fileTargetConnection?.url;
          const effectiveApiKey         = fileTargetConnection?.api_key        ?? undefined;
          // Business object must come from the mapping profile — never fall back to the
          // connection's default BO, which could silently write to the wrong object.
          const effectiveBusinessObject = (fileMappingProfile as unknown as { target_business_object?: string })?.target_business_object?.trim() || undefined;
          const effectiveTenantId       = fileTargetConnection?.tenant_id       ?? undefined;

          if (!effectiveBusinessObject && (fileTargetConnType === "ivanti" || fileTargetConnType === "ivanti_neurons")) {
            await supabase.from("task_logs").insert({
              task_id: task.id, action: "ERROR",
              details: `Mapping profile "${fileMappingProfile?.name ?? slot.mapping_profile_id}" has no Business Object set. Open the mapping editor and set the target Business Object before running this task.`,
            });
            continue;
          }

          // ── create_only: batch existence check before AI work ──────────────
          // In create_only mode we pre-check which rows already exist in the target
          // so we can skip AI pre-fetch and row processing for them entirely.
          // This avoids paying AI token costs for records that will never be written.
          const isCreateOnly = (task.write_mode ?? "upsert") === "create_only";
          if (isCreateOnly && fileMappingProfile && effectiveUrl && rows.length > 0) {
            // Find which target field maps to "Name" (the default upsert key).
            const nameTgtField = fileMappingProfile.target_fields.find(f => f.name === "Name");
            const nameMapping  = nameTgtField
              ? fileMappingProfile.mappings.find(m => m.targetFieldId === nameTgtField.id && m.transform !== "static" && m.transform !== "ai_guess" && m.transform !== "ai_lookup")
              : null;
            const nameSrcField = nameMapping
              ? fileMappingProfile.source_fields.find(f => f.id === nameMapping.sourceFieldId)
              : null;

            if (nameSrcField) {
              const keyValues = [...new Set(
                rows.map(r => String(r[nameSrcField.name] ?? "")).filter(Boolean)
              )];

              await supabase.from("task_logs").insert({
                task_id: task.id, action: "INFO",
                details: `Create only: checking ${keyValues.length} unique key(s) against target…`,
              });

              try {
                const ceRes = await fetch("/api/ivanti-proxy", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    mode: "check-exists",
                    ivantiUrl: effectiveUrl,
                    apiKey: effectiveApiKey,
                    businessObject: effectiveBusinessObject,
                    tenantId: effectiveTenantId,
                    upsertKey: "Name",
                    keyValues,
                  }),
                  signal: taskAbort.signal,
                });
                if (ceRes.ok) {
                  const { existing } = await ceRes.json() as { existing: string[] };
                  const existingSet = new Set(existing);
                  const before = rows.length;
                  rows = rows.filter(r => !existingSet.has(String(r[nameSrcField.name] ?? "")));
                  const skippedUpfront = before - rows.length;
                  rowSkipCount += skippedUpfront;
                  await supabase.from("task_logs").insert({
                    task_id: task.id, action: "INFO",
                    details: `Create only: ${existing.length} record(s) already exist — skipped. ${rows.length} new row(s) will be processed.`,
                  });
                }
              } catch (e) {
                if (e instanceof Error && e.name === "AbortError") throw e;
                // If the existence check fails, fall through and let the per-row proxy handle it
                await supabase.from("task_logs").insert({
                  task_id: task.id, action: "WARN",
                  details: `Create only: pre-check failed (${e instanceof Error ? e.message : String(e)}) — will check existence per row instead.`,
                });
              }
            }
          }

          // ── Pre-fetch AI lookup results (batched, deduplicated) ──
          const aiLookupMappings = fileMappingProfile?.mappings.filter(
            (m) => m.transform === "ai_lookup"
          ) ?? [];

          // Cache: JSON.stringify(sourceValues) → AI response
          const aiCache = new Map<string, Record<string, string>>();

          if (aiLookupMappings.length > 0 && fileMappingProfile) {
            const allAiSourceFieldIds = [
              ...new Set(aiLookupMappings.flatMap((m) => m.aiSourceFields ?? [])),
            ];
            const outputKeys = [
              ...new Set(
                aiLookupMappings
                  .map((m) => m.aiOutputKey)
                  .filter(Boolean) as string[]
              ),
            ];
            const customPrompt =
              aiLookupMappings.find((m) => m.aiPrompt)?.aiPrompt ?? undefined;

            // Build unique source-value combos across all rows
            const uniqueCombos = new Map<string, Record<string, string>>();
            for (const row of rows) {
              const sourceValues: Record<string, string> = {};
              for (const fieldId of allAiSourceFieldIds) {
                const field = fileMappingProfile.source_fields.find(
                  (f) => f.id === fieldId
                );
                if (field)
                  sourceValues[field.name] = String(row[field.name] ?? "");
              }
              const key = JSON.stringify(sourceValues);
              if (!uniqueCombos.has(key)) uniqueCombos.set(key, sourceValues);
            }

            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `AI Lookup: ${uniqueCombos.size} unique combo(s) — keys: [${outputKeys.join(", ")}]`,
            });

            for (const [comboKey, sourceValues] of uniqueCombos) {
              try {
                const res = await fetch("/api/ai-lookup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sourceValues, outputKeys, customPrompt }),
                  signal: taskAbort.signal,
                });
                if (res.ok) {
                  const result = await res.json() as Record<string, unknown>;
                  // Accumulate token counts returned by the route
                  totalInputTokens  += (result.inputTokens  as number | undefined) ?? 0;
                  totalOutputTokens += (result.outputTokens as number | undefined) ?? 0;
                  // Strip meta keys before caching so they don't land in the payload
                  const { inputTokens: _it, outputTokens: _ot, ...lookupResult } = result;
                  void _it; void _ot;
                  aiCache.set(comboKey, lookupResult as Record<string, string>);
                }
              } catch {
                // Cache miss is fine — applyMappingProfile returns "" for missing keys
              }
            }
          }

          // ── Pre-fetch AI guess results (per-mapping-row, deduplicated by source combo) ──
          // Cache key: `${mapping.id}:${JSON.stringify(sourceValues)}`  → guessed value string
          const aiGuessCache = new Map<string, string>();
          const aiGuessMappings = fileMappingProfile?.mappings.filter(
            (m) => m.transform === "ai_guess"
          ) ?? [];

          if (aiGuessMappings.length > 0 && fileMappingProfile) {
            for (const gm of aiGuessMappings) {
              if (cancelledRef.current.has(task.id)) break;

              // Determine which source fields to pull context from
              const guessSourceFieldIds = gm.aiGuessSourceFields?.length
                ? gm.aiGuessSourceFields
                : fileMappingProfile.source_fields.map((f) => f.id);

              // Build unique source-value combos across all rows for this mapping
              const uniqueCombos = new Map<string, Record<string, string>>();
              for (const row of rows) {
                const sourceValues: Record<string, string> = {};
                for (const fieldId of guessSourceFieldIds) {
                  const field = fileMappingProfile.source_fields.find((f) => f.id === fieldId);
                  if (field) sourceValues[field.name] = String(row[field.name] ?? "");
                }
                const key = JSON.stringify(sourceValues);
                if (!uniqueCombos.has(key)) uniqueCombos.set(key, sourceValues);
              }

              const tgtFieldName =
                fileMappingProfile.target_fields.find((f) => f.id === gm.targetFieldId)?.name ?? gm.id;

              // ── Batch request: send all unique combos in one HTTP call ──────
              // The server resolves all cache hits with a single DB query, then
              // calls Claude only for the misses.  Much faster than N sequential calls.
              type BatchItem = {
                id: string;
                targetFieldName: string;
                sourceValues: Record<string, string>;
                validValues?: string[];
                customPrompt?: string;
              };
              const batchItems: BatchItem[] = [];
              for (const [comboKey, sourceValues] of uniqueCombos) {
                batchItems.push({
                  id: `${gm.id}:${comboKey}`,
                  targetFieldName: tgtFieldName,
                  sourceValues,
                  validValues: gm.aiGuessValidValues?.length ? gm.aiGuessValidValues : undefined,
                  customPrompt:  gm.aiGuessPrompt ?? undefined,
                });
              }

              try {
                const res = await fetch("/api/ai-lookup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mode: "batch-guess", items: batchItems }),
                  signal: taskAbort.signal,
                });
                if (res.ok) {
                  const json = await res.json() as {
                    results?: Record<string, string>;
                    cacheHits?: number;
                    claudeCalls?: number;
                    inputTokens?: number;
                    outputTokens?: number;
                  };

                  // Accumulate token counts from this batch call
                  totalInputTokens  += json.inputTokens  ?? 0;
                  totalOutputTokens += json.outputTokens ?? 0;

                  // Populate the in-memory cache and tally result values.
                  const valueTally = new Map<string, number>();
                  for (const [id, value] of Object.entries(json.results ?? {})) {
                    if (value) {
                      aiGuessCache.set(id, value);
                      valueTally.set(value, (valueTally.get(value) ?? 0) + 1);
                    }
                  }

                  // Build a readable distribution: "Laptop×23, Dock×12, Desktop×8"
                  const distribution = [...valueTally.entries()]
                    .sort(([, a], [, b]) => b - a)
                    .map(([v, n]) => (n > 1 ? `${v}×${n}` : v))
                    .join(", ") || "(none)";

                  const cacheHits   = json.cacheHits   ?? 0;
                  const claudeCalls = json.claudeCalls  ?? 0;
                  const sourceLabel = [
                    cacheHits   > 0 ? `${cacheHits} cached`        : "",
                    claudeCalls > 0 ? `${claudeCalls} Claude call(s)` : "",
                  ].filter(Boolean).join(", ");

                  await supabase.from("task_logs").insert({
                    task_id: task.id,
                    action: "INFO",
                    details: `AI Guess [${tgtFieldName}]: ${uniqueCombos.size} unique combo(s) — ${distribution} (${sourceLabel || "no results"})`,
                  });
                }
              } catch (e) {
                if (e instanceof Error && e.name === "AbortError") break;
                // Batch failed — log and continue (rows will get WARN for missing values)
                await supabase.from("task_logs").insert({
                  task_id: task.id,
                  action: "WARN",
                  details: `AI Guess [${tgtFieldName}]: batch pre-fetch failed — ${e instanceof Error ? e.message : String(e)}`,
                });
              }
            }
          }

          if (fileMappingProfile?.filter_expression) {
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `Row filter expression: ${fileMappingProfile.filter_expression}`,
            });
          }

          for (let i = 0; i < rows.length; i++) {
            // ── Cancellation checkpoint ──────────────────────────
            if (cancelledRef.current.has(task.id)) {
              await supabase.from("task_logs").insert({
                task_id: task.id,
                action: "WARN",
                details: "Task cancelled by user.",
              });
              break;
            }
            const row = rows[i];

            // Evaluate row filter expression — skip rows that don't match
            if (fileMappingProfile?.filter_expression) {
              const { pass, error } = evaluateFilter(
                row as Record<string, unknown>,
                fileMappingProfile.filter_expression
              );
              if (error) {
                await supabase.from("task_logs").insert({
                  task_id: task.id,
                  action: "WARN",
                  details: `Row filter parse error (row ${i + 1}): ${error}`,
                });
              }
              if (!pass) {
                filteredCount++;
                continue;
              }
            }

            // Build per-row AI lookup results from cache
            let aiResults: Record<string, string> | undefined;
            if (aiLookupMappings.length > 0 && fileMappingProfile) {
              const allAiSourceFieldIds = [
                ...new Set(aiLookupMappings.flatMap((m) => m.aiSourceFields ?? [])),
              ];
              const sourceValues: Record<string, string> = {};
              for (const fieldId of allAiSourceFieldIds) {
                const field = fileMappingProfile.source_fields.find(
                  (f) => f.id === fieldId
                );
                if (field)
                  sourceValues[field.name] = String(row[field.name] ?? "");
              }
              aiResults = aiCache.get(JSON.stringify(sourceValues));
            }

            // Build per-row AI guess results from cache (keyed by mapping.id)
            let aiGuessResults: Record<string, string> | undefined;
            if (aiGuessMappings.length > 0 && fileMappingProfile) {
              aiGuessResults = {};
              for (const gm of aiGuessMappings) {
                const guessSourceFieldIds = gm.aiGuessSourceFields?.length
                  ? gm.aiGuessSourceFields
                  : fileMappingProfile.source_fields.map((f) => f.id);
                const sourceValues: Record<string, string> = {};
                for (const fieldId of guessSourceFieldIds) {
                  const field = fileMappingProfile.source_fields.find((f) => f.id === fieldId);
                  if (field) sourceValues[field.name] = String(row[field.name] ?? "");
                }
                const cacheKey = `${gm.id}:${JSON.stringify(sourceValues)}`;
                const guessedValue = aiGuessCache.get(cacheKey);
                if (guessedValue) {
                  aiGuessResults[gm.id] = guessedValue;
                } else {
                  // AI returned nothing for this combo — log a WARN so the user knows.
                  const tgtFieldName2 =
                    fileMappingProfile.target_fields.find((f) => f.id === gm.targetFieldId)?.name ?? gm.id;
                  rowWarnCount++;
                  await supabase.from("task_logs").insert({
                    task_id: task.id,
                    action: "WARN",
                    details: `Row ${i + 1}: AI Guess [${tgtFieldName2}] — no value returned. The field will be omitted from this row's payload. Check the valid values list or add a custom prompt.`,
                  });
                }
              }
            }

            const payload = fileMappingProfile
              ? applyMappingProfile(row, fileMappingProfile, aiResults, aiGuessResults)
              : row;
            // Warn about mapped fields that had no source value (null in payload)
            if (fileMappingProfile) {
              const nullFields: string[] = [];
              for (const mapping of fileMappingProfile.mappings) {
                if (mapping.transform === "static" || mapping.transform === "ai_lookup" || mapping.transform === "ai_guess") continue;
                const tgtF = fileMappingProfile.target_fields.find((f) => f.id === mapping.targetFieldId);
                const srcF = fileMappingProfile.source_fields.find((f) => f.id === mapping.sourceFieldId);
                if (tgtF && srcF && payload[tgtF.name] === null) {
                  nullFields.push(`${srcF.name} → ${tgtF.name}`);
                }
              }
              if (nullFields.length > 0) {
                await supabase.from("task_logs").insert({
                  task_id: task.id, action: "WARN",
                  details: `Row ${i + 1}: mapped fields with no source value (will send null): ${nullFields.join(", ")}`,
                });
              }
            }
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "ROW",
              details: `Sending row ${i + 1}/${rows.length}: ${JSON.stringify(payload)}`,
            });

            // Determine proxy route from the (possibly per-file-overridden) target connection type
            const resolvedConnType = fileTargetConnType;

            try {
              let proxyRoute = "/api/ivanti-proxy";
              // Collect target field names the user has explicitly marked as Ivanti link fields,
              // plus any per-field BO name overrides.
              const fileLinkMappings = (fileMappingProfile?.mappings ?? []).filter((m) => m.isLinkField);
              const fileLinkFieldNames = fileLinkMappings
                .map((m) => fileMappingProfile?.target_fields.find((f) => f.id === m.targetFieldId)?.name)
                .filter((n): n is string => !!n);
              const fileLinkFieldBoNames: Record<string, string> = {};
              const fileLinkFieldLookupFields: Record<string, string> = {};
              for (const m of fileLinkMappings) {
                const fieldName = fileMappingProfile?.target_fields.find((f) => f.id === m.targetFieldId)?.name;
                if (fieldName && m.linkFieldBoName) fileLinkFieldBoNames[fieldName] = m.linkFieldBoName;
                if (fieldName && m.linkFieldLookupField) fileLinkFieldLookupFields[fieldName] = m.linkFieldLookupField;
              }
              // Build composite upsert key from mapping rows marked isKey.
              const fileUpsertKeys = (fileMappingProfile?.mappings ?? [])
                .filter((m) => m.isKey)
                .map((m) => fileMappingProfile?.target_fields.find((f) => f.id === m.targetFieldId)?.name)
                .filter((n): n is string => !!n);
              const skipIfExists = (task.write_mode ?? "upsert") === "create_only";
              let proxyBody: Record<string, unknown> = {
                ivantiUrl: effectiveUrl,
                data: payload,
                apiKey: effectiveApiKey,
                businessObject: effectiveBusinessObject,
                tenantId: effectiveTenantId,
                ...(fileLinkFieldNames.length > 0 && { linkFieldNames: fileLinkFieldNames }),
                ...(Object.keys(fileLinkFieldBoNames).length > 0 && { linkFieldBoNames: fileLinkFieldBoNames }),
                ...(Object.keys(fileLinkFieldLookupFields).length > 0 && { linkFieldLookupFields: fileLinkFieldLookupFields }),
                ...(fileUpsertKeys.length > 0 && { upsertKeys: fileUpsertKeys }),
                ...(skipIfExists && { skipIfExists: true }),
              };
              if (resolvedConnType === "dell") {
                proxyRoute = "/api/dell-proxy";
                proxyBody = { data: payload, connectionId: fileTargetConnId };
              } else if (resolvedConnType === "cdw") {
                proxyRoute = "/api/cdw-proxy";
                proxyBody = { data: payload, connectionId: fileTargetConnId };
              }

              await new Promise((r) => setTimeout(r, 75));
              const res = await fetchWithRetry(proxyRoute, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(proxyBody),
                signal: taskAbort.signal,
              });
              const json = await res.json();

              // ── Skipped row (create_only mode — record already existed) ──────
              if (json?.skipped === true) {
                rowSkipCount++;
                await supabase.from("task_logs").insert({
                  task_id: task.id,
                  action: "SKIP",
                  details: `Row ${i + 1} → Skipped — ${json.reason ?? "record already exists"}`,
                });
                continue;
              }

              if (!res.ok) rowWarnCount++;
              // Build a succinct log line with a deep-link to the Ivanti record.
              const _body = (json?.body ?? {}) as Record<string, unknown>;
              const _upsert = (json?.upsert ?? {}) as Record<string, unknown>;
              const _recId   = _body.RecId   as string | undefined;
              const _name    = _body.Name    as string | undefined;
              const _model   = _body.ivnt_AssignedModel as string | undefined;
              const _ciType  = _body.CIType  as string | undefined;
              const _subtype = _body.ivnt_AssetSubtype as string | undefined;
              const _method  = (_upsert.method as string | undefined) ?? (res.ok ? "POST" : "");
              const _action  = _method === "PATCH" ? "Updated" : "Created";
              if (res.ok) {
                if (_method === "PATCH") rowUpdatedCount++;
                else rowCreatedCount++;
              }
              const _typeStr = [_ciType, _subtype].filter(Boolean).join(" / ");
              const _base    = (effectiveUrl ?? "").replace(/\/$/, "");
              const _link    = _recId ? ` — Details: ${_base}/HEAT?RecId=${_recId}` : "";
              const _label   = [
                `Row ${i + 1} → ${res.ok ? _action : `Error ${json?.status ?? ""}`}`,
                _name,
                _model,
                _typeStr || undefined,
              ].filter(Boolean).join(" | ");
              await supabase.from("task_logs").insert({
                task_id: task.id,
                action: res.ok ? "SUCCESS" : "WARN",
                details: `${_label}${_link}`,
              });

              // Surface the Ivanti error detail when the row failed
              if (!res.ok) {
                const _errMsg = json?.error ?? json?.message ?? json?.body?.Message ?? json?.body?.error;
                const _errBody = _errMsg ? String(_errMsg) : JSON.stringify(json).slice(0, 400);
                await supabase.from("task_logs").insert({
                  task_id: task.id,
                  action: "WARN",
                  details: `Row ${i + 1} Ivanti response: ${_errBody}`,
                });
              }

              // If the proxy had to strip validated fields on auto-retry, surface a WARN.
              const _strippedFields = json?.strippedFields as string[] | undefined;
              const _strippedValues = json?.strippedValues as Record<string, unknown> | undefined;
              if (res.ok && _strippedFields?.length) {
                rowWarnCount++;
                const strippedDesc = _strippedFields
                  .map((f: string) => `${f}="${_strippedValues?.[f] ?? ""}"`)
                  .join(", ");
                await supabase.from("task_logs").insert({
                  task_id: task.id,
                  action: "WARN",
                  details: `Row ${i + 1}: Ivanti rejected validated field(s) — stripped on retry: ${strippedDesc}. Check that these values exist in Ivanti's validation list for this CI type, or update the mapping's valid values.`,
                });
              }
            } catch (rowErr: unknown) {
              // If the task was cancelled, don't log a spurious ERROR for the aborted row.
              if (rowErr instanceof Error && rowErr.name === "AbortError") break;
              rowErrorCount++;
              await supabase.from("task_logs").insert({
                task_id: task.id,
                action: "ERROR",
                details: `Row ${i + 1} failed: ${
                  rowErr instanceof Error ? rowErr.message : String(rowErr)
                }`,
              });
            }
          }

          // Log filter summary if any rows were skipped
          if (filteredCount > 0) {
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `Row filter: ${filteredCount} of ${rows.length} rows skipped (did not match expression)`,
            });
          }
          if (rowSkipCount > 0) {
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `Write mode (create only): ${rowSkipCount} of ${rows.length} rows skipped — record already existed in target.`,
            });
          }
          } // end for (fileEntry of fileEntries)
        } else if (sourceConnType === "ivanti") {
          // ── Ivanti → File export ──────────────────────────────
          // Fetch all records from the Ivanti business object, apply mapping,
          // build an XLSX, and upload to Supabase storage with a random name.

          const srcConfig = sourceConnRawConfig as { url?: string; api_key?: string; business_object?: string; tenant_id?: string } | null;

          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: `Fetching records from Ivanti business object: ${srcConfig?.business_object ?? "(not set)"}`,
          });

          const fetchRes = await fetch("/api/ivanti-proxy", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ivantiUrl: srcConfig?.url,
              apiKey: srcConfig?.api_key,
              businessObject: srcConfig?.business_object,
              tenantId: srcConfig?.tenant_id,
            }),
          });

          if (!fetchRes.ok) {
            const errJson = await fetchRes.json().catch(() => ({}));
            throw new Error(`Ivanti fetch failed: ${errJson.error ?? fetchRes.statusText}`);
          }

          const { rows: rawRows, count } = await fetchRes.json() as {
            rows: Record<string, unknown>[];
            count: number;
          };

          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: `Fetched ${count} records from Ivanti`,
          });

          if (rawRows.length > 0) {
            const firstRowKeys = Object.keys(rawRows[0]);
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `Source fields available: ${firstRowKeys.join(", ")}`,
            });
          }

          if (mappingProfile?.filter_expression) {
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `Row filter expression: ${mappingProfile.filter_expression}`,
            });
          }

          // Filter raw source rows first (filter uses source field names),
          // then map only the rows that pass to target field names.
          let ivantiFilteredCount = 0;
          const filteredRawRows = rawRows.filter((row, idx) => {
            if (!mappingProfile?.filter_expression) return true;
            const { pass, error } = evaluateFilter(row as Record<string, unknown>, mappingProfile.filter_expression);
            if (error) console.warn(`Row filter error (row ${idx + 1}):`, error);
            if (!pass) { ivantiFilteredCount++; return false; }
            return true;
          });

          if (ivantiFilteredCount > 0) {
            await supabase.from("task_logs").insert({
              task_id: task.id, action: "INFO",
              details: `Row filter: ${ivantiFilteredCount} of ${count} rows skipped (did not match expression)`,
            });
          }

          // Map the filtered raw rows to target field names
          const filteredMappedRows = filteredRawRows.map((row) =>
            mappingProfile ? applyMappingProfile(row, mappingProfile, undefined) : row
          );

          // ── Route to target based on target connection type ──────
          if (!targetConnType || targetConnType === "file") {
            // ── Target is a file endpoint — write to Supabase storage ──
            const tgtCfg = targetConnRawConfig as {
              file_type?: string; file_mode?: string;
              file_path?: string; output_file_name?: string;
            } | null;

            const fileType   = (tgtCfg?.file_type  ?? "xlsx") as string;
            const fileMode   = (tgtCfg?.file_mode  ?? "directory") as string;
            const dirPath    = tgtCfg?.file_path?.replace(/\/?$/, "/") ?? `exports/${task.id}/`;

            const timestamp  = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
            const rand       = Math.random().toString(36).slice(2, 8);
            const bizObj     = (srcConfig?.business_object ?? "unknown_object").replace(/[^a-zA-Z0-9_]/g, "_");
            const autoName   = `${bizObj}_${timestamp}_${rand}.${fileType}`;
            const withExt = (name: string) => `${name.replace(/\.[^.]+$/, "")}.${fileType}`;
            const fileName   = fileMode === "file" && tgtCfg?.file_path
              ? withExt(tgtCfg.file_path.split("/").pop() ?? autoName)
              : tgtCfg?.output_file_name?.trim()
                ? withExt(tgtCfg.output_file_name.trim())
                : autoName;
            const storagePath = fileMode === "file" && tgtCfg?.file_path
              ? tgtCfg.file_path
              : `${dirPath}${fileName}`;

            let uploadBlob: Blob;
            if (fileType === "json") {
              uploadBlob = new Blob([JSON.stringify(filteredMappedRows, null, 2)], { type: "application/json" });
            } else if (fileType === "csv") {
              const ws = XLSX.utils.json_to_sheet(filteredMappedRows);
              uploadBlob = new Blob([XLSX.utils.sheet_to_csv(ws)], { type: "text/csv" });
            } else if (fileType === "xml") {
              const xmlRows = filteredMappedRows.map((row) => {
                const fields = Object.entries(row)
                  .map(([k, v]) => `  <${k}>${String(v ?? "").replace(/[<>&]/g, (ch) => ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;")}</${k}>`)
                  .join("\n");
                return `<record>\n${fields}\n</record>`;
              }).join("\n");
              uploadBlob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n<records>\n${xmlRows}\n</records>`], { type: "application/xml" });
            } else {
              const ws = XLSX.utils.json_to_sheet(filteredMappedRows);
              const wb2 = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb2, ws, "Export");
              const buf = XLSX.write(wb2, { type: "array", bookType: "xlsx" }) as unknown as ArrayBuffer;
              uploadBlob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            }

            const { error: uploadError } = await supabase.storage
              .from("task_files")
              .upload(storagePath, uploadBlob, { upsert: true });
            if (uploadError) throw new Error(`Failed to upload export file: ${uploadError.message}`);

            const { data: signedData } = await supabase.storage
              .from("task_files")
              .createSignedUrl(storagePath, 60 * 60 * 24);
            const downloadUrl = signedData?.signedUrl ?? null;

            await supabase.from("task_logs").insert({
              task_id: task.id, action: "SUCCESS",
              details: `Export complete — ${filteredMappedRows.length} records written to "${fileName}" [${fileType.toUpperCase()}]${downloadUrl ? ` — Download: ${downloadUrl}` : ""}`,
            });

          } else {
            // ── Target is an API endpoint — POST each row to the proxy ──
            await supabase.from("task_logs").insert({
              task_id: task.id, action: "INFO",
              details: `Sending ${filteredMappedRows.length} records to ${targetConnType.toUpperCase()} target`,
            });

            const tgtRaw = targetConnRawConfig as Record<string, string> | null;
            let ivantiRowErrors = 0;
            let ivantiRowWarns = 0;

            for (let i = 0; i < filteredMappedRows.length; i++) {
                // ── Cancellation checkpoint ──────────────────────────
                if (cancelledRef.current.has(task.id)) {
                  await supabase.from("task_logs").insert({
                    task_id: task.id,
                    action: "WARN",
                    details: "Task cancelled by user.",
                  });
                  break;
                }
              const payload = filteredMappedRows[i];
              // Warn about mapped fields that had no source value
              if (mappingProfile) {
                const nullFields: string[] = [];
                for (const mapping of mappingProfile.mappings) {
                  if (mapping.transform === "static" || mapping.transform === "ai_lookup") continue;
                  const tgtF = mappingProfile.target_fields.find((f) => f.id === mapping.targetFieldId);
                  const srcF = mappingProfile.source_fields.find((f) => f.id === mapping.sourceFieldId);
                  if (tgtF && srcF && payload[tgtF.name] === null) {
                    nullFields.push(`${srcF.name} → ${tgtF.name}`);
                  }
                }
                if (nullFields.length > 0) {
                  await supabase.from("task_logs").insert({
                    task_id: task.id, action: "WARN",
                    details: `Row ${i + 1}: mapped fields with no source value (will send null): ${nullFields.join(", ")}`,
                  });
                }
              }
              await supabase.from("task_logs").insert({
                task_id: task.id, action: "ROW",
                details: `Sending row ${i + 1}/${filteredMappedRows.length}: ${JSON.stringify(payload)}`,
              });
              try {
                let proxyRoute = "/api/ivanti-proxy";
                // Collect target field names the user has explicitly marked as Ivanti link fields,
                // plus any per-field BO name overrides.
                const linkMappings = (mappingProfile?.mappings ?? []).filter((m) => m.isLinkField);
                const linkFieldNames = linkMappings
                  .map((m) => mappingProfile?.target_fields.find((f) => f.id === m.targetFieldId)?.name)
                  .filter((n): n is string => !!n);
                const linkFieldBoNames: Record<string, string> = {};
                const linkFieldLookupFields: Record<string, string> = {};
                for (const m of linkMappings) {
                  const fieldName = mappingProfile?.target_fields.find((f) => f.id === m.targetFieldId)?.name;
                  if (fieldName && m.linkFieldBoName) linkFieldBoNames[fieldName] = m.linkFieldBoName;
                  if (fieldName && m.linkFieldLookupField) linkFieldLookupFields[fieldName] = m.linkFieldLookupField;
                }
                // Build composite upsert key from mapping rows marked isKey.
                const upsertKeys = (mappingProfile?.mappings ?? [])
                  .filter((m) => m.isKey)
                  .map((m) => mappingProfile?.target_fields.find((f) => f.id === m.targetFieldId)?.name)
                  .filter((n): n is string => !!n);
                let proxyBody: Record<string, unknown> = {
                  ivantiUrl: tgtRaw?.url,
                  data: payload,
                  apiKey: tgtRaw?.api_key,
                  businessObject: tgtRaw?.business_object,
                  tenantId: tgtRaw?.tenant_id,
                  ...(linkFieldNames.length > 0 && { linkFieldNames }),
                  ...(Object.keys(linkFieldBoNames).length > 0 && { linkFieldBoNames }),
                  ...(Object.keys(linkFieldLookupFields).length > 0 && { linkFieldLookupFields }),
                  ...(upsertKeys.length > 0 && { upsertKeys }),
                };
                if (targetConnType === "dell") {
                  proxyRoute = "/api/dell-proxy";
                  proxyBody = { data: payload, connectionId: resolvedTargetConnId };
                } else if (targetConnType === "cdw") {
                  proxyRoute = "/api/cdw-proxy";
                  proxyBody = { data: payload, connectionId: resolvedTargetConnId };
                }
                await new Promise((r) => setTimeout(r, 75));
                const res = await fetchWithRetry(proxyRoute, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(proxyBody),
                });
                const json = await res.json();
                if (!res.ok) ivantiRowWarns++;
                await supabase.from("task_logs").insert({
                  task_id: task.id, action: res.ok ? "SUCCESS" : "WARN",
                  details: `Row ${i + 1} response: ${JSON.stringify(json)}`,
                });
              } catch (rowErr: unknown) {
                ivantiRowErrors++;
                await supabase.from("task_logs").insert({
                  task_id: task.id, action: "ERROR",
                  details: `Row ${i + 1} failed: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`,
                });
              }
            }
            rowErrorCount += ivantiRowErrors;
            rowWarnCount  += ivantiRowWarns;
          }

        } else if (sourceConnType === "ivanti_neurons") {
          // ── Ivanti Neurons People & Device Inventory API → target ──
          const srcNeurons = sourceConnRawConfig as {
            auth_url?: string;
            client_id?: string;
            client_secret?: string;
            base_url?: string;
            dataset?: string;
          } | null;

          const neuronsDataset = srcNeurons?.dataset ?? "devices";

          const neuronsApiPath = "/api/apigatewaydataservices/v1";
          const neuronsBaseNorm = (srcNeurons?.base_url ?? "").replace(/\/$/, "");
          const neuronsInventoryUrl = (neuronsBaseNorm.includes(neuronsApiPath) ? neuronsBaseNorm : neuronsBaseNorm + neuronsApiPath) + `/${neuronsDataset}`;

          await supabase.from("task_logs").insert({
            task_id: task.id, action: "INFO",
            details: `Fetching Ivanti Neurons ${neuronsDataset} inventory records`,
          });
          await supabase.from("task_logs").insert({
            task_id: task.id, action: "INFO",
            details: `Neurons API URL: ${neuronsInventoryUrl}`,
          });

          const neuronsRes = await fetch("/api/ivanti-neurons-proxy", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              authUrl:      srcNeurons?.auth_url,
              clientId:     srcNeurons?.client_id,
              clientSecret: srcNeurons?.client_secret,
              baseUrl:      srcNeurons?.base_url,
              dataset:      neuronsDataset,
            }),
          });

          if (!neuronsRes.ok) {
            const errText = await neuronsRes.text().catch(() => "");
            let neuronsErrMsg = neuronsRes.statusText || String(neuronsRes.status);
            try { const j = JSON.parse(errText) as Record<string,string>; if (j.error) neuronsErrMsg = j.error; }
            catch { if (errText) neuronsErrMsg = errText.slice(0, 300); }
            throw new Error(`Ivanti Neurons fetch failed (HTTP ${neuronsRes.status}): ${neuronsErrMsg}`);
          }

          const { rows: neuronsRawRows, count: neuronsCount } = await neuronsRes.json() as {
            rows: Record<string, unknown>[];
            count: number;
          };

          await supabase.from("task_logs").insert({
            task_id: task.id, action: "INFO",
            details: `Fetched ${neuronsCount} Neurons ${neuronsDataset} record(s)`,
          });

          if (neuronsRawRows.length > 0) {
            const firstKeys = Object.keys(neuronsRawRows[0]);
            await supabase.from("task_logs").insert({
              task_id: task.id, action: "INFO",
              details: `Source fields available: ${firstKeys.join(", ")}`,
            });
          }

          if (mappingProfile?.filter_expression) {
            await supabase.from("task_logs").insert({
              task_id: task.id, action: "INFO",
              details: `Row filter expression: ${mappingProfile.filter_expression}`,
            });
          }

          let neuronsFilteredCount = 0;
          const neuronsFilteredRaw = neuronsRawRows.filter((row, idx) => {
            if (!mappingProfile?.filter_expression) return true;
            const { pass, error } = evaluateFilter(row as Record<string, unknown>, mappingProfile.filter_expression);
            if (error) console.warn(`Neurons row filter error (row ${idx + 1}):`, error);
            if (!pass) { neuronsFilteredCount++; return false; }
            return true;
          });

          if (neuronsFilteredCount > 0) {
            await supabase.from("task_logs").insert({
              task_id: task.id, action: "INFO",
              details: `Row filter: ${neuronsFilteredCount} of ${neuronsCount} rows skipped (did not match expression)`,
            });
          }

          const neuronsFilteredMapped = neuronsFilteredRaw.map((row) =>
            mappingProfile ? applyMappingProfile(row, mappingProfile, undefined) : row
          );

          // ── Route to target ──────────────────────────────────────
          if (!targetConnType || targetConnType === "file") {
            const tgtCfg = targetConnRawConfig as {
              file_type?: string; file_mode?: string;
              file_path?: string; output_file_name?: string;
            } | null;

            const fileType  = (tgtCfg?.file_type ?? "xlsx") as string;
            const fileMode  = (tgtCfg?.file_mode ?? "directory") as string;
            const dirPath   = tgtCfg?.file_path?.replace(/\/?$/, "/") ?? `exports/${task.id}/`;
            const timestamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
            const rand      = Math.random().toString(36).slice(2, 8);
            const autoName  = `neurons_${neuronsDataset}_${timestamp}_${rand}.${fileType}`;
            const withExt   = (name: string) => `${name.replace(/\.[^.]+$/, "")}.${fileType}`;
            const fileName  = fileMode === "file" && tgtCfg?.file_path
              ? withExt(tgtCfg.file_path.split("/").pop() ?? autoName)
              : tgtCfg?.output_file_name?.trim()
                ? withExt(tgtCfg.output_file_name.trim())
                : autoName;
            const storagePath = fileMode === "file" && tgtCfg?.file_path
              ? tgtCfg.file_path
              : `${dirPath}${fileName}`;

            let uploadBlob: Blob;
            if (fileType === "json") {
              uploadBlob = new Blob([JSON.stringify(neuronsFilteredMapped, null, 2)], { type: "application/json" });
            } else if (fileType === "csv") {
              const ws = XLSX.utils.json_to_sheet(neuronsFilteredMapped);
              uploadBlob = new Blob([XLSX.utils.sheet_to_csv(ws)], { type: "text/csv" });
            } else if (fileType === "xml") {
              const xmlRows = neuronsFilteredMapped.map((row) => {
                const fields = Object.entries(row)
                  .map(([k, v]) => `  <${k}>${String(v ?? "").replace(/[<>&]/g, (ch) => ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;")}</${k}>`)
                  .join("\n");
                return `<record>\n${fields}\n</record>`;
              }).join("\n");
              uploadBlob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n<records>\n${xmlRows}\n</records>`], { type: "application/xml" });
            } else {
              const ws = XLSX.utils.json_to_sheet(neuronsFilteredMapped);
              const wb2 = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb2, ws, "Export");
              const buf = XLSX.write(wb2, { type: "array", bookType: "xlsx" }) as unknown as ArrayBuffer;
              uploadBlob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            }

            const { error: uploadError } = await supabase.storage
              .from("task_files")
              .upload(storagePath, uploadBlob, { upsert: true });
            if (uploadError) throw new Error(`Failed to upload Neurons export: ${uploadError.message}`);

            const { data: signedData } = await supabase.storage
              .from("task_files")
              .createSignedUrl(storagePath, 60 * 60 * 24);
            const downloadUrl = signedData?.signedUrl ?? null;

            await supabase.from("task_logs").insert({
              task_id: task.id, action: "SUCCESS",
              details: `Export complete — ${neuronsFilteredMapped.length} records written to "${fileName}" [${fileType.toUpperCase()}]${downloadUrl ? ` — Download: ${downloadUrl}` : ""}`,
            });

          } else if (targetConnType === "ivanti") {
            // Push each Neurons record to an Ivanti ITSM business object
            const tgtRaw = targetConnRawConfig as Record<string, string> | null;
            await supabase.from("task_logs").insert({
              task_id: task.id, action: "INFO",
              details: `Sending ${neuronsFilteredMapped.length} records to Ivanti ITSM target`,
            });

            let nRowErrors = 0;
            let nRowWarns = 0;
            for (let i = 0; i < neuronsFilteredMapped.length; i++) {
                // ── Cancellation checkpoint ──────────────────────────
                if (cancelledRef.current.has(task.id)) {
                  await supabase.from("task_logs").insert({
                    task_id: task.id,
                    action: "WARN",
                    details: "Task cancelled by user.",
                  });
                  break;
                }
              const payload = neuronsFilteredMapped[i];
              try {
                await new Promise((r) => setTimeout(r, 75));
                const res = await fetchWithRetry("/api/ivanti-proxy", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ivantiUrl: tgtRaw?.url,
                    data: payload,
                    apiKey: tgtRaw?.api_key,
                    businessObject: tgtRaw?.business_object,
                    tenantId: tgtRaw?.tenant_id,
                  }),
                });
                const json = await res.json();
                if (!res.ok) nRowWarns++;
                await supabase.from("task_logs").insert({
                  task_id: task.id, action: res.ok ? "SUCCESS" : "WARN",
                  details: `Row ${i + 1} response: ${JSON.stringify(json)}`,
                });
              } catch (rowErr: unknown) {
                nRowErrors++;
                await supabase.from("task_logs").insert({
                  task_id: task.id, action: "ERROR",
                  details: `Row ${i + 1} failed: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`,
                });
              }
            }
            rowErrorCount += nRowErrors;
            rowWarnCount  += nRowWarns;

          } else {
            await supabase.from("task_logs").insert({
              task_id: task.id, action: "INFO",
              details: `Neurons source → ${targetConnType} target: no handler configured for this target type`,
            });
          }

        } else {
          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: sourceConnType
              ? `Source is a ${sourceConnType.toUpperCase()} endpoint — no handler configured for this source type`
              : "No source file attached — task completed with no data sent",
          });
        }

        } // end for (slot of slots)

        // Determine final status using in-memory counters from the current run.
        // (A DB query of task_logs would include logs from all previous runs,
        // giving incorrect results. In-memory counters are accurate for this run.)
        // Also skip the status update entirely if the task was cancelled so we
        // don't overwrite the "cancelled" status that cancelTask already set.
        const wasCancelled = cancelledRef.current.has(task.id);

        const finalStatus = wasCancelled
          ? "cancelled"
          : rowErrorCount > 0
          ? "completed_with_errors"
          : rowWarnCount > 0
          ? "completed_with_warnings"
          : "completed";

        const statusLabel = wasCancelled
          ? "Cancelled by user"
          : finalStatus === "completed_with_errors"
          ? "Completed with errors"
          : finalStatus === "completed_with_warnings"
          ? "Completed with warnings"
          : "Completed successfully";

        // ── Write run SUMMARY ────────────────────────────────────────
        {
          const durationMs   = Date.now() - taskStartTime;
          const durationSec  = Math.round(durationMs / 1000);
          const durationStr  = durationSec >= 60
            ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
            : `${durationSec}s`;
          const totalTokens  = totalInputTokens + totalOutputTokens;
          // Pricing: Haiku input $0.80/M, output $4.00/M
          const tokenCost    = (totalInputTokens / 1_000_000) * 0.80 + (totalOutputTokens / 1_000_000) * 4.00;
          const rowsProcessed = rowCreatedCount + rowUpdatedCount + rowSkipCount + rowErrorCount;

          const summaryParts: string[] = [
            `Duration: ${durationStr}`,
            `Rows Processed: ${rowsProcessed}`,
            `Created: ${rowCreatedCount}`,
            `Updated: ${rowUpdatedCount}`,
          ];
          if (rowSkipCount  > 0) summaryParts.push(`Skipped: ${rowSkipCount}`);
          if (rowWarnCount  > 0) summaryParts.push(`Warnings: ${rowWarnCount}`);
          if (rowErrorCount > 0) summaryParts.push(`Errors: ${rowErrorCount}`);
          if (totalTokens   > 0) {
            summaryParts.push(`Tokens: ${totalTokens.toLocaleString()} (in: ${totalInputTokens.toLocaleString()} / out: ${totalOutputTokens.toLocaleString()})`);
            summaryParts.push(`Token Cost: $${tokenCost.toFixed(4)}`);
          }

          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "SUMMARY",
            details: summaryParts.join(" | "),
          });
        }

        await supabase.from("task_logs").insert({
          task_id: task.id,
          action: "COMPLETED",
          details: `${statusLabel} at ${new Date().toISOString()}`,
        });

        // Always store the final run result so the user can see it.
        // For recurring tasks also advance start_date_time to the next interval;
        // the poller re-triggers the task when that time arrives.
        // Skip the status update if cancelled — cancelTask already set it.
        if (!wasCancelled && task.recurrence !== "one-time") {
          const prev = new Date(task.start_date_time);
          const next = new Date(prev);
          if (task.recurrence === "daily")        next.setDate(prev.getDate() + 1);
          else if (task.recurrence === "weekly")  next.setDate(prev.getDate() + 7);
          else if (task.recurrence === "monthly") next.setMonth(prev.getMonth() + 1);
          await supabase
            .from("scheduled_tasks")
            .update({ status: finalStatus, start_date_time: next.toISOString() })
            .eq("id", task.id);
          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: `Next run scheduled for ${next.toLocaleString()} (${task.recurrence})`,
          });
        } else if (!wasCancelled) {
          await supabase
            .from("scheduled_tasks")
            .update({ status: finalStatus })
            .eq("id", task.id);
        }
        // Patch local state immediately so the badge updates even if fetchTasks
        // or realtime has a delay or returns a null response.
        if (!wasCancelled) {
          setTasks((prev) =>
            prev.map((t) => t.id === task.id ? { ...t, status: finalStatus } : t)
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Execute] Task "${task.task_name}" failed:`, msg);

        await supabase.from("task_logs").insert({
          task_id: task.id,
          action: "ERROR",
          details: msg,
        });

        await supabase
          .from("scheduled_tasks")
          .update({ status: "cancelled" })
          .eq("id", task.id);
      } finally {
        taskAbortControllers.current.delete(task.id);
        cancelledRef.current.delete(task.id);
        executingRef.current.delete(task.id);
        setRunningTasks((p) => {
          const next = new Set(p);
          next.delete(task.id);
          return next;
        });
        setCancellingTasks((p) => {
          const next = new Set(p);
          next.delete(task.id);
          return next;
        });
        await fetchTasks();
      }
    },
    [supabase, fetchTasks]
  );

  // ── Auto-run due tasks ────────────────────────────────────
  const runDueTasks = useCallback(async () => {
    const now = new Date();
    console.log("[Poller] Checking for due tasks at", now.toISOString());

    setTasks((current) => {
      const COMPLETED_STATUSES = ["completed", "completed_with_warnings", "completed_with_errors"];
      const due = current.filter((t) => {
        const start = new Date(t.start_date_time);
        if (start > now) return false;
        if (t.status === "waiting") return true;
        // Recurring task whose last run finished and next interval has arrived
        if (t.recurrence !== "one-time" && COMPLETED_STATUSES.includes(t.status)) return true;
        return false;
      });

      due.forEach((task) => {
        if (!executingRef.current.has(task.id)) {
          console.log(`[Poller] Auto-running task "${task.task_name}"`);
          executeTask(task);
        }
      });

      return current;
    });
  }, [executeTask]);

  // ── Polling loop ──────────────────────────────────────────
  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    console.log(`[Poller] Poll interval set to ${pollInterval}s`);
    pollTimerRef.current = setInterval(async () => {
      await fetchTasks();
      await runDueTasks();
    }, pollInterval * 1000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [pollInterval, fetchTasks, runDueTasks]);

  // Restore poll interval from localStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    const stored = localStorage.getItem(POLL_KEY);
    if (stored) {
      const n = Math.max(5, parseInt(stored));
      if (n !== DEFAULT_POLL) setPollInterval(n);
    }
  }, []);

  // Persist poll interval
  useEffect(() => {
    localStorage.setItem(POLL_KEY, String(pollInterval));
  }, [pollInterval]);

  // Countdown ticker
  useEffect(() => {
    setPollCountdown(pollInterval);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      setPollCountdown((prev) => {
        if (prev <= 1) return pollInterval;
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [pollInterval]);

  // Keep refs in sync so the log-subscription callback always reads current state
  useEffect(() => { expandedLogsRef.current = expandedLogs; }, [expandedLogs]);
  useEffect(() => { fullscreenTaskIdRef.current = fullscreenTaskId; }, [fullscreenTaskId]);

  // ── Realtime subscription ─────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("scheduler-tasks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_tasks" },
        () => {
          fetchTasks();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchTasks]);

  // ── Realtime log subscription ────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("scheduler-task-logs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_logs" },
        (payload) => {
          const row = payload.new as TaskLog;
          const taskId = row.task_id;
          // Always bump the count badge
          setLogCounts((prev) => ({ ...prev, [taskId]: (prev[taskId] ?? 0) + 1 }));
          // Prepend the row live if the panel is open or fullscreen
          const isVisible =
            expandedLogsRef.current[taskId] === true ||
            fullscreenTaskIdRef.current === taskId;
          if (isVisible) {
            setTaskLogs((prev) => ({
              ...prev,
              [taskId]: [row, ...(prev[taskId] ?? [])],
            }));
          }
          // When a SUMMARY arrives, update the cached summary immediately so
          // the status-badge popover shows fresh data without requiring a re-click.
          if (row.action === "SUMMARY") {
            setLastSummaries((prev) => ({
              ...prev,
              [taskId]: { details: row.details ?? "", created_at: row.created_at },
            }));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  // ── Return from "Create new mapping" flow ─────────────────
  const pendingMappingRef = useRef<{ id: string; mode: string; taskId: string | null } | null>(null);

  useEffect(() => {
    const newMappingId = searchParams.get("selectMapping");
    if (!newMappingId) return;
    pendingMappingRef.current = {
      id: newMappingId,
      mode: searchParams.get("returnMode") ?? "create",
      taskId: searchParams.get("returnTaskId") ?? null,
    };
    const url = new URL(window.location.href);
    url.searchParams.delete("selectMapping");
    url.searchParams.delete("returnMode");
    url.searchParams.delete("returnTaskId");
    window.history.replaceState({}, "", url.toString());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pending = pendingMappingRef.current;
    if (!pending || mappingProfiles.length === 0) return;
    pendingMappingRef.current = null;

    if (pending.mode === "edit" && pending.taskId) {
      const raw = sessionStorage.getItem("scheduler_edit_draft");
      if (raw) {
        try {
          const draft = JSON.parse(raw);
          sessionStorage.removeItem("scheduler_edit_draft");
          const task = tasks.find((t) => t.id === pending.taskId);
          if (task) {
            setEditTask(task);
            setEditForm({ ...draft, mappingProfileId: pending.id, mappingSlots: draft.mappingSlots ?? [{ id: "slot-edit-0", mapping_profile_id: pending.id }], file: null });
            applyMappingDefaults(pending.id, setEditForm);
          }
        } catch { /* ignore */ }
      }
    } else {
      const raw = sessionStorage.getItem("scheduler_create_draft");
      if (raw) {
        try {
          const draft = JSON.parse(raw);
          sessionStorage.removeItem("scheduler_create_draft");
          setForm({ ...draft, mappingProfileId: pending.id, mappingSlots: draft.mappingSlots ?? [{ id: "slot-new-0", mapping_profile_id: pending.id }], file: null });
          applyMappingDefaults(pending.id, setForm);
        } catch { /* ignore */ }
      } else {
        setForm((p) => ({ ...p, mappingProfileId: pending.id, mappingSlots: p.mappingSlots.length ? [{ ...p.mappingSlots[0], mapping_profile_id: pending.id }, ...p.mappingSlots.slice(1)] : [{ id: "slot-new-0", mapping_profile_id: pending.id }] }));
        applyMappingDefaults(pending.id, setForm);
      }
    }
  }, [mappingProfiles, tasks]);





  // ── Log helpers ───────────────────────────────────────────
  async function fetchLogs(taskId: string) {
    setLogsLoading((p) => ({ ...p, [taskId]: true }));
    const { data } = await supabase
      .from("task_logs")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false });
    setTaskLogs((p) => ({ ...p, [taskId]: data ?? [] }));
    setLogsLoading((p) => ({ ...p, [taskId]: false }));
  }

  // Silent version — no loading spinner, used by the live-poll loop
  const silentFetchLogs = useCallback(async (taskId: string) => {
    const { data } = await supabase
      .from("task_logs")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false });
    if (data) {
      setTaskLogs((p) => ({ ...p, [taskId]: data }));
      setLogCounts((p) => ({ ...p, [taskId]: data.length }));
    }
  }, [supabase]);

  // Poll every 2 s for any task whose log panel is currently open (inline or fullscreen)
  useEffect(() => {
    const activeTasks = new Set<string>([
      ...Object.entries(expandedLogs)
        .filter(([, open]) => open)
        .map(([id]) => id),
      ...(fullscreenTaskId ? [fullscreenTaskId] : []),
    ]);
    if (activeTasks.size === 0) return;
    const timer = setInterval(() => {
      activeTasks.forEach((id) => silentFetchLogs(id));
    }, 2000);
    return () => clearInterval(timer);
  }, [expandedLogs, fullscreenTaskId, silentFetchLogs]);

  async function toggleLogs(taskId: string) {
    const next = !expandedLogs[taskId];
    setExpandedLogs((p) => ({ ...p, [taskId]: next }));
    if (next) await fetchLogs(taskId);
  }

  /** Fetch the most recent SUMMARY log for a task (always re-queries DB). */
  async function fetchLastSummary(taskId: string) {
    const { data } = await supabase
      .from("task_logs")
      .select("details, created_at")
      .eq("task_id", taskId)
      .eq("action", "SUMMARY")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastSummaries((prev) => ({
      ...prev,
      [taskId]: data ? { details: data.details ?? "", created_at: data.created_at } : null,
    }));
  }

  function toggleSummaryPopover(taskId: string, e: React.MouseEvent<HTMLButtonElement>) {
    if (summaryPopoverId === taskId) {
      setSummaryPopoverId(null);
      setSummaryPopoverPos(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setSummaryPopoverPos({ top: rect.bottom + 8, left: rect.left });
      setSummaryPopoverId(taskId);
      void fetchLastSummary(taskId);
    }
  }

  async function clearLogs(taskId: string) {
    await supabase.from("task_logs").delete().eq("task_id", taskId);
    setTaskLogs((p) => ({ ...p, [taskId]: [] }));
  }

  function copyLogs(taskId: string) {
    const logs = taskLogs[taskId] ?? [];
    const text = logs
      .map(
        (l) =>
          `[${new Date(l.created_at).toLocaleString()}] ${l.action}: ${
            l.details ?? ""
          }`
      )
      .join("\n");
    navigator.clipboard.writeText(text);
  }

  // ── Create task ───────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {

      const startUtc = new Date(form.startDateTime).toISOString();

      const { error } = await supabase.from("scheduled_tasks").insert({
        task_name: form.taskName,
        start_date_time: startUtc,
        recurrence: form.recurrence,
        mapping_profile_id: form.mappingSlots[0]?.mapping_profile_id ?? form.mappingProfileId ?? null,
        mapping_slots: form.mappingSlots.length > 1 ? form.mappingSlots : [],
        source_connection_id: null,
        target_connection_id: null,
        status: "waiting",
        write_mode: form.writeMode ?? "upsert",
        created_by: userId,
      });

      if (error) throw error;
      setForm(EMPTY_FORM);
      await fetchTasks();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create task"
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Delete task ───────────────────────────────────────────
  async function cancelTask(id: string) {
    // Show cancelling state immediately for visual feedback
    setCancellingTasks((p) => new Set(p).add(id));
    // Signal the in-browser execution loop to stop at its next row-boundary checkpoint
    cancelledRef.current.add(id);
    // Immediately abort any in-flight fetch (AI pre-fetch, proxy calls, etc.)
    taskAbortControllers.current.get(id)?.abort();
    // Also update the DB so the status reflects immediately
    await supabase
      .from("scheduled_tasks")
      .update({ status: "cancelled" })
      .eq("id", id);
    await fetchTasks();
  }

  async function deleteTask(id: string) {
    if (!confirm("Delete this task and all its logs?")) return;
    await supabase.from("scheduled_tasks").delete().eq("id", id);
    await fetchTasks();
  }

  // ── DateTime quick-pick helper ────────────────────────────
  function toDateTimeLocal(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  // ── Open edit modal ───────────────────────────────────────
  function openEdit(task: ScheduledTask) {
    setEditTask(task);
    setEditForm({
      taskName: task.task_name,
      startDateTime: toLocalDatetimeString(task.start_date_time),
      recurrence: task.recurrence,
      mappingProfileId: task.mapping_profile_id ?? null,
      mappingSlots: ((task.mapping_slots ?? []) as MappingSlot[]).length > 0
        ? (task.mapping_slots as MappingSlot[])
        : [{ id: "slot-edit-0", mapping_profile_id: task.mapping_profile_id ?? null }],
      writeMode: (task.write_mode ?? "upsert") as "upsert" | "create_only",
    });
  }

  // ── Save edit ─────────────────────────────────────────────
  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editTask) return;
    setEditSubmitting(true);

    try {
      const startUtc = new Date(editForm.startDateTime).toISOString();

      const { error } = await supabase
        .from("scheduled_tasks")
        .update({
          task_name: editForm.taskName,
          start_date_time: startUtc,
          recurrence: editForm.recurrence,
          mapping_profile_id: editForm.mappingSlots[0]?.mapping_profile_id ?? editForm.mappingProfileId ?? null,
          mapping_slots: editForm.mappingSlots.length > 1 ? editForm.mappingSlots : [],
          source_connection_id: null,
          target_connection_id: null,
          status: "waiting",
          write_mode: editForm.writeMode ?? "upsert",
        })
        .eq("id", editTask.id);

      if (error) throw error;

      await supabase.from("task_logs").insert({
        task_id: editTask.id,
        action: "EDITED",
        details: `Task edited at ${new Date().toISOString()}`,
      });

      setEditTask(null);
      await fetchTasks();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setEditSubmitting(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(99,102,241,0.06)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </button>
            <span className="text-gray-700">|</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">Task Scheduler</span>
            </div>
          </div>

          {/* Polling control — visible to administrator and schedule_administrator roles */}
          {canControlPoll && (
          <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-2xl px-4 py-2">
            {/* Animated icon */}
            <RefreshCw
              className="w-3.5 h-3.5 text-indigo-400 shrink-0"
              style={{ animation: `spin ${pollInterval}s linear infinite` }}
            />
            <span className="text-xs text-gray-400 shrink-0">Poll every</span>

            {/* Preset buttons */}
            <div className="flex items-center gap-1">
              {[10, 30, 60, 300].map((s) => (
                <button
                  key={s}
                  onClick={() => { setPollInterval(s); setPollCustom(""); setPollCountdown(s); }}
                  className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-all ${
                    pollInterval === s && pollCustom === ""
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white"
                  }`}
                >
                  {s < 60 ? `${s}s` : `${s / 60}m`}
                </button>
              ))}
            </div>

            {/* Custom input */}
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={5}
                placeholder="Custom"
                value={pollCustom}
                onChange={(e) => {
                  setPollCustom(e.target.value);
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 5) setPollInterval(val);
                }}
                className="w-16 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-white text-xs text-center placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-xs text-gray-500">s</span>
            </div>

            {/* Countdown */}
            <div className="flex items-center gap-1 ml-1 border-l border-gray-700 pl-3">
              <span className="text-xs text-gray-500">next in</span>
              <span className="text-xs font-mono font-semibold text-indigo-400 w-7 text-right">
                {pollCountdown}s
              </span>
            </div>
          </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        {/* ── Create Task Form ── */}
        <section>
          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <Plus className="w-5 h-5 text-indigo-400" />
            Create New Task
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-xl">
            {formError && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-sm">
                {formError}
              </div>
            )}
            <form onSubmit={handleCreate} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Task Name */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Task Name
                  </label>
                  <input
                    type="text"
                    value={form.taskName}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, taskName: e.target.value }))
                    }
                    required
                    placeholder="e.g. Morning Sync"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

{/* Mapping Profiles — multi-slot */}
                <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <GitMerge className="w-3 h-3 text-purple-400" />
                      Mapping Profiles
                      {form.mappingSlots.length > 1 && (
                        <span className="ml-1 text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                          {form.mappingSlots.length} slots
                        </span>
                      )}
                    </label>
                    <div className="space-y-2">
                      {form.mappingSlots.map((slot, slotIdx) => (
                        <div key={slot.id} className="flex items-center gap-2">
                          {form.mappingSlots.length > 1 && (
                            <span className="text-xs text-gray-600 w-5 shrink-0 text-center font-mono">
                              {slotIdx + 1}.
                            </span>
                          )}
                          <select
                            value={slot.mapping_profile_id ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "__new_mapping__") {
                                sessionStorage.setItem("scheduler_create_draft", JSON.stringify({form}));
                                router.push("/mappings/new?returnTo=scheduler&returnMode=create");
                                return;
                              }
                              if (val === "__copy_mapping__") {
                                setCopyMappingSourceId(slot.mapping_profile_id ?? mappingProfiles[0]?.id ?? "");
                                setCopyMappingName("");
                                setCopyMappingTarget("create");
                                return;
                              }
                              setForm((p) => ({
                                ...p,
                                mappingSlots: p.mappingSlots.map((s, i) =>
                                  i === slotIdx ? { ...s, mapping_profile_id: val || null } : s
                                ),
                              }));
                            }}
                            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          >
                            <option value="">— No mapping (send raw data) —</option>
                            {mappingProfiles.map((mp) => (
                              <option key={mp.id} value={mp.id}>
                                {mp.name} ({mp.mappings?.length ?? 0} mappings)
                              </option>
                            ))}
                            <option value="__new_mapping__">+ Create new mapping...</option>
                            <option value="__copy_mapping__">+ Copy existing mapping...</option>
                          </select>
                          {form.mappingSlots.length > 1 && (
                            <input
                              type="text"
                              value={slot.label ?? ""}
                              onChange={(e) => setForm((p) => ({
                                ...p,
                                mappingSlots: p.mappingSlots.map((s, i) =>
                                  i === slotIdx ? { ...s, label: e.target.value } : s
                                ),
                              }))}
                              placeholder="Label (optional)"
                              className="w-32 bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                          )}
                          {slotIdx === 0 ? (
                            <button
                              type="button"
                              onClick={() => router.push("/mappings")}
                              className="px-3 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-purple-400 rounded-xl transition-all shrink-0"
                              title="Manage mapping profiles"
                            >
                              <GitMerge className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setForm((p) => ({
                                ...p,
                                mappingSlots: p.mappingSlots.filter((_, i) => i !== slotIdx),
                              }))}
                              className="px-3 py-3 text-gray-500 hover:text-red-400 transition-colors shrink-0"
                              title="Remove slot"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({
                          ...p,
                          mappingSlots: [...p.mappingSlots, { id: `slot-${Date.now()}`, mapping_profile_id: null }],
                        }))}
                        className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors mt-1 py-1"
                      >
                        <Plus className="w-3 h-3" />
                        Add profile slot
                      </button>
                    </div>
                    {form.mappingSlots.some((s) => s.mapping_profile_id) && (
                      <p className="text-xs text-purple-400 mt-1.5 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Connections resolved from each mapping profile
                      </p>
                    )}
                  </div>

                {/* Recurrence */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Recurrence
                  </label>
                  <select
                    value={form.recurrence}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        recurrence: e.target.value as RecurrenceType,
                      }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    {RECURRENCES.map((r) => (
                      <option key={r} value={r}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Write Mode */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Write Mode
                  </label>
                  <select
                    value={form.writeMode ?? "upsert"}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        writeMode: e.target.value as "upsert" | "create_only",
                      }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="upsert">Upsert — create or update</option>
                    <option value="create_only">Create only — skip if exists</option>
                  </select>
                </div>

                {/* Start Date & Time */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Start Date &amp; Time{" "}
                    <span className="text-gray-600 normal-case font-normal">
                      (local)
                    </span>
                  </label>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, startDateTime: toDateTimeLocal(new Date()) }))}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-all"
                    >
                      Now
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, startDateTime: toDateTimeLocal(new Date(Date.now() + 2 * 60 * 1000)) }))}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-all"
                    >
                      Now +2m
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    value={form.startDateTime}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        startDateTime: e.target.value,
                      }))
                    }
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-lg shadow-indigo-600/20"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  {submitting ? "Creating…" : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* ── Task List ── */}
        <section>
          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            Tasks{" "}
            <span className="text-sm font-normal text-gray-500 ml-1">
              ({tasks.length})
            </span>
          </h2>

          {tasks.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-12 text-center">
              <Clock className="w-12 h-12 text-gray-700 mx-auto mb-4" />
              <p className="text-gray-500">
                No tasks yet. Create your first task above.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => {
                const badge =
                  STATUS_BADGE[task.status] ?? STATUS_BADGE.waiting;
                const icon = STATUS_ICON[task.status];
                const isRunning = runningTasks.has(task.id);
                const logsOpen = expandedLogs[task.id] ?? false;
                const logs = taskLogs[task.id] ?? [];

                return (
                  <div key={task.id} className="relative">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-lg">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5">
                      {/* Status badge — click to show last run summary */}
                      <div className="shrink-0">
                        <button
                          onClick={(e) => toggleSummaryPopover(task.id, e)}
                          title="Click to view last run summary"
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-opacity hover:opacity-80 ${badge.class}`}
                        >
                          {icon}
                          {badge.label}
                        </button>
                      </div>

                      {/* Task info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate">
                          {task.task_name}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          {task.mapping_profile_id && (
                            <GitMerge className="w-3 h-3 text-purple-400 shrink-0" />
                          )}
                          <span>{mappingProfiles.find(m => m.id === task.mapping_profile_id)?.name ?? "No mapping"}</span>
                          <span>&bull;</span>
                          <span>{task.recurrence.charAt(0).toUpperCase() + task.recurrence.slice(1)}</span>
                          <span>&bull;</span>
                          <span>{formatLocalDateTime(task.start_date_time)}</span>
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <button
                          onClick={() => openEdit(task)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-all"
                        >
                          <Edit2 className="w-3 h-3" />
                          Edit
                        </button>

                        <button
                          onClick={() => executeTask(task)}
                          disabled={isRunning}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                        >
                          {isRunning ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          {isRunning ? "Running…" : "Run Now"}
                        </button>

                        {(() => {
                          const isCancelling = cancellingTasks.has(task.id);
                          return (
                            <button
                              onClick={() => cancelTask(task.id)}
                              disabled={task.status === "cancelled" || !isRunning || isCancelling}
                              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-all disabled:opacity-40 ${
                                isCancelling
                                  ? "bg-orange-500/20 border-orange-500/40 text-orange-300 cursor-not-allowed"
                                  : "bg-red-500/10 hover:bg-red-500/20 border-red-500/25 text-red-400"
                              }`}
                              title={
                                isCancelling ? "Cancelling — finishing current row…"
                                : task.status === "cancelled" ? "Already cancelled"
                                : !isRunning ? "Task is not running"
                                : "Cancel task"
                              }
                            >
                              {isCancelling
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <X className="w-3 h-3" />}
                              {isCancelling ? "Cancelling…" : "Cancel"}
                            </button>
                          );
                        })()}

                        <button
                          onClick={() => toggleLogs(task.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-all"
                        >
                          {logsOpen ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                          Logs
                          {(logCounts[task.id] ?? logs.length) > 0 && (
                            <span className="ml-0.5 px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded-md text-xs leading-none">
                              {logsOpen ? logs.length : (logCounts[task.id] ?? logs.length)}
                            </span>
                          )}
                        </button>

                        <button
                          onClick={() => deleteTask(task.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 rounded-lg text-xs font-medium transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Expandable Logs */}
                    {logsOpen && (
                      <div className="border-t border-gray-800 bg-gray-950/50">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                              Execution Logs
                            </span>
                            {/* Live stats derived from loaded logs */}
                            {(() => {
                              const created = logs.filter(l => l.action === "SUCCESS" && !(l.details ?? "").includes("Updated")).length;
                              const updated = logs.filter(l => l.action === "SUCCESS" && (l.details ?? "").includes("Updated")).length;
                              const skipped = logs.filter(l => l.action === "SKIP").length;
                              const warned  = logs.filter(l => l.action === "WARN").length;
                              const errored = logs.filter(l => l.action === "ERROR").length;
                              return (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {created > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">{created} created</span>}
                                  {updated > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/25">{updated} updated</span>}
                                  {skipped > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/25">{skipped} skipped</span>}
                                  {warned  > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">{warned} warnings</span>}
                                  {errored > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/25">{errored} errors</span>}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => fetchLogs(task.id)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded-lg text-xs transition-all"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Refresh
                            </button>
                            <button
                              onClick={() => copyLogs(task.id)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded-lg text-xs transition-all"
                            >
                              <Copy className="w-3 h-3" />
                              Copy Logs
                            </button>
                            <button
                              onClick={() => clearLogs(task.id)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 rounded-lg text-xs transition-all"
                            >
                              <X className="w-3 h-3" />
                              Clear Logs
                            </button>
                            <button
                              onClick={() => setFullscreenTaskId(task.id)}
                              title="Full screen logs"
                              className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded-lg text-xs transition-all"
                            >
                              <Maximize2 className="w-3 h-3" />
                              Full Screen
                            </button>
                          </div>
                        </div>

                        <div className="px-5 py-4 max-h-64 overflow-y-auto font-mono text-xs space-y-1.5">
                          {logsLoading[task.id] ? (
                            <div className="flex items-center gap-2 text-gray-500">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Loading logs…
                            </div>
                          ) : logs.length === 0 ? (
                            <p className="text-gray-600">
                              No logs yet for this task.
                            </p>
                          ) : (
                            logs.map((log) => {
                              const levelColor: Record<string, string> = {
                                ERROR: "text-red-400",
                                WARN: "text-yellow-400",
                                SUCCESS: "text-emerald-400",
                                SKIP: "text-sky-400",
                                COMPLETED: "text-blue-400",
                                STARTED: "text-indigo-400",
                                EDITED: "text-purple-400",
                                SUMMARY: "text-violet-400",
                              };
                              const color =
                                levelColor[log.action] ?? "text-gray-400";

                              // ── SUMMARY: rendered as a stat card ────────────
                              if (log.action === "SUMMARY") {
                                const parts = (log.details ?? "").split(" | ");
                                return (
                                  <div key={log.id} className="my-1 p-2.5 rounded-lg border border-violet-500/30 bg-violet-500/5">
                                    <div className="flex items-center gap-2 mb-1.5">
                                      <span className="text-gray-600 text-[10px]">{new Date(log.created_at).toLocaleTimeString()}</span>
                                      <span className="font-bold text-violet-400 text-[10px] uppercase tracking-wider">Run Summary</span>
                                    </div>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                      {parts.map((part, pi) => {
                                        const [label, value] = part.split(": ");
                                        return (
                                          <span key={pi} className="text-[10px]">
                                            <span className="text-gray-500">{label}: </span>
                                            <span className="text-gray-200 font-medium">{value}</span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div key={log.id} className="flex gap-3">
                                  <span className="text-gray-600 shrink-0">
                                    {new Date(
                                      log.created_at
                                    ).toLocaleTimeString()}
                                  </span>
                                  <span
                                    className={`shrink-0 font-bold ${color}`}
                                  >
                                    [{log.action}]
                                  </span>
                                  <span className="text-gray-300 break-all">
                                    {(() => {
                                      // Render clickable links for "— Download: <url>" and "— Details: <url>".
                                      // All other text (including bare URLs in INFO lines) stays as plain text.
                                      const details = log.details ?? "";
                                      const lnkMatch = details.match(/— (Download|Details): (https?:\/\/\S+)/);
                                      if (lnkMatch) {
                                        const fullMarker = lnkMatch[0];
                                        const label = lnkMatch[1] === "Download" ? "Download" : "View Record";
                                        const url = lnkMatch[2];
                                        const before = details.slice(0, details.indexOf(fullMarker));
                                        return <>{before}<a href={url} target="_blank" rel="noopener noreferrer" className="underline text-indigo-400 hover:text-indigo-300">{label}</a></>;
                                      }
                                      return <>{details}</>;
                                    })()}
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ── Summary Popover (fixed, immune to ancestor clipping) ── */}
      {summaryPopoverId && summaryPopoverPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setSummaryPopoverId(null); setSummaryPopoverPos(null); }} />
          <div
            className="fixed z-50 w-72 bg-gray-900 border border-violet-500/30 rounded-xl shadow-2xl p-3"
            style={{ top: summaryPopoverPos.top, left: summaryPopoverPos.left }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">
                {runningTasks.has(summaryPopoverId) ? "Task Running" : "Last Run Summary"}
              </span>
              <button
                onClick={() => { setSummaryPopoverId(null); setSummaryPopoverPos(null); }}
                className="text-gray-600 hover:text-gray-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {runningTasks.has(summaryPopoverId) ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
                <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                Running — summary will appear when complete.
              </div>
            ) : lastSummaries[summaryPopoverId] === undefined ? (
              <div className="flex items-center gap-1.5 text-gray-500 text-xs py-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading…
              </div>
            ) : lastSummaries[summaryPopoverId] === null ? (
              <p className="text-xs text-gray-500 py-1">No completed runs yet.</p>
            ) : (() => {
              const summary = lastSummaries[summaryPopoverId]!;
              const parts = summary.details.split(" | ");
              const statMap: Record<string, string> = {};
              for (const p of parts) {
                const idx = p.indexOf(": ");
                if (idx !== -1) statMap[p.slice(0, idx)] = p.slice(idx + 2);
              }
              return (
                <>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2">
                    {[
                      ["Duration",   statMap["Duration"]],
                      ["Rows",       statMap["Rows Processed"]],
                      ["Created",    statMap["Created"]],
                      ["Updated",    statMap["Updated"]],
                      ["Skipped",    statMap["Skipped"]],
                      ["Warnings",   statMap["Warnings"]],
                      ["Errors",     statMap["Errors"]],
                      ["Token Cost", statMap["Token Cost"]],
                    ].filter(([, v]) => v != null && v !== "0" && v !== undefined).map(([label, value]) => (
                      <div key={label} className="flex items-baseline gap-1">
                        <span className="text-[10px] text-gray-500 shrink-0">{label}:</span>
                        <span className="text-[10px] text-gray-200 font-medium truncate">{value}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-600 border-t border-gray-800 pt-1.5 mt-1">
                    {new Date(summary.created_at).toLocaleString(undefined, {
                      month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* ── Fullscreen Logs Overlay ── */}
      {fullscreenTaskId && (() => {
        const fsTask = tasks.find((t) => t.id === fullscreenTaskId);
        const fsLogs = taskLogs[fullscreenTaskId] ?? [];
        const fsIsRunning = runningTasks.has(fullscreenTaskId);
        const fsIsCancelling = cancellingTasks.has(fullscreenTaskId);
        const levelColor: Record<string, string> = {
          ERROR: "text-red-400",
          WARN: "text-yellow-400",
          SUCCESS: "text-emerald-400",
          SKIP: "text-sky-400",
          COMPLETED: "text-blue-400",
          STARTED: "text-indigo-400",
          EDITED: "text-purple-400",
          SUMMARY: "text-violet-400",
        };
        const fsCreated = fsLogs.filter(l => l.action === "SUCCESS" && !(l.details ?? "").includes("Updated")).length;
        const fsUpdated = fsLogs.filter(l => l.action === "SUCCESS" && (l.details ?? "").includes("Updated")).length;
        const fsSkipped = fsLogs.filter(l => l.action === "SKIP").length;
        const fsWarned  = fsLogs.filter(l => l.action === "WARN").length;
        const fsErrored = fsLogs.filter(l => l.action === "ERROR").length;
        return (
          <div
            className="fixed inset-0 z-50 flex flex-col bg-gray-950"
            style={{ fontFamily: "inherit" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Execution Logs
                </span>
                {fsTask && (
                  <span className="text-xs text-gray-500">{fsTask.task_name}</span>
                )}
                {/* Live run stats */}
                {fsCreated > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">{fsCreated} created</span>}
                {fsUpdated > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/25">{fsUpdated} updated</span>}
                {fsSkipped > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/25">{fsSkipped} skipped</span>}
                {fsWarned  > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">{fsWarned} warnings</span>}
                {fsErrored > 0  && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/25">{fsErrored} errors</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchLogs(fullscreenTaskId)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded-lg text-xs transition-all"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </button>
                <button
                  onClick={() => copyLogs(fullscreenTaskId)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded-lg text-xs transition-all"
                >
                  <Copy className="w-3 h-3" />
                  Copy Logs
                </button>
                <button
                  onClick={() => clearLogs(fullscreenTaskId)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 rounded-lg text-xs transition-all"
                >
                  <X className="w-3 h-3" />
                  Clear Logs
                </button>

                {/* Divider */}
                <div className="w-px h-5 bg-gray-700 mx-1" />

                {/* Run Now */}
                <button
                  onClick={() => fsTask && executeTask(fsTask)}
                  disabled={fsIsRunning}
                  className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                >
                  {fsIsRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  {fsIsRunning ? "Running…" : "Run Now"}
                </button>

                {/* Cancel */}
                <button
                  onClick={() => cancelTask(fullscreenTaskId)}
                  disabled={!fsIsRunning || fsIsCancelling}
                  className={`flex items-center gap-1 px-2.5 py-1 border rounded-lg text-xs font-medium transition-all disabled:opacity-40 ${
                    fsIsCancelling
                      ? "bg-orange-500/20 border-orange-500/40 text-orange-300 cursor-not-allowed"
                      : "bg-red-500/10 hover:bg-red-500/20 border-red-500/25 text-red-400"
                  }`}
                  title={fsIsCancelling ? "Cancelling…" : !fsIsRunning ? "Task is not running" : "Cancel task"}
                >
                  {fsIsCancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  {fsIsCancelling ? "Cancelling…" : "Cancel"}
                </button>

                <div className="w-px h-5 bg-gray-700 mx-1" />

                <button
                  onClick={() => setFullscreenTaskId(null)}
                  title="Exit full screen"
                  className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded-lg text-xs transition-all"
                >
                  <Minimize2 className="w-3 h-3" />
                  Exit Full Screen
                </button>
              </div>
            </div>
            {/* Log body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 font-mono text-xs space-y-1.5">
              {logsLoading[fullscreenTaskId] ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading logs…
                </div>
              ) : fsLogs.length === 0 ? (
                <p className="text-gray-600">No logs yet for this task.</p>
              ) : (
                fsLogs.map((log) => {
                  const color = levelColor[log.action] ?? "text-gray-400";
                  const details = log.details ?? "";

                  // ── SUMMARY: rendered as a stat card ──────────────────
                  if (log.action === "SUMMARY") {
                    const parts = details.split(" | ");
                    return (
                      <div key={log.id} className="my-1 p-2.5 rounded-lg border border-violet-500/30 bg-violet-500/5">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-gray-600 text-[10px]">{new Date(log.created_at).toLocaleTimeString()}</span>
                          <span className="font-bold text-violet-400 text-[10px] uppercase tracking-wider">Run Summary</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {parts.map((part, pi) => {
                            const [label, value] = part.split(": ");
                            return (
                              <span key={pi} className="text-[10px]">
                                <span className="text-gray-500">{label}: </span>
                                <span className="text-gray-200 font-medium">{value}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  const lnkMatch = details.match(/— (Download|Details): (https?:\/\/\S+)/);
                  return (
                    <div key={log.id} className="flex gap-3">
                      <span className="text-gray-600 shrink-0">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                      <span className={`shrink-0 font-bold ${color}`}>
                        [{log.action}]
                      </span>
                      <span className="text-gray-300 break-all">
                        {lnkMatch ? (
                          <>
                            {details.slice(0, details.indexOf(lnkMatch[0]))}
                            <a href={lnkMatch[2]} target="_blank" rel="noopener noreferrer" className="underline text-indigo-400 hover:text-indigo-300">
                              {lnkMatch[1] === "Download" ? "Download" : "View Record"}
                            </a>
                          </>
                        ) : (
                          <>{details}</>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Run Prompt Modal ── */}

      {/* ── Edit Modal ── */}
      {editTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setEditTask(null)}
          />
          <div className="relative bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-8 py-6 border-b border-gray-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-indigo-400" />
                Edit Task
              </h3>
              <button
                onClick={() => setEditTask(null)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSave} className="p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Task Name
                  </label>
                  <input
                    type="text"
                    value={editForm.taskName}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, taskName: e.target.value }))
                    }
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Start Date &amp; Time{" "}
                    <span className="text-gray-600 normal-case font-normal">
                      (local)
                    </span>
                  </label>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setEditForm((p) => ({ ...p, startDateTime: toDateTimeLocal(new Date()) }))}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-all"
                    >
                      Now
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditForm((p) => ({ ...p, startDateTime: toDateTimeLocal(new Date(Date.now() + 2 * 60 * 1000)) }))}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-all"
                    >
                      Now +2m
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    value={editForm.startDateTime}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        startDateTime: e.target.value,
                      }))
                    }
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Recurrence
                  </label>
                  <select
                    value={editForm.recurrence}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        recurrence: e.target.value as RecurrenceType,
                      }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {RECURRENCES.map((r) => (
                      <option key={r} value={r}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Write Mode */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Write Mode
                  </label>
                  <select
                    value={editForm.writeMode ?? "upsert"}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        writeMode: e.target.value as "upsert" | "create_only",
                      }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="upsert">Upsert — create or update</option>
                    <option value="create_only">Create only — skip if exists</option>
                  </select>
                </div>

{/* Mapping Profiles — multi-slot */}
                <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <GitMerge className="w-3 h-3 text-purple-400" />
                      Mapping Profiles
                      {editForm.mappingSlots.length > 1 && (
                        <span className="ml-1 text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                          {editForm.mappingSlots.length} slots
                        </span>
                      )}
                    </label>
                    <div className="space-y-2">
                      {editForm.mappingSlots.map((slot, slotIdx) => (
                        <div key={slot.id} className="flex items-center gap-2">
                          {editForm.mappingSlots.length > 1 && (
                            <span className="text-xs text-gray-600 w-5 shrink-0 text-center font-mono">
                              {slotIdx + 1}.
                            </span>
                          )}
                          <select
                            value={slot.mapping_profile_id ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "__new_mapping__") {
                                sessionStorage.setItem("scheduler_edit_draft", JSON.stringify({editForm}));
                                router.push("/mappings/new?returnTo=scheduler&returnMode=edit&returnTaskId=" + (editTask?.id ?? ""));
                                return;
                              }
                              if (val === "__copy_mapping__") {
                                setCopyMappingSourceId(slot.mapping_profile_id ?? mappingProfiles[0]?.id ?? "");
                                setCopyMappingName("");
                                setCopyMappingTarget("edit");
                                return;
                              }
                              setEditForm((p) => ({
                                ...p,
                                mappingSlots: p.mappingSlots.map((s, i) =>
                                  i === slotIdx ? { ...s, mapping_profile_id: val || null } : s
                                ),
                              }));
                            }}
                            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          >
                            <option value="">— No mapping (send raw data) —</option>
                            {mappingProfiles.map((mp) => (
                              <option key={mp.id} value={mp.id}>
                                {mp.name} ({mp.mappings?.length ?? 0} mappings)
                              </option>
                            ))}
                            <option value="__new_mapping__">+ Create new mapping...</option>
                            <option value="__copy_mapping__">+ Copy existing mapping...</option>
                          </select>
                          {editForm.mappingSlots.length > 1 && (
                            <input
                              type="text"
                              value={slot.label ?? ""}
                              onChange={(e) => setEditForm((p) => ({
                                ...p,
                                mappingSlots: p.mappingSlots.map((s, i) =>
                                  i === slotIdx ? { ...s, label: e.target.value } : s
                                ),
                              }))}
                              placeholder="Label (optional)"
                              className="w-32 bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                          )}
                          {slotIdx === 0 ? (
                            <button
                              type="button"
                              onClick={() => router.push("/mappings")}
                              className="px-3 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-purple-400 rounded-xl transition-all shrink-0"
                              title="Manage mapping profiles"
                            >
                              <GitMerge className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditForm((p) => ({
                                ...p,
                                mappingSlots: p.mappingSlots.filter((_, i) => i !== slotIdx),
                              }))}
                              className="px-3 py-3 text-gray-500 hover:text-red-400 transition-colors shrink-0"
                              title="Remove slot"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setEditForm((p) => ({
                            ...p,
                            mappingSlots: [
                              ...p.mappingSlots,
                              { id: `slot-edit-${Date.now()}`, mapping_profile_id: null },
                            ],
                          }))
                        }
                        className="mt-2 flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 hover:border-gray-500 text-gray-400 rounded-xl text-xs transition-all"
                      >
                        <Plus className="w-3 h-3" />
                        Add Slot
                      </button>
                    </div>
                  </div>

                  {/* Write Mode */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Write Mode
                    </label>
                    <select
                      value={editForm.writeMode}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          writeMode: e.target.value as "upsert" | "create_only",
                        }))
                      }
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="upsert">Upsert (create or update)</option>
                      <option value="create_only">Create only (skip if exists)</option>
                    </select>
                  </div>

                </div>

              <p className="text-xs text-yellow-400/70 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3">
                ⚠️ Saving will reset this task&apos;s status back to
                &quot;Waiting&quot;.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditTask(null)}
                  className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-600/20"
                >
                  {editSubmitting && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {editSubmitting ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
