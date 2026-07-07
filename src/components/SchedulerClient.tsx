"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Dispatch, SetStateAction } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import * as XLSX from "xlsx";
import {
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
  Save,
  Bug,
  GripVertical,
  CalendarRange,
  Workflow,
} from "lucide-react";
import { TaskPlumbingModal } from "./TaskPlumbingModal";
import type {
  Profile,
  ScheduledTask,
  TaskLog,
  RecurrenceType,
  MappingProfile,
  EndpointConnection,
  AttachmentRule,
  InsightStep,
  InsightRecordType,
  TaskRun,
} from "@/lib/types";
import { applyMappingProfile, MappingSlot } from "@/lib/types";
import { evaluateFilter } from "@/lib/filterExpression";
import { GitMerge, Plug, BookOpen, Building2, Lock, Shield, ShieldOff, ExternalLink, ChevronRight, Server } from "lucide-react";

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
  "hourly",
  "daily",
  "weekly",
  "monthly",
];

const POLL_KEY = "phx2_poll_interval";
const DEFAULT_POLL = 30;

// ─── Types ───────────────────────────────────────────────────

import CustomerSwitcher, { type CustomerOption } from "@/components/CustomerSwitcher";

interface SkuRunException {
  id: string;
  task_id: string;
  task_name: string;
  customer_id: string | null;
  customer_name: string | null;
  run_at: string;
  exceptions: { sku: string; row: number; targetField: string }[];
  status: "pending" | "resolved";
  rerun_at: string | null;
}

interface Props {
  profile: Profile | null;
  initialTasks: ScheduledTask[];
  userId: string;
  isReadOnly?: boolean;
  isAdmin?: boolean;
  isAuditor?: boolean;
  customers?: CustomerOption[];
  activeCustomerId?: string | null;
}

interface FormState {
  taskName: string;
  startDateTime: string;
  recurrence: RecurrenceType;
  mappingProfileId: string | null;
  mappingSlots: MappingSlot[];
  writeMode: "upsert" | "create_only" | "update_only";
  customerId: string | null;
  targetConnectionId: string | null;
  /** Storage folder prefix used when a slot's source connection has no file_path set.
   *  e.g. "mikeco" → resolves Assets.xlsx as "mikeco/Assets.xlsx" */
  sourceDirectory: string;
  debugMode: boolean;
  /** Insight multi-step config (one step per Ivanti record class) */
  insightSteps: InsightStep[];
  /** When true, emit one row per serial number; drop lines with no serials. */
  expandSerials: boolean;
  /** Import window for vendor API sources (Insight, Dell, CDW). ISO date strings YYYY-MM-DD. */
  importWindowStart: string;
  importWindowEnd:   string;
  /** Relative lookback in days. When > 0, overrides absolute window at runtime. */
  lookbackDays:      number | null;
}

const EMPTY_FORM: FormState = {
  taskName: "",
  startDateTime: "",
  recurrence: "one-time",
  mappingProfileId: null,
  mappingSlots: [{ id: "slot-new-0", mapping_profile_id: null }],
  writeMode: "upsert",
  customerId: null,
  targetConnectionId: null,
  sourceDirectory: "",
  debugMode: false,
  insightSteps: [],
  expandSerials: false,
  importWindowStart: "",
  importWindowEnd:   "",
  lookbackDays:      null,
};

// ─── Component ───────────────────────────────────────────────

export default function SchedulerClient({
  profile,
  initialTasks,
  userId,
  isReadOnly = false,
  isAdmin = false,
  isAuditor = false,
  customers = [],
  activeCustomerId = null,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const canControlPoll = isAdmin;

  const [tasks, setTasks] = useState<ScheduledTask[]>(initialTasks);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editTask, setEditTask] = useState<ScheduledTask | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  // Plumbing modal is URL-driven (?plumbing=<taskId>) so the browser Back button
  // restores it after the user navigates into the connection editor.
  const plumbingTaskId = searchParams.get("plumbing");
  const plumbingTask = useMemo(
    () => (plumbingTaskId ? tasks.find((t) => t.id === plumbingTaskId) ?? null : null),
    [plumbingTaskId, tasks],
  );
  const openPlumbing = useCallback(
    (taskId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("plumbing", taskId);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );
  const closePlumbing = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("plumbing");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname, searchParams]);
  // Import-window mode toggle. "current" = today-relative lookback; "custom" = absolute date range.
  const [windowMode, setWindowMode] = useState<"current" | "custom">("current");


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
  const [expandedLogEntries, setExpandedLogEntries] = useState<Record<string, boolean>>({});
  const [taskLogs, setTaskLogs] = useState<Record<string, TaskLog[]>>({});
  const [logsLoading, setLogsLoading] = useState<Record<string, boolean>>({});
  const [logCounts, setLogCounts] = useState<Record<string, number>>({});
  const [fullscreenTaskId, setFullscreenTaskId] = useState<string | null>(null);
  const [fsLogSearch, setFsLogSearch] = useState("");
  // Summary popover: last SUMMARY log shown when user clicks the status badge.
  // Uses fixed positioning (via getBoundingClientRect) so no ancestor clip can hide it.
  const [summaryPopoverId, setSummaryPopoverId] = useState<string | null>(null);
  const [summaryPopoverPos, setSummaryPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [lastSummaries, setLastSummaries] = useState<Record<string, { details: string; created_at: string } | null>>({});
  // Refs so the realtime log subscription sees current state without stale closures
  const expandedLogsRef = useRef<Record<string, boolean>>({});
  const fullscreenTaskIdRef = useRef<string | null>(null);

  const [resetingTasks, setResetingTasks] = useState<Set<string>>(new Set());
  // Phase 1: server-side runner state. Latest live (non-terminal) task_runs row per task.
  const [serverRuns, setServerRuns] = useState<Record<string, TaskRun>>({});
  // Phase 2: feedback string from the last manual /api/scheduler/tick call.
  const [lastTickResult, setLastTickResult] = useState<string | null>(null);
  // Debug mode expand/collapse per task, and tracked RecID counts from DB
  const [expandedDebug, setExpandedDebug] = useState<Set<string>>(new Set());
  const [trackedCounts, setTrackedCounts] = useState<Map<string, number>>(new Map());
  const [mappingProfiles, setMappingProfiles] = useState<MappingProfile[]>([]);
  const [endpointConnections, setEndpointConnections] = useState<EndpointConnection[]>([]);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSystem, setShowSystem] = useState(false);

  // Pipeline slide-over panel — shows mapping/connection details in-context
  const [pipelinePanel, setPipelinePanel] = useState<{
    type: "mapping" | "connection";
    id: string;
    taskId: string;
  } | null>(null);

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
  const dragSlotIdxRef = useRef<number | null>(null);
  const dragEditSlotIdxRef = useRef<number | null>(null);

  // ── Fetch tasks ──────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    let q = supabase.from("scheduled_tasks").select("*").order("created_at", { ascending: false });
    if (activeCustomerId) q = q.or(`customer_id.eq.${activeCustomerId},is_system.eq.true,created_by.eq.${userId}`);
    const { data } = await q;
    if (data) {
      setTasks(data);
    }

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

    // Fetch tracked RecID counts per task (for debug mode Undo button)
    const { data: recRows } = await supabase
      .from("task_created_records")
      .select("task_id");
    if (recRows) {
      const recTally = new Map<string, number>();
      for (const row of recRows) {
        recTally.set(row.task_id, (recTally.get(row.task_id) ?? 0) + 1);
      }
      setTrackedCounts(recTally);
    }
  }, [supabase, activeCustomerId, userId]);

  // ── System template promote / demote / clone ──────────────
  async function handlePromote(id: string) {
    if (!confirm("Make this a system template? It will be visible to all users and locked for non-admins.")) return;
    setPromoting(id);
    const { error } = await supabase.from("scheduled_tasks").update({ is_system: true, customer_id: null }).eq("id", id);
    if (error) { alert("Promote failed: " + error.message); setPromoting(null); return; }
    setTasks((p) => p.map((t) => t.id === id ? { ...t, is_system: true, customer_id: null } : t));
    setPromoting(null);
  }

  async function handleDemote(id: string) {
    if (!confirm("Remove this from system templates? It will become a regular task.")) return;
    setPromoting(id);
    const { error } = await supabase.from("scheduled_tasks").update({ is_system: false }).eq("id", id);
    if (error) { alert("Demote failed: " + error.message); setPromoting(null); return; }
    setTasks((p) => p.map((t) => t.id === id ? { ...t, is_system: false } : t));
    setPromoting(null);
  }

  async function handleUseAsTemplate(task: ScheduledTask) {
    const newName = prompt("Name for your new task:", task.task_name);
    if (!newName?.trim()) return;
    const newSlots = (task.mapping_slots ?? []).map((s) => ({ ...s, id: crypto.randomUUID() }));
    const { data, error } = await supabase
      .from("scheduled_tasks")
      .insert({
        task_name: newName.trim(),
        start_date_time: task.start_date_time,
        end_date_time: task.end_date_time ?? null,
        recurrence: task.recurrence,
        status: "waiting",
        mapping_profile_id: task.mapping_profile_id,
        mapping_slots: newSlots.length ? newSlots : null,
        source_connection_id: task.source_connection_id,
        target_connection_id: task.target_connection_id,
        source_file_path: task.source_file_path ?? null,
        write_mode: task.write_mode ?? "upsert",
        is_system: false,
        customer_id: activeCustomerId ?? null,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) { alert("Clone failed: " + error.message); return; }
    setTasks((p) => [data as ScheduledTask, ...p]);
  }

  // Phase 5b: legacy executeTask, runDueTasks, fetchWithRetry, and cancelTask
  // removed. Server-side runner (taskRunner.ts + /api/scheduler/*) is the only
  // execution path now.

  // Phase 1: refetch the latest live (non-terminal) run for one or all tasks.
  // Used as an optimistic-update fallback so the UI reflects state immediately
  // without waiting on the realtime channel (which can drop events / be disabled).
  const refreshServerRuns = useCallback(async (taskId?: string) => {
    let q = supabase.from("task_runs").select("*").in("status", ["pending", "running", "cancelling"]);
    if (taskId) q = q.eq("task_id", taskId);
    const { data } = await q;
    if (!data) return;
    setServerRuns((prev) => {
      const next = { ...prev };
      if (taskId) {
        // Per-task refresh: clear and repopulate just this task.
        delete next[taskId];
      } else {
        // Full refresh: rebuild from scratch so terminal rows fall out.
        for (const k of Object.keys(next)) delete next[k];
      }
      for (const row of data as TaskRun[]) {
        const existing = next[row.task_id];
        if (!existing || row.created_at > existing.created_at) next[row.task_id] = row;
      }
      return next;
    });
  }, [supabase]);

  // Phase 1: trigger a server-side run via /api/scheduler/start.
  const startServerRun = useCallback(async (task: ScheduledTask) => {
    try {
      const res = await fetch("/api/scheduler/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: task.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        alert(`Server run failed: ${body.error ?? res.statusText}`);
        return;
      }
      await refreshServerRuns(task.id);
    } catch (err) {
      alert(`Server run error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshServerRuns]);

  // Phase 1: cancel a live server-side run for this task.
  const cancelServerRun = useCallback(async (taskId: string) => {
    try {
      const res = await fetch("/api/scheduler/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        alert(`Cancel failed: ${body.error ?? res.statusText}`);
      }
      await refreshServerRuns(taskId);
    } catch (err) {
      alert(`Cancel error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshServerRuns]);

  // Phase 2: manually fire a tick for dev testing (Vercel cron only fires in deployed envs).
  const triggerManualTick = useCallback(async () => {
    setLastTickResult("Ticking...");
    try {
      const res = await fetch("/api/scheduler/tick", { method: "GET" });
      const body = (await res.json().catch(() => ({}))) as { status?: string; run_id?: string; processed?: number; total?: number; error?: string };
      if (!res.ok) {
        setLastTickResult(`Error: ${body.error ?? res.statusText}`);
        return;
      }
      const idPart = body.run_id ? ` (${body.run_id.slice(0, 8)})` : "";
      const progress = (typeof body.processed === "number" && typeof body.total === "number") ? ` ${body.processed}/${body.total}` : "";
      setLastTickResult(`${body.status ?? "ok"}${idPart}${progress}`);
      // Phase 2: refresh the live-runs map after a tick so terminal transitions
      // (cancelling -> cancelled, etc.) are reflected without relying on realtime.
      await refreshServerRuns();
    } catch (err) {
      setLastTickResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshServerRuns]);

  // ── Execute a single task ─────────────────────────────────

  // ── Auto-run due tasks ────────────────────────────────────

  // ── Polling loop ──────────────────────────────────────────
  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    console.log(`[Poller] Poll interval set to ${pollInterval}s`);
    pollTimerRef.current = setInterval(async () => {
      await fetchTasks();
      // Phase 5a: legacy runDueTasks() removed -- server-side cron handles
      // recurring task auto-creation now. Polling keeps task + run state fresh.
      await refreshServerRuns();
    }, pollInterval * 1000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [pollInterval, fetchTasks, refreshServerRuns]);

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

  // Phase 1: subscribe to task_runs so the UI shows live server-side run state.
  // Fetches initial non-terminal runs, then listens for realtime INSERT/UPDATE events.
  // Runs that reach a terminal state are removed from the live map so the Run button reverts.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("task_runs")
        .select("*")
        .in("status", ["pending", "running", "cancelling"]);
      if (!active || !data) return;
      const map: Record<string, TaskRun> = {};
      for (const row of data as TaskRun[]) {
        const existing = map[row.task_id];
        if (!existing || row.created_at > existing.created_at) map[row.task_id] = row;
      }
      setServerRuns(map);
    })();

    const channel = supabase
      .channel("scheduler-task-runs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_runs" },
        (payload) => {
          const row = (payload.new ?? payload.old) as TaskRun | undefined;
          if (!row) return;
          const isLive = row.status === "pending" || row.status === "running" || row.status === "cancelling";
          setServerRuns((prev) => {
            const next = { ...prev };
            if (isLive) {
              const existing = next[row.task_id];
              if (!existing || row.id === existing.id || row.created_at >= existing.created_at) {
                next[row.task_id] = row;
              }
            } else if (next[row.task_id]?.id === row.id) {
              delete next[row.task_id];
            }
            return next;
          });
        }
      )
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [supabase]);

  // ── Return from "Create new mapping" flow ─────────────────
    // -- Handle ?rerun=<run_exception_id> URL param --
  useEffect(() => {
    const rerunId = searchParams.get("rerun");
    if (!rerunId || tasks.length === 0) return;

    (async () => {
      try {
        const listRes = await fetch("/api/sku-run-exceptions");
        if (!listRes.ok) return;
        const { data: runs } = await listRes.json() as { data: SkuRunException[] };
        const run = runs?.find((r: SkuRunException) => r.id === rerunId);
        if (!run) { console.warn("[rerun] run exception not found:", rerunId); return; }

        const task = tasks.find((t) => t.id === run.task_id);
        if (!task) { console.warn("[rerun] task not found:", run.task_id); return; }

        const rowFilter: number[] = (run.exceptions as { row: number }[]).map((e) => e.row);

        // Clean the URL before running
        const url = new URL(window.location.href);
        url.searchParams.delete("rerun");
        window.history.replaceState({}, "", url.toString());

        // Route through the server-side runner (Phase 3c-1c) so the rerun
        // survives logout / browser close like a normal Server Run.
        try {
          const startRes = await fetch("/api/scheduler/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: task.id, row_filter: rowFilter }),
          });
          if (!startRes.ok) {
            const body = await startRes.json().catch(() => ({})) as { error?: string };
            alert(`Rerun failed: ${body.error ?? startRes.statusText}`);
            return;
          }
          await refreshServerRuns(task.id);
        } catch (err) {
          alert(`Rerun error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } catch (e) {
        console.warn("[rerun] failed:", e);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

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
        target_connection_id: form.targetConnectionId ?? null,
        source_file_path: form.sourceDirectory.trim() || null,
        status: "waiting",
        write_mode: form.writeMode ?? "upsert",
        created_by: userId,
        customer_id: form.customerId ?? null,
      });

      if (error) throw error;
      setForm(EMPTY_FORM);
      setShowCreateForm(false);
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

  async function deleteTask(id: string) {
    if (!window.confirm("Delete this task and all its logs?")) return;
    await supabase.from("task_logs").delete().eq("task_id", id);
    const { error } = await supabase.from("scheduled_tasks").delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    setTasks((p) => p.filter((t) => t.id !== id));
  }

  // ── Reset: delete all Ivanti records in reverse slot order ───────────────
  const resetTask = useCallback(async (task: ScheduledTask) => {
    if (!window.confirm(`This will DELETE all Ivanti records created by "${task.task_name}" in reverse slot order. Continue?`)) return;
    if (executingRef.current.has(task.id)) { alert("Task is currently running. Cancel it first."); return; }
    executingRef.current.add(task.id);
    setResetingTasks((p) => new Set(p).add(task.id));
    const startTime = Date.now();

    try {
      await supabase.from("task_logs").delete().eq("task_id", task.id);
      await supabase.from("task_logs").insert({
        task_id: task.id, action: "STARTED",
        details: `Reset of "${task.task_name}" started at ${new Date().toISOString()}`,
      });

      let deletedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      // ── Fast path: delete by stored RecIDs (set during the last run) ─────────
      // This is reliable because it uses the exact RecID returned by Ivanti at
      // create/update time — no BO name probe, no upsert key lookup, no cache.
      const { data: storedRecords } = await supabase
        .from("task_created_records")
        .select("*")
        .eq("task_id", task.id)
        .order("slot_idx", { ascending: false })
        .order("created_at", { ascending: false });

      if (storedRecords && storedRecords.length > 0) {
        await supabase.from("task_logs").insert({
          task_id: task.id, action: "INFO",
          details: `Deleting ${storedRecords.length} tracked record(s) by RecID (fast path)`,
        });

        for (const record of storedRecords) {
          const { bo_name, rec_id, ivanti_url, api_key, tenant_id, key_desc } = record as {
            id: string; bo_name: string; rec_id: string; ivanti_url: string;
            api_key: string; tenant_id: string | null; key_desc: string | null;
          };

          try {
            const proxyRes = await fetch("/api/ivanti-proxy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ivantiUrl:    ivanti_url,
                apiKey:       api_key,
                tenantId:     tenant_id ?? undefined,
                data:         {},
                method:       "DELETE",
                directRecId:  rec_id,
                directBoName: bo_name,
              }),
            });
            const json = await proxyRes.json();
            if (json.deleted) {
              deletedCount++;
              await supabase.from("task_logs").insert({
                task_id: task.id, action: "INFO",
                details: `Deleted: ${key_desc ?? rec_id}`,
              });
              await supabase.from("task_created_records").delete().eq("id", record.id);
            } else if (json.skipped) {
              skippedCount++;
              await supabase.from("task_created_records").delete().eq("id", record.id);
            } else {
              errorCount++;
              await supabase.from("task_logs").insert({
                task_id: task.id, action: "WARN",
                details: `Delete error [${key_desc ?? rec_id}]: ${JSON.stringify(json).slice(0, 300)}`,
              });
            }
          } catch (e) {
            errorCount++;
            await supabase.from("task_logs").insert({
              task_id: task.id, action: "WARN",
              details: `Delete failed [${key_desc ?? rec_id}]: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }

      } else {
        // ── Fallback: upsert-key lookup approach (for tasks run before RecID tracking) ──
        await supabase.from("task_logs").insert({
          task_id: task.id, action: "INFO",
          details: `No tracked RecIDs found — falling back to upsert-key lookup`,
        });

        const rawSlots = (task.mapping_slots ?? []) as MappingSlot[];
        const slots: MappingSlot[] = rawSlots.length > 0
          ? rawSlots
          : [{ id: "default-reset", mapping_profile_id: task.mapping_profile_id ?? null }];
        const reversedSlots = [...slots].reverse();

        for (let slotIdx = 0; slotIdx < reversedSlots.length; slotIdx++) {
          const slot = reversedSlots[slotIdx];
          if (!slot.mapping_profile_id) continue;

          const { data: mpData } = await supabase
            .from("mapping_profiles").select("*").eq("id", slot.mapping_profile_id).single();
          if (!mpData) continue;
          const mappingProfile = mpData as MappingProfile;
          const slotLabel = slot.label ?? mappingProfile.name;

          await supabase.from("task_logs").insert({
            task_id: task.id, action: "INFO",
            details: `── Reset ${slotIdx + 1}/${reversedSlots.length}: ${slotLabel} ──`,
          });

          const srcConnId = mappingProfile.source_connection_id;
          if (!srcConnId) continue;
          const { data: srcConnData } = await supabase.from("endpoint_connections").select("*").eq("id", srcConnId).single();
          if (!srcConnData) continue;
          const srcConn = srcConnData as EndpointConnection;
          if (srcConn.type !== "file") continue;
          const srcConfig = srcConn.config as { file_path?: string; file_name?: string };

          const taskDir = task.source_file_path?.trim().replace(/\/$/, "") ?? null;
          const connFileName = srcConfig.file_name ?? null;
          const connFilePath = srcConfig.file_path ?? null;
          const resolvedSourceFilePath = connFilePath || (taskDir && connFileName ? `${taskDir}/${connFileName}` : null);
          if (!resolvedSourceFilePath) continue;

          const { data: fileData, error: dlError } = await supabase.storage.from("task_files").download(resolvedSourceFilePath);
          if (dlError || !fileData) {
            await supabase.from("task_logs").insert({ task_id: task.id, action: "WARN", details: `File not found: ${resolvedSourceFilePath} — skipping slot` });
            continue;
          }
          const wb = XLSX.read(await fileData.arrayBuffer(), { type: "array" });
          const sheetName = wb.SheetNames[0];
          const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
          if (rows.length === 0) continue;

          const tgtConnId = task.target_connection_id ?? mappingProfile.target_connection_id;
          if (!tgtConnId) continue;
          const { data: tgtConnData } = await supabase.from("endpoint_connections").select("*").eq("id", tgtConnId).single();
          if (!tgtConnData) continue;
          const tgtConn = tgtConnData as EndpointConnection;
          if (tgtConn.type !== "ivanti") {
            await supabase.from("task_logs").insert({ task_id: task.id, action: "INFO", details: `Target is ${tgtConn.type} — skipping DELETE for this slot` });
            continue;
          }
          const ivCfg = tgtConn.config as import("@/lib/types").IvantiConfig;
          const targetBO = mappingProfile.target_business_object ?? ivCfg.business_object;

          const keyTargetFieldNames = mappingProfile.mappings
            .filter((m) => m.isKey)
            .map((m) => mappingProfile.target_fields.find((f) => f.id === m.targetFieldId)?.name)
            .filter((n): n is string => !!n);
          if (keyTargetFieldNames.length === 0) keyTargetFieldNames.push("Name");

          for (const row of rows) {
            const mapped = applyMappingProfile(row, mappingProfile);
            const proxyBody: Record<string, unknown> = {
              ivantiUrl: ivCfg.url,
              data: mapped,
              apiKey: ivCfg.api_key,
              businessObject: targetBO,
              upsertKeys: keyTargetFieldNames,
              method: "DELETE",
            };
            if (ivCfg.tenant_id) proxyBody.tenantId = ivCfg.tenant_id;

            try {
              const res = await fetch("/api/ivanti-proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proxyBody) });
              const json = await res.json();
              if (json.deleted) {
                deletedCount++;
                await supabase.from("task_logs").insert({ task_id: task.id, action: "INFO", details: `Deleted: ${json.keyDesc}` });
              } else if (json.skipped) {
                skippedCount++;
              } else {
                errorCount++;
                await supabase.from("task_logs").insert({ task_id: task.id, action: "WARN", details: `Delete error: ${JSON.stringify(json).slice(0, 400)}` });
              }
            } catch (e) {
              errorCount++;
              await supabase.from("task_logs").insert({ task_id: task.id, action: "WARN", details: `Delete request failed: ${e instanceof Error ? e.message : String(e)}` });
            }
          }
        }
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      await supabase.from("task_logs").insert({
        task_id: task.id, action: "SUMMARY",
        details: `Reset complete | Duration: ${duration}s | Deleted: ${deletedCount} | Not found: ${skippedCount} | Errors: ${errorCount}`,
      });
    } finally {
      executingRef.current.delete(task.id);
      setResetingTasks((p) => { const n = new Set(p); n.delete(task.id); return n; });
      await fetchTasks();
    }
  }, [supabase, fetchTasks]);

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
    setWindowMode(task.import_window_start || task.import_window_end ? "custom" : "current");
    setEditForm({
      taskName: task.task_name,
      startDateTime: "",
      recurrence: task.recurrence,
      mappingProfileId: task.mapping_profile_id ?? null,
      mappingSlots: ((task.mapping_slots ?? []) as MappingSlot[]).length > 0
        ? (task.mapping_slots as MappingSlot[])
        : [{ id: "slot-edit-0", mapping_profile_id: task.mapping_profile_id ?? null }],
      writeMode: (task.write_mode ?? "upsert") as "upsert" | "create_only" | "update_only",
      customerId: task.customer_id ?? null,
      targetConnectionId: task.target_connection_id ?? null,
      sourceDirectory: task.source_file_path ?? "",
      debugMode: task.debug_mode ?? false,
      insightSteps: (task.insight_steps as InsightStep[] | null) ?? [],
      expandSerials: task.expand_serials ?? false,
      importWindowStart: task.import_window_start ?? "",
      importWindowEnd:   task.import_window_end   ?? "",
      lookbackDays:      task.lookback_days ?? null,
    });
  }

  // ── Save edit ─────────────────────────────────────────────
  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editTask) return;
    if (
      editForm.importWindowStart &&
      editForm.importWindowEnd &&
      editForm.importWindowStart > editForm.importWindowEnd
    ) {
      alert("Import window: 'From' date must be on or before the 'To' date.");
      return;
    }
    setEditSubmitting(true);

    try {
      // If start date/time was cleared, push it far into the future so the task
      // stays in "waiting" without auto-triggering on the next poll.
      const startUtc = editForm.startDateTime
        ? new Date(editForm.startDateTime).toISOString()
        : new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

      const { data: updated, error } = await supabase
        .from("scheduled_tasks")
        .update({
          task_name: editForm.taskName,
          start_date_time: startUtc,
          recurrence: editForm.recurrence,
          mapping_profile_id: editForm.mappingSlots[0]?.mapping_profile_id ?? editForm.mappingProfileId ?? null,
          mapping_slots: editForm.mappingSlots.length > 1 ? editForm.mappingSlots : [],
          source_connection_id: null,
          target_connection_id: editForm.targetConnectionId ?? null,
          source_file_path: editForm.sourceDirectory.trim() || null,
          status: "waiting",
          write_mode: editForm.writeMode ?? "upsert",
          customer_id: editForm.customerId ?? null,
          debug_mode: editForm.debugMode ?? false,
          insight_steps: editForm.insightSteps.length > 0 ? editForm.insightSteps : null,
          expand_serials: editForm.expandSerials || null,
          import_window_start: editForm.importWindowStart.trim() || null,
          import_window_end:   editForm.importWindowEnd.trim()   || null,
          lookback_days:       editForm.lookbackDays && editForm.lookbackDays > 0 ? editForm.lookbackDays : null,
        })
        .eq("id", editTask.id)
        .select("id");

      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error(
          "Save was blocked — you don't have permission to edit this task.\n\n" +
          "System templates can only be edited by their owner or an admin. " +
          "Use \u201cUse as Template\u201d to create your own editable copy."
        );
      }

      await supabase.from("task_logs").insert({
        task_id: editTask.id,
        action: "EDITED",
        details: `Task edited at ${new Date().toISOString()}`,
      });

      setEditTask(null);
      await fetchTasks();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err && typeof err === "object" && "message" in err) ? String((err as {message:unknown}).message) : JSON.stringify(err);
      alert("Failed to save task: " + msg);
    } finally {
      setEditSubmitting(false);
    }
  }

  // ─── Derived state ────────────────────────────────────────
  const visibleTasks = showSystem ? tasks : tasks.filter((t) => !t.is_system);

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(99,102,241,0.06)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">Task Scheduler</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
          {/* Polling control — visible to administrator and schedule_administrator roles */}
          {canControlPoll && (
          <div
            className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-2xl px-4 py-2 opacity-60"
            title="Deprecated. The dial used to control how often the legacy poller auto-fired due tasks. Recurring tasks now run via Vercel cron (every minute), so this dial only changes the UI refresh tempo. Will be removed in a future cleanup."
          >
            {/* Animated icon */}
            <RefreshCw
              className="w-3.5 h-3.5 text-indigo-400 shrink-0"
              style={{ animation: `spin ${pollInterval}s linear infinite` }}
            />
            <span className="text-xs text-gray-400 shrink-0 line-through decoration-gray-600">Poll every</span>

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
            {customers.length > 0 && (
              <CustomerSwitcher customers={customers} activeCustomerId={activeCustomerId} />
            )}
            {!isReadOnly && (
              <button
                onClick={() => setShowSystem((s) => !s)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                  showSystem
                    ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-400"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300"
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                Show Templates
              </button>
            )}
            {isAdmin && (
              <button
                onClick={triggerManualTick}
                className="flex items-center gap-2 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                title="Phase 2 dev tool — manually fire /api/scheduler/tick once"
              >
                <Server className="w-3.5 h-3.5" />
                Tick
                {lastTickResult && (
                  <span className="text-[10px] font-mono text-violet-400/80 ml-1">{lastTickResult}</span>
                )}
              </button>
            )}
            {!isReadOnly && (
              <button
                onClick={() => { setForm(EMPTY_FORM); setFormError(null); setShowCreateForm(true); }}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-600/20"
              >
                <Plus className="w-4 h-4" />
                New Task
              </button>
            )}

          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        {/* ── Create Task Modal ── */}
        {!isReadOnly && showCreateForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowCreateForm(false)} />
            <div className="relative bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-5xl shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-indigo-400" />
                  New Task
                </h3>
                <button onClick={() => setShowCreateForm(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
          <div className="p-6">
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
                    <div className="flex items-center mb-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 flex-1">
                        <GitMerge className="w-3 h-3 text-purple-400" />
                        Mapping Profiles
                        {form.mappingSlots.length > 1 && (
                          <span className="ml-1 text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                            {form.mappingSlots.length} slots
                          </span>
                        )}
                      </label>
                      {form.mappingSlots.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const allEnabled = form.mappingSlots.every((s) => s.enabled !== false);
                            setForm((p) => ({
                              ...p,
                              mappingSlots: p.mappingSlots.map((s) => ({ ...s, enabled: !allEnabled })),
                            }));
                          }}
                          className="text-[11px] text-gray-500 hover:text-purple-400 transition-colors"
                        >
                          {form.mappingSlots.every((s) => s.enabled !== false) ? "Disable All" : "Enable All"}
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {form.mappingSlots.map((slot, slotIdx) => (
                        <div
                            key={slot.id}
                            draggable={form.mappingSlots.length > 1}
                            onDragStart={() => { dragSlotIdxRef.current = slotIdx; }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              const from = dragSlotIdxRef.current;
                              if (from === null || from === slotIdx) return;
                              setForm((p) => {
                                const slots = [...p.mappingSlots];
                                const [moved] = slots.splice(from, 1);
                                slots.splice(slotIdx, 0, moved);
                                return { ...p, mappingSlots: slots };
                              });
                              dragSlotIdxRef.current = null;
                            }}
                            className={`flex gap-2 items-start transition-opacity ${slot.enabled === false ? "opacity-40" : ""}${form.mappingSlots.length > 1 ? " cursor-grab active:cursor-grabbing" : ""}`}
                          >
                          {/* Enable/disable toggle + slot number */}
                          {form.mappingSlots.length > 1 && (
                            <div className="flex flex-col items-center gap-0.5 shrink-0 pt-2.5">
                              <GripVertical className="w-3 h-3 text-gray-600 hover:text-gray-400 mb-0.5" />
                              <button
                                type="button"
                                onClick={() => setForm((p) => ({
                                  ...p,
                                  mappingSlots: p.mappingSlots.map((s, i) =>
                                    i === slotIdx ? { ...s, enabled: s.enabled === false ? true : false } : s
                                  ),
                                }))}
                                title={slot.enabled === false ? "Enable slot" : "Disable slot"}
                                className={`w-4 h-4 rounded-full border-2 transition-all flex items-center justify-center ${
                                  slot.enabled === false
                                    ? "border-gray-600 bg-transparent"
                                    : "border-emerald-500 bg-emerald-500/30"
                                }`}
                              >
                                {slot.enabled !== false && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 block" />}
                              </button>
                              <span className="text-[11px] text-indigo-400 font-bold font-mono leading-none">{slotIdx + 1}</span>
                            </div>
                          )}
                          {/* Select + optional label stacked */}
                          <div className="flex-1 min-w-0 flex flex-col gap-1">
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
                              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
                                placeholder="Slot label (optional)"
                                className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                              />
                            )}
                          </div>
                          {/* Action button — always show delete when >1 slot, otherwise show manage icon */}
                          {form.mappingSlots.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => setForm((p) => ({
                                ...p,
                                mappingSlots: p.mappingSlots.filter((_, i) => i !== slotIdx),
                              }))}
                              className="p-2.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded-xl transition-colors shrink-0 mt-0.5"
                              title="Remove slot"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => router.push("/mappings")}
                              className="p-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-purple-400 rounded-xl transition-all shrink-0 mt-0.5"
                              title="Manage mapping profiles"
                            >
                              <GitMerge className="w-4 h-4" />
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
                        writeMode: e.target.value as "upsert" | "create_only" | "update_only",
                      }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="upsert">Upsert — create or update</option>
                    <option value="create_only">Create only — skip if exists</option>
                    <option value="update_only">Update only — skip if not exists</option>
                  </select>
                </div>

                {/* Debug Mode — admin only */}
                {isAdmin && (
                  <div className="flex items-center justify-between p-3 bg-gray-800/60 border border-gray-700 rounded-xl">
                    <div>
                      <div className="text-sm font-medium text-gray-200">Debug Mode</div>
                      <div className="text-xs text-gray-500 mt-0.5">Tracks RecIDs on each run, enabling the Undo button to delete by RecID directly.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, debugMode: !p.debugMode }))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.debugMode ? "bg-orange-500" : "bg-gray-600"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.debugMode ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                )}

                {/* Source Directory */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <BookOpen className="w-3 h-3 text-orange-400" />
                    Source Directory
                    <span className="text-gray-600 normal-case font-normal ml-1">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.sourceDirectory}
                    onChange={(e) => setForm((p) => ({ ...p, sourceDirectory: e.target.value }))}
                    placeholder="e.g. mikeco"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                  {form.sourceDirectory.trim() && (
                    <p className="text-xs text-orange-400 mt-1.5 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Slots with no file configured will look in &quot;{form.sourceDirectory.trim()}/&quot;
                    </p>
                  )}
                </div>

                {/* Target Connection Override */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Plug className="w-3 h-3 text-cyan-400" />
                    Target Connection Override
                    <span className="text-gray-600 normal-case font-normal ml-1">(optional)</span>
                  </label>
                  <select
                    value={form.targetConnectionId ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, targetConnectionId: e.target.value || null }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  >
                    <option value="">— Use connection from each mapping profile —</option>
                    {endpointConnections
                      .filter((c) => c.type !== "file")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} [{c.type.toUpperCase()}]
                        </option>
                      ))}
                  </select>
                  {form.targetConnectionId && (
                    <p className="text-xs text-cyan-400 mt-1.5 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      All slots will use this connection when their mapping profile has no target set
                    </p>
                  )}
                </div>

                {/* Customer — admin only */}
                {isAdmin && customers.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Customer
                    </label>
                    <select
                      value={form.customerId ?? ""}
                      onChange={(e) => setForm((p) => ({ ...p, customerId: e.target.value || null }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="">— No customer (shared) —</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.company ? ` — ${c.company}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

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
        </div>
          </div>
        )}

        {/* ── Task List ── */}
        <section>
          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            Tasks{" "}
            <span className="text-sm font-normal text-gray-500 ml-1">
              ({visibleTasks.length})
            </span>
          </h2>

          {visibleTasks.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-12 text-center">
              <Clock className="w-12 h-12 text-gray-700 mx-auto mb-4" />
              <p className="text-gray-500">
                {tasks.length === 0
                  ? "No tasks yet. Use the New Task button to get started."
                  : "No regular tasks. Toggle Show Templates to view system templates."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleTasks.map((task) => {
                const badge =
                  STATUS_BADGE[task.status] ?? STATUS_BADGE.waiting;
                const icon = STATUS_ICON[task.status];
                const _sr = serverRuns[task.id];
                const isRunning = !!(_sr && (_sr.status === "pending" || _sr.status === "running" || _sr.status === "cancelling"));
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white font-medium truncate">
                            {task.task_name}
                          </p>
                          {task.is_system && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-[10px] font-medium shrink-0">
                              <Lock className="w-2.5 h-2.5" />
                              System
                            </span>
                          )}
                          {task.customer_id && (() => {
                            const cust = customers.find((c) => c.id === task.customer_id);
                            return cust ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-medium shrink-0">
                                <Building2 className="w-2.5 h-2.5" />
                                {cust.company || cust.name}
                              </span>
                            ) : null;
                          })()}
                          {(() => {
                            const steps = (task.insight_steps as InsightStep[] | null)?.filter(s => s.enabled !== false) ?? [];
                            if (steps.length === 0) return null;
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium shrink-0 cursor-default"
                                title={`Insight pipeline: ${steps.map(s => s.record_type.replace(/_/g, ' ')).join(' → ')}`}
                              >
                                <Zap className="w-2.5 h-2.5" />
                                {steps.length} steps
                              </span>
                            );
                          })()}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>{task.recurrence.charAt(0).toUpperCase() + task.recurrence.slice(1)}</span>
                          <span>&bull;</span>
                          <span>{formatLocalDateTime(task.start_date_time)}</span>
                        </p>

                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <button
                          onClick={() => openPlumbing(task.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-all"
                          title="View plumbing"
                        >
                          <Workflow className="w-3 h-3 text-amber-400" />
                          Plumbing
                        </button>

                        {task.is_system ? (
                          <>
                            {/* Use as Template — available to all non-read-only users */}
                            {!isReadOnly && (
                              <button
                                onClick={() => handleUseAsTemplate(task)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 text-cyan-400 rounded-lg text-xs font-medium transition-all"
                              >
                                <Copy className="w-3 h-3" />
                                Use as Template
                              </button>
                            )}
                            {/* Admin-only: demote only (edit requires demoting first) */}
                            {isAdmin && (
                              <button
                                onClick={() => handleDemote(task.id)}
                                disabled={promoting === task.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-300 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                                title="Demote to regular task before editing"
                              >
                                <ShieldOff className="w-3 h-3" />
                                Demote to Edit
                              </button>
                            )}
                          </>
                        ) : (
                          !isReadOnly && (
                            <>
                              <button
                                onClick={() => openEdit(task)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-all"
                              >
                                <Edit2 className="w-3 h-3" />
                                Edit
                              </button>

                              {isAdmin && (() => {
                                const sr = serverRuns[task.id];
                                const liveStatus =
                                  sr && (sr.status === "pending" || sr.status === "running" || sr.status === "cancelling")
                                    ? sr.status
                                    : null;
                                return (
                                  <button
                                    onClick={() => startServerRun(task)}
                                    disabled={!!liveStatus}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/40 text-violet-300 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                                    title={liveStatus ? `Server run: ${liveStatus}` : "Run server-side. Survives logout, browser close, and crashes."}
                                  >
                                    {liveStatus ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                    {liveStatus === "pending" ? "Pending…"
                                      : liveStatus === "running" ? "Running…"
                                      : liveStatus === "cancelling" ? "Cancelling…"
                                      : "Run"}
                                  </button>
                                );
                              })()}

                              {task.debug_mode && isAdmin && (
                                <>
                                  <button
                                    onClick={() => setExpandedDebug((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(task.id)) next.delete(task.id);
                                      else next.add(task.id);
                                      return next;
                                    })}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-all ${
                                      expandedDebug.has(task.id)
                                        ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
                                        : "bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/25 text-orange-400"
                                    }`}
                                    title="Debug mode — click to show Undo"
                                  >
                                    <Bug className="w-3 h-3" />
                                    Debug
                                  </button>
                                  {expandedDebug.has(task.id) && (
                                    <button
                                      onClick={() => resetTask(task)}
                                      disabled={isRunning || resetingTasks.has(task.id) || (trackedCounts.get(task.id) ?? 0) === 0}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                                      title={(trackedCounts.get(task.id) ?? 0) === 0 ? "No records to undo — run the task first in debug mode" : "Undo: delete all Ivanti records created by this run"}
                                    >
                                      {resetingTasks.has(task.id) ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="w-3 h-3" />
                                      )}
                                      {resetingTasks.has(task.id) ? "Undoing…" : `Undo (${trackedCounts.get(task.id) ?? 0})`}
                                    </button>
                                  )}
                                </>
                              )}

                              {(() => {
                                const sr = serverRuns[task.id];
                                const liveStatus =
                                  sr && (sr.status === "pending" || sr.status === "running" || sr.status === "cancelling")
                                    ? sr.status
                                    : null;
                                const isCancelling = liveStatus === "cancelling";
                                const canCancel = liveStatus === "pending" || liveStatus === "running";
                                return (
                                  <button
                                    onClick={() => cancelServerRun(task.id)}
                                    disabled={!canCancel && !isCancelling}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-all disabled:opacity-40 ${
                                      isCancelling
                                        ? "bg-orange-500/20 border-orange-500/40 text-orange-300 cursor-not-allowed"
                                        : "bg-red-500/10 hover:bg-red-500/20 border-red-500/25 text-red-400"
                                    }`}
                                    title={
                                      isCancelling ? "Cancelling — finishing current row…"
                                      : !canCancel ? "No active run to cancel"
                                      : "Cancel running task"
                                    }
                                  >
                                    {isCancelling
                                      ? <Loader2 className="w-3 h-3 animate-spin" />
                                      : <X className="w-3 h-3" />}
                                    {isCancelling ? "Cancelling…" : "Cancel"}
                                  </button>
                                );
                              })()}

                              {isAdmin && (
                                <button
                                  onClick={() => handlePromote(task.id)}
                                  disabled={promoting === task.id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-cyan-500/10 border border-gray-700 hover:border-cyan-500/25 text-gray-400 hover:text-cyan-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                                  title="Make System Template"
                                >
                                  <Shield className="w-3 h-3" />
                                  Make System
                                </button>
                              )}
                            </>
                          )
                        )}

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

                        {!isReadOnly && !task.is_system && (
                          <button
                            onClick={() => deleteTask(task.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 rounded-lg text-xs font-medium transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        )}
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

                        <div className="px-5 py-4 max-h-[calc(100vh-380px)] overflow-y-auto font-mono text-xs space-y-1.5">
                          {logsLoading[task.id] ? (
                            <div className="flex items-center gap-2 text-gray-500">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Loading logs…
                            </div>
                          ) : logs.length === 0 ? (
                            <p className="text-gray-600">
                              No logs yet for this task.
                            </p>
                          ) : (() => {
                            const _si: number[] = []; let _g = -1;
                            for (const l of logs) {
                              if (l.action === "INFO" && (l.details ?? "").startsWith("── Step: ")) _g++;
                              _si.push(_g);
                            }
                            const _ss: { name: string; ok: number; err: number; skip: number }[] = [];
                            for (let g = 0; g <= _g; g++) {
                              const gl = logs.filter((_, i) => _si[i] === g);
                              _ss.push({
                                name: (gl[0]?.details ?? "").replace("── Step: ", "").replace(" ──", ""),
                                ok:   gl.filter(l => l.action === "SUCCESS").length,
                                err:  gl.filter(l => l.action === "ERROR").length,
                                skip: gl.filter(l => l.action === "SKIP").length,
                              });
                            }
                            return logs.map((log, _li) => {
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

                              // ── STEP HEADER: section divider with inline stats ────
                              if (log.action === "INFO" && (log.details ?? "").startsWith("── Step: ")) {
                                const gs = _ss[_si[_li]] ?? { name: "", ok: 0, err: 0, skip: 0 };
                                const hasR = gs.ok + gs.err + gs.skip > 0;
                                return (
                                  <div key={log.id} className="mt-3 mb-1 flex items-center gap-2">
                                    <div className="flex-1 h-px bg-indigo-500/20" />
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-indigo-500/20 bg-indigo-950/40">
                                      <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">{gs.name}</span>
                                      {hasR && <span className="w-px h-3 bg-indigo-500/30" />}
                                      {gs.ok   > 0 && <span className="text-[10px] text-emerald-400 font-semibold">{gs.ok}✓</span>}
                                      {gs.err  > 0 && <span className="text-[10px] text-red-400 font-semibold">{gs.err}✗</span>}
                                      {gs.skip > 0 && <span className="text-[10px] text-sky-400">{gs.skip} skip</span>}
                                    </div>
                                    <div className="flex-1 h-px bg-indigo-500/20" />
                                  </div>
                                );
                              }

                              // ── SUMMARY: stat card with per-step breakdown ────
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
                                    {_ss.length > 0 && (
                                      <div className="mt-2 pt-2 border-t border-violet-500/15 space-y-1">
                                        {_ss.map((s, si) => (
                                          <div key={si} className="flex items-center gap-2 text-[10px]">
                                            <span className="text-gray-500 w-28 truncate font-medium">{s.name}</span>
                                            {s.ok   > 0 && <span className="text-emerald-400">{s.ok} written</span>}
                                            {s.err  > 0 && <span className="text-red-400">{s.err} error{s.err !== 1 ? "s" : ""}</span>}
                                            {s.skip > 0 && <span className="text-sky-400">{s.skip} skipped</span>}
                                            {s.ok + s.err + s.skip === 0 && <span className="text-gray-600">no records</span>}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              }

                              // Extract optional [Sxx/yy] slot prefix from details for badge rendering.
                              const rawDetails = log.details ?? "";
                              const slotMatch  = rawDetails.match(/^\[S(\d+)\/(\d+)\]\s*/);
                              const slotNum    = slotMatch ? slotMatch[1] : null;
                              const slotTotal  = slotMatch ? slotMatch[2] : null;
                              const bodyText   = slotMatch ? rawDetails.slice(slotMatch[0].length) : rawDetails;

                              return (
                                <div key={log.id} className="flex gap-2 items-start">
                                  <span className="text-gray-600 shrink-0 text-[11px]">
                                    {new Date(log.created_at).toLocaleTimeString()}
                                  </span>
                                  <span className={`shrink-0 font-bold text-[11px] ${color}`}>
                                    [{log.action}]
                                  </span>
                                  {slotNum && (
                                    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 leading-none">
                                      {slotNum}<span className="text-indigo-500 font-normal">/{slotTotal}</span>
                                    </span>
                                  )}
                                  <span className="text-gray-300 break-all text-[12px] flex-1 min-w-0">
                                    {(() => {
                                      const lnkMatch = bodyText.match(/— (Download|Details): (https?:\/\/\S+)/);
                                      const renderedBody = lnkMatch ? (() => {
                                        const fullMarker = lnkMatch[0];
                                        const label = lnkMatch[1] === "Download" ? "Download" : "View Record";
                                        const url = lnkMatch[2];
                                        const before = bodyText.slice(0, bodyText.indexOf(fullMarker));
                                        return <>{before}<a href={url} target="_blank" rel="noopener noreferrer" className="underline text-indigo-400 hover:text-indigo-300">{label}</a></>;
                                      })() : <>{bodyText}</>;
                                      const isLong = bodyText.length > 300;
                                      const isExpanded = !!expandedLogEntries[log.id];
                                      if (!isLong) return renderedBody;
                                      return (
                                        <span className="block">
                                          <span
                                            className="block overflow-hidden transition-all"
                                            style={isExpanded ? undefined : { maxHeight: "5.5rem" }}
                                          >
                                            {renderedBody}
                                          </span>
                                          <button
                                            onClick={() => setExpandedLogEntries(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                                            className="text-[10px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2 mt-0.5 block"
                                          >
                                            {isExpanded ? "show less" : "show more"}
                                          </button>
                                        </span>
                                      );
                                    })()}
                                  </span>
                                  {/* For ERROR logs — quick link to edit the mapping */}
                                  {log.action === "ERROR" && (() => {
                                    const activeSlots = (task.mapping_slots ?? []).filter(s => s.mapping_profile_id);
                                    const mpId = activeSlots[0]?.mapping_profile_id ?? task.mapping_profile_id;
                                    const mp = mappingProfiles.find(m => m.id === mpId);
                                    if (!mp) return null;
                                    return (
                                      <button
                                        onClick={() => setPipelinePanel({ type: "mapping", id: mp.id, taskId: task.id })}
                                        className="shrink-0 ml-2 text-[10px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2 whitespace-nowrap"
                                      >
                                        → edit mapping
                                      </button>
                                    );
                                  })()}
                                </div>
                              );
                            });
                          })()}
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
                {(() => { const sr = serverRuns[summaryPopoverId]; return sr && (sr.status === "pending" || sr.status === "running" || sr.status === "cancelling") ? "Task Running" : "Last Run Summary"; })()}
              </span>
              <button
                onClick={() => { setSummaryPopoverId(null); setSummaryPopoverPos(null); }}
                className="text-gray-600 hover:text-gray-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {(() => { const sr = serverRuns[summaryPopoverId]; return !!(sr && (sr.status === "pending" || sr.status === "running" || sr.status === "cancelling")); })() ? (
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
        const fsLogsFiltered = fsLogSearch.trim()
          ? fsLogs.filter((l) => (l.details ?? "").toLowerCase().includes(fsLogSearch.toLowerCase()) || l.action.toLowerCase().includes(fsLogSearch.toLowerCase()))
          : fsLogs;
        const fsServerRun = serverRuns[fullscreenTaskId];
        const fsLiveStatus = fsServerRun && (fsServerRun.status === "pending" || fsServerRun.status === "running" || fsServerRun.status === "cancelling")
          ? fsServerRun.status
          : null;
        const fsIsRunning = !!fsLiveStatus;
        const fsIsCancelling = fsLiveStatus === "cancelling";
        const levelColor: Record<string, string> = {
          ERROR: "text-red-400",
          WARN: "text-yellow-400",
          SUCCESS: "text-emerald-400",
          SKIP: "text-sky-400",
          COMPLETED: "text-blue-400",
          STARTED: "text-indigo-400",
          EDITED: "text-purple-400",
          SUMMARY: "text-violet-400",
          AI_FIX: "text-violet-300",
          AI_ANALYSIS: "text-sky-300",
          AI_FIX_NEEDED: "text-yellow-300",
          AI_FIX_APPLIED: "text-emerald-300",
          AI_FIXED: "text-emerald-300",
          AI_STUCK: "text-orange-400",
          AI_CANCELLED: "text-gray-500",
        };
        const fsCreated = fsLogs.filter(l => l.action === "SUCCESS" && !(l.details ?? "").includes("Updated")).length;
        const fsUpdated = fsLogs.filter(l => l.action === "SUCCESS" && (l.details ?? "").includes("Updated")).length;
        const fsSkipped = fsLogs.filter(l => l.action === "SKIP").length;
        const fsWarned  = fsLogs.filter(l => l.action === "WARN").length;
        const fsErrored = fsLogs.filter(l => l.action === "ERROR").length;
        return (
          <div
            className="fixed inset-0 bottom-[44px] z-50 flex flex-col bg-gray-950"
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
                {/* Search */}
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <input
                    type="text"
                    placeholder="Search logs..."
                    value={fsLogSearch}
                    onChange={(e) => setFsLogSearch(e.target.value)}
                    className="pl-7 pr-3 py-1 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-44"
                  />
                  {fsLogSearch && (
                    <button onClick={() => setFsLogSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  )}
                </div>
                <div className="w-px h-5 bg-gray-700" />
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

                {/* Run (server-side) */}
                <button
                  onClick={() => fsTask && startServerRun(fsTask)}
                  disabled={fsIsRunning || (fsTask ? resetingTasks.has(fsTask.id) : false)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/40 text-violet-300 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                >
                  {fsIsRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  {fsLiveStatus === "pending" ? "Pending…" : fsLiveStatus === "running" ? "Running…" : fsLiveStatus === "cancelling" ? "Cancelling…" : "Run"}
                </button>
                {/* Debug — debug mode only, admin only */}
                {fsTask?.debug_mode && isAdmin && (
                  <>
                    <button
                      onClick={() => fsTask && setExpandedDebug((prev) => {
                        const next = new Set(prev);
                        if (next.has(fsTask.id)) next.delete(fsTask.id);
                        else next.add(fsTask.id);
                        return next;
                      })}
                      className={`flex items-center gap-1 px-2.5 py-1 border rounded-lg text-xs font-medium transition-all ${
                        fsTask && expandedDebug.has(fsTask.id)
                          ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
                          : "bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/25 text-orange-400"
                      }`}
                      title="Debug mode — click to show Undo"
                    >
                      <Bug className="w-3 h-3" />
                      Debug
                    </button>
                    {fsTask && expandedDebug.has(fsTask.id) && (
                      <button
                        onClick={() => fsTask && resetTask(fsTask)}
                        disabled={fsIsRunning || (fsTask ? resetingTasks.has(fsTask.id) : false) || (fsTask ? (trackedCounts.get(fsTask.id) ?? 0) === 0 : true)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                        title={(fsTask && (trackedCounts.get(fsTask.id) ?? 0) === 0) ? "No records to undo — run the task first in debug mode" : "Undo: delete all Ivanti records created by this run"}
                      >
                        {fsTask && resetingTasks.has(fsTask.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        {fsTask && resetingTasks.has(fsTask.id) ? "Undoing…" : `Undo (${fsTask ? (trackedCounts.get(fsTask.id) ?? 0) : 0})`}
                      </button>
                    )}
                  </>
                )}

                {/* Cancel (server-side) */}
                <button
                  onClick={() => cancelServerRun(fullscreenTaskId)}
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
              ) : fsLogsFiltered.length === 0 ? (
                <p className="text-gray-600">{fsLogSearch ? `No logs match "${fsLogSearch}".` : "No logs yet for this task."}</p>
              ) : (
                fsLogsFiltered.map((log) => {
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
                  const fsRenderedBody = lnkMatch ? (
                    <>{details.slice(0, details.indexOf(lnkMatch[0]))}<a href={lnkMatch[2]} target="_blank" rel="noopener noreferrer" className="underline text-indigo-400 hover:text-indigo-300">{lnkMatch[1] === "Download" ? "Download" : "View Record"}</a></>
                  ) : <>{details}</>;
                  const fsIsLong = details.length > 300;
                  const fsIsExpanded = !!expandedLogEntries[log.id];
                  return (
                    <div key={log.id} className="flex gap-3 items-start">
                      <span className="text-gray-600 shrink-0">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                      <span className={`shrink-0 font-bold ${color}`}>
                        [{log.action}]
                      </span>
                      <span className="text-gray-300 break-all flex-1 min-w-0">
                        {fsIsLong ? (
                          <span className="block">
                            <span className="block overflow-hidden transition-all" style={fsIsExpanded ? undefined : { maxHeight: "5.5rem" }}>
                              {fsRenderedBody}
                            </span>
                            <button onClick={() => setExpandedLogEntries(prev => ({ ...prev, [log.id]: !prev[log.id] }))} className="text-[10px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2 mt-0.5 block">
                              {fsIsExpanded ? "show less" : "show more"}
                            </button>
                          </span>
                        ) : fsRenderedBody}
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
          <div className="relative bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-5xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-indigo-400" />
                Edit Task
              </h3>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  form="edit-task-form"
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
                <button
                  onClick={() => setEditTask(null)}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form id="edit-task-form" onSubmit={handleEditSave} className="p-6 space-y-6">
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
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {!editForm.startDateTime && (
                    <p className="text-xs text-gray-600 mt-1">Leave blank to save without scheduling — task will stay in Waiting.</p>
                  )}
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

                {/* Customer — admin only */}
                {isAdmin && customers.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Customer
                    </label>
                    <select
                      value={editForm.customerId ?? ""}
                      onChange={(e) => setEditForm((p) => ({ ...p, customerId: e.target.value || null }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">— No customer (shared) —</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.company ? ` — ${c.company}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

{/* Mapping Profiles — multi-slot */}
                <div className="md:col-span-2">
                    <div className="flex items-center mb-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 flex-1">
                        <GitMerge className="w-3 h-3 text-purple-400" />
                        Mapping Profiles
                        {editForm.mappingSlots.length > 1 && (
                          <span className="ml-1 text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                            {editForm.mappingSlots.length} slots
                          </span>
                        )}
                      </label>
                      {editForm.mappingSlots.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const allEnabled = editForm.mappingSlots.every((s) => s.enabled !== false);
                            setEditForm((p) => ({
                              ...p,
                              mappingSlots: p.mappingSlots.map((s) => ({ ...s, enabled: !allEnabled })),
                            }));
                          }}
                          className="text-[11px] text-gray-500 hover:text-purple-400 transition-colors"
                        >
                          {editForm.mappingSlots.every((s) => s.enabled !== false) ? "Disable All" : "Enable All"}
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {editForm.mappingSlots.map((slot, slotIdx) => (
                        <div
                            key={slot.id}
                            draggable={editForm.mappingSlots.length > 1}
                            onDragStart={() => { dragEditSlotIdxRef.current = slotIdx; }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              const from = dragEditSlotIdxRef.current;
                              if (from === null || from === slotIdx) return;
                              setEditForm((p) => {
                                const slots = [...p.mappingSlots];
                                const [moved] = slots.splice(from, 1);
                                slots.splice(slotIdx, 0, moved);
                                return { ...p, mappingSlots: slots };
                              });
                              dragEditSlotIdxRef.current = null;
                            }}
                            className={`flex gap-2 items-start transition-opacity ${slot.enabled === false ? "opacity-40" : ""}${editForm.mappingSlots.length > 1 ? " cursor-grab active:cursor-grabbing" : ""}`}
                          >
                          {/* Enable/disable toggle + slot number */}
                          {editForm.mappingSlots.length > 1 && (
                            <div className="flex flex-col items-center gap-0.5 shrink-0 pt-2.5">
                              <GripVertical className="w-3 h-3 text-gray-600 hover:text-gray-400 mb-0.5" />
                              <button
                                type="button"
                                onClick={() => setEditForm((p) => ({
                                  ...p,
                                  mappingSlots: p.mappingSlots.map((s, i) =>
                                    i === slotIdx ? { ...s, enabled: s.enabled === false ? true : false } : s
                                  ),
                                }))}
                                title={slot.enabled === false ? "Enable slot" : "Disable slot"}
                                className={`w-4 h-4 rounded-full border-2 transition-all flex items-center justify-center ${
                                  slot.enabled === false
                                    ? "border-gray-600 bg-transparent"
                                    : "border-emerald-500 bg-emerald-500/30"
                                }`}
                              >
                                {slot.enabled !== false && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 block" />}
                              </button>
                              <span className="text-[11px] text-indigo-400 font-bold font-mono leading-none">{slotIdx + 1}</span>
                            </div>
                          )}
                          {/* Select + optional label stacked */}
                          <div className="flex-1 min-w-0 flex flex-col gap-1">
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
                              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
                                placeholder="Slot label (optional)"
                                className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                              />
                            )}
                          </div>
                          {/* Action button — always show delete when >1 slot, otherwise show manage icon */}
                          {editForm.mappingSlots.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => setEditForm((p) => ({
                                ...p,
                                mappingSlots: p.mappingSlots.filter((_, i) => i !== slotIdx),
                              }))}
                              className="p-2.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded-xl transition-colors shrink-0 mt-0.5"
                              title="Remove slot"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => router.push("/mappings")}
                              className="p-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-purple-400 rounded-xl transition-all shrink-0 mt-0.5"
                              title="Manage mapping profiles"
                            >
                              <GitMerge className="w-4 h-4" />
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

                  {/* Source Directory */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <BookOpen className="w-3 h-3 text-orange-400" />
                      Source Directory
                      <span className="text-gray-600 normal-case font-normal ml-1">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={editForm.sourceDirectory}
                      onChange={(e) => setEditForm((p) => ({ ...p, sourceDirectory: e.target.value }))}
                      placeholder="e.g. mikeco"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    {editForm.sourceDirectory.trim() && (
                      <p className="text-xs text-orange-400 mt-1.5 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Slots with no file configured will look in &quot;{editForm.sourceDirectory.trim()}/&quot;
                      </p>
                    )}
                  </div>

                  {/* Target Connection Override */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Plug className="w-3 h-3 text-cyan-400" />
                      Target Connection Override
                      <span className="text-gray-600 normal-case font-normal ml-1">(optional)</span>
                    </label>
                    <select
                      value={editForm.targetConnectionId ?? ""}
                      onChange={(e) => setEditForm((p) => ({ ...p, targetConnectionId: e.target.value || null }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    >
                      <option value="">— Use connection from each mapping profile —</option>
                      {endpointConnections
                        .filter((c) => c.type !== "file")
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} [{c.type.toUpperCase()}]
                          </option>
                        ))}
                    </select>
                    {editForm.targetConnectionId && (
                      <p className="text-xs text-cyan-400 mt-1.5 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        All slots will use this connection when their mapping profile has no target set
                      </p>
                    )}
                  </div>

                {/* Import Window -- shown when any slot uses a vendor API source */}
                {(() => {
                  const VENDOR_TYPES = ["insight", "dell", "cdw"];
                  const anyVendorSource = editForm.mappingSlots.some((slot) => {
                    const mp = mappingProfiles.find((p) => p.id === slot.mapping_profile_id);
                    const src = endpointConnections.find((c) => c.id === mp?.source_connection_id);
                    return src?.type && VENDOR_TYPES.includes(src.type);
                  });
                  if (!anyVendorSource) return null;
                  return (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <CalendarRange className="w-3 h-3 text-amber-400" />
                        Import Window
                        <span className="text-gray-600 normal-case font-normal ml-1">(optional — leave blank to use connection default)</span>
                      </label>

                      {windowMode === "current" ? (
                        /* Current Day mode: pill (clearable) + Days in the past number input. */
                        <div className="flex items-end gap-3 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              setWindowMode("custom");
                              setEditForm((p) => ({ ...p, lookbackDays: null }));
                            }}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-amber-500/15 border border-amber-500/40 rounded-xl text-amber-300 hover:bg-amber-500/25 transition-colors"
                            title="Switch to a custom date range"
                          >
                            <Check className="w-4 h-4" />
                            Current Day
                            <X className="w-3.5 h-3.5 opacity-70" />
                          </button>

                          <div>
                            <label className="block text-[11px] text-gray-500 mb-1">Days in the past</label>
                            <input
                              type="number"
                              min={0}
                              max={90}
                              placeholder="0"
                              value={editForm.lookbackDays ?? ""}
                              onChange={(e) => {
                                const v = e.target.value.trim();
                                const n = v === "" ? null : Math.max(0, Math.min(90, parseInt(v, 10) || 0));
                                setEditForm((p) => ({ ...p, lookbackDays: n }));
                              }}
                              className="w-28 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                            />
                          </div>

                          <p className="text-xs text-amber-400/70 self-end pb-2.5">
                            {editForm.lookbackDays && editForm.lookbackDays > 0
                              ? `Window: today minus ${editForm.lookbackDays} through yesterday.`
                              : "Window: yesterday only."}
                          </p>
                        </div>
                      ) : (
                        /* Custom range mode: re-enable button + From/To date pickers. */
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setWindowMode("current");
                              setEditForm((p) => ({ ...p, importWindowStart: "", importWindowEnd: "" }));
                            }}
                            className="inline-flex items-center gap-2 px-3 py-2 mb-3 bg-gray-800 border border-gray-700 rounded-xl text-gray-300 hover:bg-gray-700 transition-colors"
                            title="Switch back to today-relative lookback"
                          >
                            <CalendarRange className="w-4 h-4" />
                            Use Current Day
                          </button>

                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <label className="block text-[11px] text-gray-500 mb-1">From</label>
                              <input
                                type="date"
                                value={editForm.importWindowStart}
                                max={editForm.importWindowEnd || undefined}
                                onChange={(e) => setEditForm((p) => ({ ...p, importWindowStart: e.target.value }))}
                                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="block text-[11px] text-gray-500 mb-1">To</label>
                              <input
                                type="date"
                                value={editForm.importWindowEnd}
                                min={editForm.importWindowStart || undefined}
                                onChange={(e) => setEditForm((p) => ({ ...p, importWindowEnd: e.target.value }))}
                                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                              />
                            </div>
                          </div>
                          {editForm.importWindowStart && editForm.importWindowEnd && editForm.importWindowStart > editForm.importWindowEnd && (
                            <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
                              <X className="w-3 h-3" />
                              &apos;From&apos; date must be on or before &apos;To&apos; date.
                            </p>
                          )}
                          {editForm.importWindowStart && editForm.importWindowEnd && editForm.importWindowStart <= editForm.importWindowEnd && (
                            <p className="text-xs text-amber-400/70 mt-1.5 flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              Fetching {editForm.importWindowStart} – {editForm.importWindowEnd}
                            </p>
                          )}
                          {editForm.importWindowStart && !editForm.importWindowEnd && (
                            <p className="text-xs text-amber-400/70 mt-1.5 flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              Fetching from {editForm.importWindowStart} through yesterday
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Insight Steps */}
                {(() => {
                  const hasInsightSteps = editForm.insightSteps.length > 0;
                  const anyInsightSource = editForm.mappingSlots.some((slot) => {
                    const mp = mappingProfiles.find((p) => p.id === slot.mapping_profile_id);
                    const src = endpointConnections.find((c) => c.id === mp?.source_connection_id);
                    return src?.type === "insight";
                  });
                  if (!hasInsightSteps && !anyInsightSource) return null;

                  const SW_CATEGORY_CODES: { code: string; label: string }[] = [
                    { code: "GA", label: "Operating Systems" },
                    { code: "GB", label: "Applications" },
                    { code: "GC", label: "Support" },
                    { code: "ZF", label: "Warranty (electronic)" },
                    { code: "ZU", label: "Warranty (complex)" },
                  ];
                  const RECORD_TYPES: { value: InsightRecordType; label: string; dot: string }[] = [
                    { value: "purchase_line_item", label: "Purchase Line Item", dot: "bg-emerald-400" },
                    { value: "purchase_order",     label: "Purchase Order",     dot: "bg-cyan-400"    },
                    { value: "ci",                 label: "CI (Asset)",         dot: "bg-violet-400"  },
                    { value: "software_product",   label: "Software Product",   dot: "bg-amber-400"   },
                    { value: "contract",           label: "Contract",           dot: "bg-orange-400"  },
                    { value: "contract_line_item", label: "Contract Line Item", dot: "bg-rose-400"    },
                  ];

                  return (
                    <div className="space-y-3 w-full md:col-span-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 flex-wrap">
                        <Plug className="w-3 h-3 text-emerald-400" />
                        Insight Steps
                        <span className="text-gray-600 normal-case font-normal">
                          FK-safe order: Line Items → Orders → CIs
                        </span>
                        {(() => {
                          const n = editForm.insightSteps.filter(s => s.enabled !== false).length;
                          if (n === 0) return null;
                          return <span className="ml-auto text-[10px] font-normal normal-case text-emerald-500/70">1 API call → {n} write{n !== 1 ? "s" : ""}</span>;
                        })()}
                      </label>

                      <div className="space-y-2">
                        {RECORD_TYPES.map(({ value: rtype, label, dot }) => {
                          const step = editForm.insightSteps.find((s) => s.record_type === rtype);
                          const isOn = !!step && step.enabled !== false;

                          return (
                            <div
                              key={rtype}
                              className={`rounded-xl border px-3 py-2.5 transition-all ${
                                step
                                  ? isOn
                                    ? "border-indigo-500/40 bg-indigo-500/5"
                                    : "border-gray-700 bg-gray-800/30 opacity-50"
                                  : "border-gray-700/50 bg-gray-800/20"
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!step) {
                                      setEditForm((p) => ({
                                        ...p,
                                        insightSteps: [
                                          ...p.insightSteps,
                                          {
                                            id: `step-${rtype}-${Date.now()}`,
                                            record_type: rtype as InsightRecordType,
                                            mapping_profile_id: null,
                                            target_connection_id: null,
                                            enabled: true,
                                          },
                                        ],
                                      }));
                                    } else {
                                      setEditForm((p) => ({
                                        ...p,
                                        insightSteps: p.insightSteps.map((s) =>
                                          s.record_type === rtype
                                            ? { ...s, enabled: s.enabled === false ? true : false }
                                            : s
                                        ),
                                      }));
                                    }
                                  }}
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                                    isOn ? "bg-indigo-500" : "bg-gray-600"
                                  }`}
                                  title={step ? (isOn ? "Disable step" : "Enable step") : "Add step"}
                                >
                                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isOn ? "translate-x-4" : "translate-x-0.5"}`} />
                                </button>
                                <span className="text-xs font-semibold text-gray-300 flex-1">{label}</span>
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${isOn ? "text-indigo-400" : "text-gray-600"}`}>
                                  {isOn ? "ON" : step ? "OFF" : "—"}
                                </span>
                                {step && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditForm((p) => ({
                                        ...p,
                                        insightSteps: p.insightSteps.filter((s) => s.record_type !== rtype),
                                      }))
                                    }
                                    className="text-gray-600 hover:text-red-400 transition-colors"
                                    title="Remove step"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>

                              {step && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-6">
                                  <select
                                    value={step.mapping_profile_id ?? ""}
                                    onChange={(e) =>
                                      setEditForm((p) => ({
                                        ...p,
                                        insightSteps: p.insightSteps.map((s) =>
                                          s.record_type === rtype
                                            ? { ...s, mapping_profile_id: e.target.value || null }
                                            : s
                                        ),
                                      }))
                                    }
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  >
                                    <option value="">-- No mapping (send raw) --</option>
                                    {mappingProfiles.map((mp) => (
                                      <option key={mp.id} value={mp.id}>
                                        {mp.name}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={step.target_connection_id ?? ""}
                                    onChange={(e) =>
                                      setEditForm((p) => ({
                                        ...p,
                                        insightSteps: p.insightSteps.map((s) =>
                                          s.record_type === rtype
                                            ? { ...s, target_connection_id: e.target.value || null }
                                            : s
                                        ),
                                      }))
                                    }
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                  >
                                    <option value="">-- Target from mapping --</option>
                                    {endpointConnections
                                      .filter((c) => c.type !== "file" && c.type !== "insight")
                                      .map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name} [{c.type.toUpperCase()}]
                                        </option>
                                      ))}
                                  </select>
                                  <div className="md:col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-tight pt-1">
                                    <span className="text-gray-500 uppercase tracking-wider font-semibold">Category gate</span>
                                    <span className="text-gray-500">Only</span>
                                    {SW_CATEGORY_CODES.map(({ code, label }) => {
                                      const on = (step.category_codes ?? []).includes(code);
                                      return (
                                        <button key={"inc-" + code} type="button" title={label}
                                          onClick={() => setEditForm((p) => ({ ...p, insightSteps: p.insightSteps.map((s) => s.record_type === rtype ? { ...s, category_codes: on ? (s.category_codes ?? []).filter((c) => c !== code) : [...(s.category_codes ?? []), code] } : s) }))}
                                          className={"px-1.5 py-0.5 rounded font-mono border transition-colors " + (on ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300" : "border-gray-700 text-gray-500 hover:text-gray-300")}>
                                          {code}
                                        </button>
                                      );
                                    })}
                                    <span className="text-gray-500 ml-1">Except</span>
                                    {SW_CATEGORY_CODES.map(({ code, label }) => {
                                      const on = (step.exclude_category_codes ?? []).includes(code);
                                      return (
                                        <button key={"exc-" + code} type="button" title={label}
                                          onClick={() => setEditForm((p) => ({ ...p, insightSteps: p.insightSteps.map((s) => s.record_type === rtype ? { ...s, exclude_category_codes: on ? (s.exclude_category_codes ?? []).filter((c) => c !== code) : [...(s.exclude_category_codes ?? []), code] } : s) }))}
                                          className={"px-1.5 py-0.5 rounded font-mono border transition-colors " + (on ? "bg-rose-500/20 border-rose-500/40 text-rose-300" : "border-gray-700 text-gray-500 hover:text-gray-300")}>
                                          {code}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Expand serials toggle */}
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={editForm.expandSerials}
                          onChange={(e) => setEditForm((p) => ({ ...p, expandSerials: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-indigo-500"
                        />
                        <span className="text-xs text-gray-300">Expand to one row per device (serial) — drops lines with no serial</span>
                      </label>
                    </div>
                  );
                })()}
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

      {plumbingTask && (
        <TaskPlumbingModal
          task={plumbingTask}
          connections={endpointConnections}
          mappingProfiles={mappingProfiles}
          onClose={closePlumbing}
        />
      )}

      {/* ── Pipeline Slide-over Panel ── */}
      {pipelinePanel && (() => {
        const isMapping = pipelinePanel.type === "mapping";
        const mp  = isMapping ? mappingProfiles.find(m => m.id === pipelinePanel.id) : null;
        const con = !isMapping ? endpointConnections.find(c => c.id === pipelinePanel.id) : null;
        const task = tasks.find(t => t.id === pipelinePanel.taskId);

        // Resolve sibling connections when showing a mapping
        const srcConn = mp ? endpointConnections.find(c => c.id === mp.source_connection_id) : null;
        const tgtConn = mp ? endpointConnections.find(c => c.id === (task?.target_connection_id ?? mp.target_connection_id)) : null;

        const mappings = mp?.mappings ?? [];

        const editUrl = isMapping
          ? `/mappings/${pipelinePanel.id}?returnTo=scheduler`
          : `/connections/${pipelinePanel.id}?returnTo=scheduler`;

        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
              onClick={() => setPipelinePanel(null)}
            />
            {/* Panel */}
            <div className="fixed top-0 right-0 bottom-0 z-50 w-[400px] bg-gray-900 border-l border-gray-800 shadow-2xl flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800 shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    {isMapping
                      ? <GitMerge className="w-4 h-4 text-purple-400" />
                      : <Plug className="w-4 h-4 text-sky-400" />}
                    <span className="text-sm font-semibold text-white">
                      {isMapping ? "Mapping Profile" : "Endpoint"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 ml-6">
                    {mp?.name ?? con?.name ?? "\u2014"}
                  </p>
                </div>
                <button
                  onClick={() => setPipelinePanel(null)}
                  className="text-gray-600 hover:text-gray-400 transition-colors mt-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {isMapping && mp ? (
                  <>
                    {/* Connected endpoints */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-gray-400">
                        <Plug className="w-3 h-3 text-sky-400" />
                        {srcConn?.name ?? <span className="text-gray-600">No source</span>}
                      </span>
                      <ChevronRight className="w-3 h-3 text-gray-700 shrink-0" />
                      <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-gray-400">
                        <Plug className="w-3 h-3 text-emerald-400" />
                        {tgtConn?.name ?? <span className="text-gray-600">No target</span>}
                      </span>
                    </div>

                    {/* Field mappings */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                          Field Mappings ({mappings.length})
                        </span>
                      </div>
                      <div className="space-y-1">
                        {mappings.slice(0, 20).map((m, i) => {
                          const srcName = mp!.source_fields.find(f => f.id === m.sourceFieldId)?.name ?? m.sourceFieldId;
                          const tgtName = mp!.target_fields.find(f => f.id === m.targetFieldId)?.name ?? m.targetFieldId;
                          return (
                            <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/50 text-[11px]">
                              <span className="text-gray-400 truncate flex-1">{srcName}</span>
                              <ChevronRight className="w-3 h-3 text-gray-700 shrink-0" />
                              <span className="text-gray-300 truncate flex-1 text-right">{tgtName}</span>
                              {m.transform && m.transform !== "none" && (
                                <span className="shrink-0 px-1 py-0.5 rounded bg-indigo-900/40 border border-indigo-700/30 text-indigo-400 text-[10px]">
                                  {m.transform}
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {mappings.length > 20 && (
                          <p className="text-[11px] text-gray-600 pl-1">+{mappings.length - 20} more\u2026</p>
                        )}
                      </div>
                    </div>
                  </>
                ) : con ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700/50">
                        <span className="text-[11px] text-gray-500">Type</span>
                        <span className="text-[11px] text-gray-300 font-medium capitalize">{con.type}</span>
                      </div>
                      {!!(con.config as unknown as Record<string, unknown>)?.url && (
                        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700/50">
                          <span className="text-[11px] text-gray-500">URL</span>
                          <span className="text-[11px] text-gray-300 font-medium truncate max-w-[240px]">
                            {String((con.config as unknown as Record<string, unknown>).url)}
                          </span>
                        </div>
                      )}
                      {!!(con.config as unknown as Record<string, unknown>)?.file_path && (
                        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700/50">
                          <span className="text-[11px] text-gray-500">File</span>
                          <span className="text-[11px] text-gray-300 font-medium truncate max-w-[240px]">
                            {String((con.config as unknown as Record<string, unknown>).file_path)}
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-gray-800 shrink-0 flex gap-2">
                <button
                  onClick={() => { router.push(editUrl); setPipelinePanel(null); }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Full Editor
                </button>
                <button
                  onClick={() => setPipelinePanel(null)}
                  className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded-xl text-sm font-medium transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
