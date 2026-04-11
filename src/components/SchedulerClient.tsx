"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
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
  Activity,
  AlertCircle,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";
import type {
  Profile,
  ScheduledTask,
  TaskLog,
  RuleType,
  RecurrenceType,
  MappingProfile,
} from "@/lib/types";
import { applyMappingProfile } from "@/lib/types";
import { GitMerge } from "lucide-react";

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
  cancelled: {
    label: "Cancelled",
    class: "bg-gray-500/15 text-gray-400 border-gray-500/25",
  },
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  waiting: <Clock className="w-3 h-3" />,
  active: <Activity className="w-3 h-3" />,
  completed: <CheckCircle2 className="w-3 h-3" />,
  cancelled: <AlertCircle className="w-3 h-3" />,
};

const RULE_TYPES: RuleType[] = [
  "Contact Members",
  "Data Transfer",
  "Ivanti CI Sync",
];
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
  ruleType: RuleType;
  ivantiUrl: string;
  file: File | null;
  mappingProfileId: string | null;
}

const EMPTY_FORM: FormState = {
  taskName: "",
  startDateTime: "",
  recurrence: "one-time",
  ruleType: "Contact Members",
  ivantiUrl: "",
  file: null,
  mappingProfileId: null,
};

// ─── Component ───────────────────────────────────────────────

export default function SchedulerClient({
  profile,
  initialTasks,
  userId,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const isAdmin = profile?.user_type === "admin";

  const [tasks, setTasks] = useState<ScheduledTask[]>(initialTasks);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editTask, setEditTask] = useState<ScheduledTask | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  const [runPromptTask, setRunPromptTask] = useState<ScheduledTask | null>(null);
  const [runPromptFile, setRunPromptFile] = useState<File | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [taskLogs, setTaskLogs] = useState<Record<string, TaskLog[]>>({});
  const [logsLoading, setLogsLoading] = useState<Record<string, boolean>>({});
  const [logCounts, setLogCounts] = useState<Record<string, number>>({});

  const [runningTasks, setRunningTasks] = useState<Set<string>>(new Set());
  const [mappingProfiles, setMappingProfiles] = useState<MappingProfile[]>([]);

  // Fetch mapping profiles once on mount
  useEffect(() => {
    supabase
      .from("mapping_profiles")
      .select("id, name, source_fields, target_fields, mappings")
      .order("name")
      .then(({ data }) => {
        if (data) setMappingProfiles(data as MappingProfile[]);
      });
  }, [supabase]);

  const [pollInterval, setPollInterval] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(POLL_KEY);
      return stored ? Math.max(5, parseInt(stored)) : DEFAULT_POLL;
    }
    return DEFAULT_POLL;
  });
  const [pollCustom, setPollCustom] = useState<string>("");
  const [pollCountdown, setPollCountdown] = useState<number>(0);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const executingRef = useRef<Set<string>>(new Set());

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

  // ── Execute a single task ─────────────────────────────────
  const executeTask = useCallback(
    async (task: ScheduledTask, overrideFile?: File) => {
      // Hard guard: prevent concurrent runs of the same task
      if (executingRef.current.has(task.id)) return;
      executingRef.current.add(task.id);
      setRunningTasks((p) => new Set(p).add(task.id));
      console.log(
        `[Execute] Starting task "${task.task_name}" rule="${task.rule_type}"`
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
        if (task.rule_type === "Ivanti CI Sync") {
          if (!task.ivanti_url) {
            throw new Error("Missing Ivanti URL");
          }
          if (!overrideFile && !task.source_file_path) {
            throw new Error("Missing Excel file");
          }

          let arrayBuffer: ArrayBuffer;
          if (overrideFile) {
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `Using uploaded file: ${overrideFile.name}`,
            });
            arrayBuffer = await overrideFile.arrayBuffer();
          } else {
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: `Downloading Excel file: ${task.source_file_path}`,
            });

            const { data: fileData, error: dlError } = await supabase.storage
              .from("task_files")
              .download(task.source_file_path!);

            if (dlError || !fileData)
              throw new Error("Failed to download Excel file: " + dlError?.message);
            arrayBuffer = await fileData.arrayBuffer();
          }

          const wb = XLSX.read(arrayBuffer, { type: "array" });
          const sheetName = wb.SheetNames[0];
          const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(
            wb.Sheets[sheetName]
          );

          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: `Parsed ${rows.length} rows from sheet "${sheetName}"`,
          });

          // Load mapping profile if one is attached
          let mappingProfile: MappingProfile | null = null;
          let targetConnection: Record<string, string> | null = null;

          if (task.mapping_profile_id) {
            const { data: mp } = await supabase
              .from("mapping_profiles")
              .select("*")
              .eq("id", task.mapping_profile_id)
              .single();
            mappingProfile = mp ?? null;
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "INFO",
              details: mappingProfile
                ? `Using mapping profile "${mappingProfile.name}" (${mappingProfile.mappings.length} mappings)`
                : "No mapping profile — sending raw row data",
            });

            // Load target endpoint connection if set on the profile
            if (mappingProfile?.target_connection_id) {
              const { data: conn } = await supabase
                .from("endpoint_connections")
                .select("*")
                .eq("id", mappingProfile.target_connection_id)
                .single();
              if (conn) {
                targetConnection = conn.config as Record<string, string>;
                await supabase.from("task_logs").insert({
                  task_id: task.id,
                  action: "INFO",
                  details: `Using target connection "${conn.name}" [${conn.type.toUpperCase()}]${targetConnection.url ? `: ${targetConnection.url}` : ""}`,
                });
              }
            }
          }

          // Resolve effective connection — Ivanti connection overrides task-level URL
          const effectiveUrl            = targetConnection?.url            ?? task.ivanti_url;
          const effectiveApiKey         = targetConnection?.api_key        ?? undefined;
          const effectiveBusinessObject = targetConnection?.business_object ?? undefined;
          const effectiveTenantId       = targetConnection?.tenant_id       ?? undefined;

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const payload = mappingProfile
              ? applyMappingProfile(row, mappingProfile)
              : row;
            await supabase.from("task_logs").insert({
              task_id: task.id,
              action: "ROW",
              details: `Sending row ${i + 1}/${rows.length}: ${JSON.stringify(payload)}`,
            });

            try {
              const res = await fetch("/api/ivanti-proxy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ivantiUrl:      effectiveUrl,
                  data:           payload,
                  apiKey:         effectiveApiKey,
                  businessObject: effectiveBusinessObject,
                  tenantId:       effectiveTenantId,
                }),
              });
              const json = await res.json();
              await supabase.from("task_logs").insert({
                task_id: task.id,
                action: res.ok ? "SUCCESS" : "WARN",
                details: `Row ${i + 1} response: ${JSON.stringify(json)}`,
              });
            } catch (rowErr: unknown) {
              await supabase.from("task_logs").insert({
                task_id: task.id,
                action: "ERROR",
                details: `Row ${i + 1} failed: ${
                  rowErr instanceof Error ? rowErr.message : String(rowErr)
                }`,
              });
            }
          }
        } else if (task.rule_type === "Data Transfer") {
          if (!task.source_file_path)
            throw new Error("Missing Excel file path");
          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: `Data Transfer: processing file ${task.source_file_path}`,
          });
          await new Promise((r) => setTimeout(r, 800));
          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: "Data Transfer completed successfully",
          });
        } else {
          // Contact Members
          await new Promise((r) => setTimeout(r, 500));
          await supabase.from("task_logs").insert({
            task_id: task.id,
            action: "INFO",
            details: "Contact Members rule executed",
          });
        }

        await supabase
          .from("scheduled_tasks")
          .update({ status: "completed" })
          .eq("id", task.id);

        await supabase.from("task_logs").insert({
          task_id: task.id,
          action: "COMPLETED",
          details: `Task finished successfully at ${new Date().toISOString()}`,
        });
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
        executingRef.current.delete(task.id);
        setRunningTasks((p) => {
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
      const due = current.filter((t) => {
        if (t.status !== "waiting") return false;
        const start = new Date(t.start_date_time);
        return start <= now;
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

  async function toggleLogs(taskId: string) {
    const next = !expandedLogs[taskId];
    setExpandedLogs((p) => ({ ...p, [taskId]: next }));
    if (next) await fetchLogs(taskId);
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
      let sourceFilePath: string | null = null;

      if (
        form.file &&
        (form.ruleType === "Data Transfer" ||
          form.ruleType === "Ivanti CI Sync")
      ) {
        const ext = form.file.name.split(".").pop();
        const filePath = `${userId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("task_files")
          .upload(filePath, form.file);
        if (upErr) throw new Error("File upload failed: " + upErr.message);
        sourceFilePath = filePath;
      }

      const startUtc = new Date(form.startDateTime).toISOString();

      const { error } = await supabase.from("scheduled_tasks").insert({
        task_name: form.taskName,
        start_date_time: startUtc,
        recurrence: form.recurrence,
        rule_type: form.ruleType,
        source_file_path: sourceFilePath,
        ivanti_url:
          form.ruleType === "Ivanti CI Sync" ? form.ivantiUrl : null,
        mapping_profile_id: form.mappingProfileId ?? null,
        status: "waiting",
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
      ruleType: task.rule_type,
      ivantiUrl: task.ivanti_url ?? "",
      file: null,
      mappingProfileId: task.mapping_profile_id ?? null,
    });
  }

  // ── Save edit ─────────────────────────────────────────────
  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editTask) return;
    setEditSubmitting(true);

    try {
      let sourceFilePath = editTask.source_file_path;

      if (
        editForm.file &&
        (editForm.ruleType === "Data Transfer" ||
          editForm.ruleType === "Ivanti CI Sync")
      ) {
        const ext = editForm.file.name.split(".").pop();
        const filePath = `${userId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("task_files")
          .upload(filePath, editForm.file);
        if (upErr) throw new Error("File upload failed: " + upErr.message);
        sourceFilePath = filePath;
      }

      const startUtc = new Date(editForm.startDateTime).toISOString();

      const { error } = await supabase
        .from("scheduled_tasks")
        .update({
          task_name: editForm.taskName,
          start_date_time: startUtc,
          recurrence: editForm.recurrence,
          rule_type: editForm.ruleType,
          source_file_path: sourceFilePath,
          ivanti_url:
            editForm.ruleType === "Ivanti CI Sync"
              ? editForm.ivantiUrl
              : null,
          mapping_profile_id: editForm.mappingProfileId ?? null,
          status: "waiting",
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

          {/* Admin polling control */}
          {isAdmin && (
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
                    onClick={() => { setPollInterval(s); setPollCustom(""); }}
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
                <div>
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

                {/* Rule Type */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Rule Type
                  </label>
                  <select
                    value={form.ruleType}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        ruleType: e.target.value as RuleType,
                      }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    {RULE_TYPES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Ivanti URL */}
                {form.ruleType === "Ivanti CI Sync" && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Ivanti Base URL
                    </label>
                    <input
                      type="url"
                      value={form.ivantiUrl}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, ivantiUrl: e.target.value }))
                      }
                      required
                      placeholder="https://your-ivanti-instance.example.com"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                )}

                {/* Excel Upload */}
                {(form.ruleType === "Data Transfer" ||
                  form.ruleType === "Ivanti CI Sync") && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Excel File (.xlsx / .xls)
                    </label>
                    <div className="flex items-center gap-4">
                      <label className="flex-1 cursor-pointer">
                        <div className="bg-gray-800 border border-dashed border-gray-600 hover:border-indigo-500 rounded-xl px-4 py-4 text-center transition-colors">
                          <p className="text-sm text-gray-400">
                            {form.file
                              ? form.file.name
                              : "Click to select an Excel file"}
                          </p>
                        </div>
                        <input
                          type="file"
                          accept=".xlsx,.xls"
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              file: e.target.files?.[0] ?? null,
                            }))
                          }
                          className="hidden"
                        />
                      </label>
                      {form.file && (
                        <button
                          type="button"
                          onClick={() => setForm((p) => ({ ...p, file: null }))}
                          className="text-gray-500 hover:text-red-400 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Mapping Profile */}
                {(form.ruleType === "Data Transfer" ||
                  form.ruleType === "Ivanti CI Sync") && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <GitMerge className="w-3 h-3 text-purple-400" />
                      Mapping Profile
                      <span className="text-gray-600 normal-case font-normal">(optional)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={form.mappingProfileId ?? ""}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            mappingProfileId: e.target.value || null,
                          }))
                        }
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        <option value="">— No mapping (send raw data) —</option>
                        {mappingProfiles.map((mp) => (
                          <option key={mp.id} value={mp.id}>
                            {mp.name} ({mp.mappings?.length ?? 0} mappings)
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => router.push("/mappings")}
                        className="px-3 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-purple-400 rounded-xl transition-all"
                        title="Manage mapping profiles"
                      >
                        <GitMerge className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
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
                  <div
                    key={task.id}
                    className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-lg"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5">
                      {/* Status badge */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border shrink-0 ${badge.class}`}
                      >
                        {icon}
                        {badge.label}
                      </span>

                      {/* Task info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate">
                          {task.task_name}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {task.rule_type} &bull;{" "}
                          {task.recurrence.charAt(0).toUpperCase() +
                            task.recurrence.slice(1)}{" "}
                          &bull; {formatLocalDateTime(task.start_date_time)}
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
                          onClick={() => {
                            if (task.source_file_path) {
                              setRunPromptFile(null);
                              setRunPromptTask(task);
                            } else {
                              executeTask(task);
                            }
                          }}
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
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                            Execution Logs
                          </span>
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
                                COMPLETED: "text-blue-400",
                                STARTED: "text-indigo-400",
                                EDITED: "text-purple-400",
                              };
                              const color =
                                levelColor[log.action] ?? "text-gray-400";
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
                                    {log.details}
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ── Run Prompt Modal ── */}
      {runPromptTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setRunPromptTask(null)}
          />
          <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Play className="w-4 h-4 text-emerald-400" />
                Run &ldquo;{runPromptTask.task_name}&rdquo;
              </h3>
              <button
                onClick={() => setRunPromptTask(null)}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Source File
              </p>
              <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-300">
                {runPromptFile
                  ? runPromptFile.name
                  : runPromptTask.source_file_path?.split("/").pop() ?? "—"}
              </div>
              <label className="cursor-pointer mt-1">
                <div className="bg-gray-800 hover:bg-gray-750 border border-dashed border-gray-600 hover:border-indigo-500 rounded-xl px-4 py-3 text-center transition-colors">
                  <p className="text-sm text-gray-400">
                    {runPromptFile ? "✓ New file selected — click to change" : "Upload a different file (optional)"}
                  </p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => setRunPromptFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setRunPromptTask(null)}
                className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const task = runPromptTask;
                  const file = runPromptFile ?? undefined;
                  setRunPromptTask(null);
                  setRunPromptFile(null);
                  executeTask(task, file);
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-emerald-600/20"
              >
                <Play className="w-4 h-4" />
                Run Now
              </button>
            </div>
          </div>
        </div>
      )}

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

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Rule Type
                  </label>
                  <select
                    value={editForm.ruleType}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        ruleType: e.target.value as RuleType,
                      }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {RULE_TYPES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                {editForm.ruleType === "Ivanti CI Sync" && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Ivanti Base URL
                    </label>
                    <input
                      type="url"
                      value={editForm.ivantiUrl}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          ivantiUrl: e.target.value,
                        }))
                      }
                      required
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}

                {(editForm.ruleType === "Data Transfer" ||
                  editForm.ruleType === "Ivanti CI Sync") && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <GitMerge className="w-3 h-3 text-purple-400" />
                      Mapping Profile
                      <span className="text-gray-600 normal-case font-normal">(optional)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={editForm.mappingProfileId ?? ""}
                        onChange={(e) =>
                          setEditForm((p) => ({
                            ...p,
                            mappingProfileId: e.target.value || null,
                          }))
                        }
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        <option value="">— No mapping (send raw data) —</option>
                        {mappingProfiles.map((mp) => (
                          <option key={mp.id} value={mp.id}>
                            {mp.name} ({mp.mappings?.length ?? 0} mappings)
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => router.push("/mappings")}
                        className="px-3 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-purple-400 rounded-xl transition-all"
                        title="Manage mapping profiles"
                      >
                        <GitMerge className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {(editForm.ruleType === "Data Transfer" ||
                  editForm.ruleType === "Ivanti CI Sync") && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Replace Excel File (optional)
                    </label>
                    <label className="cursor-pointer block">
                      <div className="bg-gray-800 border border-dashed border-gray-600 hover:border-indigo-500 rounded-xl px-4 py-4 text-center transition-colors">
                        <p className="text-sm text-gray-400">
                          {editForm.file
                            ? editForm.file.name
                            : editTask.source_file_path
                            ? `Current: ${editTask.source_file_path
                                .split("/")
                                .pop()} — click to replace`
                            : "Click to select an Excel file"}
                        </p>
                      </div>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={(e) =>
                          setEditForm((p) => ({
                            ...p,
                            file: e.target.files?.[0] ?? null,
                          }))
                        }
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
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
