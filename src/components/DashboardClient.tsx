"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase-browser";
import { useTheme } from "next-themes";
import {
  Sun,
  Moon,
  LogOut,
  CalendarClock,
  Activity,
  Clock,
  CheckCircle2,
  BarChart3,
  Zap,
  GitMerge,
  Plug,
  Users,
  AlertTriangle,
  Shield,
  AlertCircle,
  Ban,
  History,
} from "lucide-react";
import type { Profile, UserRole } from "@/lib/types";
import CustomerSwitcher, { type CustomerOption } from "@/components/CustomerSwitcher";

interface Counts {
  active: number;
  waiting: number;
  completed: number;
  completedWithErrors: number;
  completedWithWarnings: number;
  cancelled: number;
  total: number;
  bohAttention: number;
}

export interface RecentRun {
  id: string;
  task_id: string;
  details: string | null;
  created_at: string;
  scheduled_tasks: { task_name: string; status: string } | null;
}

interface Props {
  profile: Profile | null;
  initialCounts: Counts;
  role: UserRole;
  initialRecentRuns?: RecentRun[];
  customers?: CustomerOption[];
  activeCustomerId?: string | null;
}

export default function DashboardClient({ profile, initialCounts, role, initialRecentRuns = [], customers = [], activeCustomerId = null }: Props) {
  const isAdmin = role === "administrator";
  const isBasic = role === "basic";
  const router = useRouter();
  const supabase = createClient();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>(initialRecentRuns);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  function resolveAvatarUrl(raw: string | null): string | null {
    if (!raw) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    const clean = raw.startsWith("/") ? raw.slice(1) : raw;
    return `${supabaseUrl}/storage/v1/object/public/avatars/${clean}`;
  }

  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    resolveAvatarUrl(profile?.avatar_url ?? null)
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refreshRecentRuns() {
    const { data } = await supabase
      .from("task_logs")
      .select("id, task_id, details, created_at, scheduled_tasks(task_name, status)")
      .eq("action", "SUMMARY")
      .order("created_at", { ascending: false })
      .limit(10);
    if (data) setRecentRuns(data as unknown as RecentRun[]);
  }

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-tasks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_tasks" },
        async () => {
          const { data } = await supabase
            .from("scheduled_tasks")
            .select("status");
          if (data) {
            setCounts((prev) => ({
              ...prev,
              active: data.filter((t) => t.status === "active").length,
              waiting: data.filter((t) => t.status === "waiting").length,
              completed: data.filter((t) => ["completed", "completed_with_errors", "completed_with_warnings"].includes(t.status)).length,
              completedWithErrors: data.filter((t) => t.status === "completed_with_errors").length,
              completedWithWarnings: data.filter((t) => t.status === "completed_with_warnings").length,
              cancelled: data.filter((t) => t.status === "cancelled").length,
              total: data.length,
            }));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_logs", filter: "action=eq.SUMMARY" },
        () => { void refreshRecentRuns(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${profile.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", profile.id);
      setAvatarUrl(resolveAvatarUrl(publicUrl) + "?t=" + Date.now());
    } catch (err) {
      console.error("Avatar upload error:", err);
      alert("Failed to upload avatar. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "User";
  const initials =
    [profile?.first_name?.[0], profile?.last_name?.[0]]
      .filter(Boolean)
      .join("")
      .toUpperCase() || "U";

  const statCards = [
    { label: "Active",                value: counts.active,                                                           icon: Activity,     bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400" },
    { label: "Waiting",               value: counts.waiting,                                                          icon: Clock,        bg: "bg-yellow-500/10",  border: "border-yellow-500/20",  text: "text-yellow-400"  },
    { label: "Completed",             value: counts.completed - counts.completedWithErrors - counts.completedWithWarnings, icon: CheckCircle2, bg: "bg-blue-500/10",    border: "border-blue-500/20",    text: "text-blue-400"    },
    { label: "Completed w/ Warnings", value: counts.completedWithWarnings,                                            icon: AlertTriangle, bg: "bg-orange-500/10",  border: "border-orange-500/20",  text: "text-orange-400"  },
    { label: "Completed w/ Errors",   value: counts.completedWithErrors,                                              icon: AlertCircle,  bg: "bg-red-500/10",     border: "border-red-500/20",     text: "text-red-400"     },
    { label: "Cancelled",             value: counts.cancelled,                                                        icon: Ban,          bg: "bg-gray-500/10",    border: "border-gray-500/20",    text: "text-gray-400"    },
    { label: "Total",                 value: counts.total,                                                            icon: BarChart3,    bg: "bg-violet-500/10",  border: "border-violet-500/20",  text: "text-violet-400"  },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,245,255,0.04)_0%,_rgba(123,97,255,0.04)_50%,_transparent_100%)] pointer-events-none" />

      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center lg-glow-cyan" style={{ background: "linear-gradient(135deg, #00F5FF 0%, #7B61FF 100%)" }}>
              <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-bold lg-gradient-text text-lg">LuminaGrid</span>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && customers.length > 0 && (
              <CustomerSwitcher customers={customers} activeCustomerId={activeCustomerId} />
            )}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="w-9 h-9 rounded-xl bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-all"
              title="Toggle theme"
            >
              {mounted && theme === "dark" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
            <div className="flex items-center gap-3 bg-gray-800 rounded-2xl px-4 py-2">
              {avatarUrl ? (
                <Image src={avatarUrl} alt="Avatar" width={32} height={32} className="rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, #00c8ff 0%, #7B61FF 100%)" }}>
                  {initials}
                </div>
              )}
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-white leading-none">{fullName}</p>
                <p className="text-xs text-gray-400 mt-0.5">{profile?.email}</p>
                <p className={"text-xs font-medium mt-0.5 " + (isAdmin ? "text-violet-400" : role === "basic" ? "text-amber-400" : "text-teal-400")}>
                  {isAdmin ? "Administrator" : role === "basic" ? "Basic" : "Schedule Administrator"}
                </p>
              </div>
            </div>
            {/* Avatar upload (hidden input) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <button
              onClick={handleLogout}
              className="w-9 h-9 rounded-xl bg-gray-800 hover:bg-red-500/20 border border-transparent hover:border-red-500/30 flex items-center justify-center text-gray-400 hover:text-red-400 transition-all"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-white">Welcome back, {profile?.first_name || "User"} 👋</h2>
          <p className="text-gray-400 mt-1">Your intelligent data flow, at once.</p>
        </div>

        {/* ── Task Status Cards ── */}
        <div className="flex flex-wrap gap-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className={`${card.bg} border ${card.border} rounded-2xl p-5 shadow-lg flex-1 min-w-[130px]`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${card.text}`}>{card.label}</span>
                  <Icon className={`w-4 h-4 ${card.text}`} />
                </div>
                <p className={`text-4xl font-bold ${card.text}`}>{card.value}</p>
              </div>
            );
          })}
        </div>

        {/* ── Quick Actions ── */}
        {!isBasic && <div className="space-y-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            <button
              onClick={() => router.push("/scheduler")}
              className="bg-[#1E2937] hover:bg-slate-800 border border-slate-700/50 hover:border-cyan-500/40 rounded-2xl p-5 text-left transition-all duration-200 group shadow-lg"
            >
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 group-hover:bg-cyan-500/20 transition-colors">
                <CalendarClock className="w-5 h-5 text-cyan-400" />
              </div>
              <h4 className="text-white font-semibold">Scheduler</h4>
              <p className="text-slate-400 text-sm mt-1">Create, manage, and monitor scheduled tasks.</p>
              <div className="mt-3 flex items-center gap-1 text-cyan-400 text-sm font-medium">
                Open <span className="group-hover:translate-x-1 transition-transform">&#8594;</span>
              </div>
            </button>

            <button
              onClick={() => router.push("/mappings")}
              className="bg-[#1E2937] hover:bg-slate-800 border border-slate-700/50 hover:border-violet-500/40 rounded-2xl p-5 text-left transition-all duration-200 group shadow-lg"
            >
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-3 group-hover:bg-violet-500/20 transition-colors">
                <GitMerge className="w-5 h-5 text-violet-400" />
              </div>
              <h4 className="text-white font-semibold">Field Mappings</h4>
              <p className="text-slate-400 text-sm mt-1">Map source fields to targets with transforms.</p>
              <div className="mt-3 flex items-center gap-1 text-violet-400 text-sm font-medium">
                Open <span className="group-hover:translate-x-1 transition-transform">&#8594;</span>
              </div>
            </button>

            <button
              onClick={() => router.push("/connections")}
              className="bg-[#1E2937] hover:bg-slate-800 border border-slate-700/50 hover:border-cyan-500/40 rounded-2xl p-5 text-left transition-all duration-200 group shadow-lg"
            >
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 group-hover:bg-cyan-500/20 transition-colors">
                <Plug className="w-5 h-5 text-cyan-400" />
              </div>
              <h4 className="text-white font-semibold">Endpoint Connections</h4>
              <p className="text-slate-400 text-sm mt-1">Manage file, cloud, API, and portal connections.</p>
              <div className="mt-3 flex items-center gap-1 text-cyan-400 text-sm font-medium">
                Open <span className="group-hover:translate-x-1 transition-transform">&#8594;</span>
              </div>
            </button>

            {isAdmin && (
              <button
                onClick={() => router.push("/boh/customers")}
                className={`bg-gray-900 hover:bg-gray-800 border rounded-2xl p-5 text-left transition-all duration-200 group shadow-lg ${
                  counts.bohAttention > 0
                    ? "border-yellow-500/40 hover:border-yellow-500/60"
                    : "border-gray-800 hover:border-violet-500/40"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    counts.bohAttention > 0
                      ? "bg-yellow-500/10 border border-yellow-500/20 group-hover:bg-yellow-500/20"
                      : "bg-violet-500/10 border border-violet-500/20 group-hover:bg-violet-500/20"
                  }`}>
                    <Users className={`w-5 h-5 ${counts.bohAttention > 0 ? "text-yellow-400" : "text-violet-400"}`} />
                  </div>
                  {counts.bohAttention > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 rounded-full text-xs font-semibold">
                      <AlertTriangle className="w-3 h-3" />
                      {counts.bohAttention}
                    </span>
                  )}
                </div>
                <h4 className="text-white font-semibold">Back of House</h4>
                <p className="text-gray-400 text-sm mt-1">Customers, licenses, payments &amp; alerts.</p>
                <div className={`mt-3 flex items-center gap-1 text-sm font-medium ${counts.bohAttention > 0 ? "text-yellow-400" : "text-violet-400"}`}>
                  Open <span className="group-hover:translate-x-1 transition-transform">&#8594;</span>
                </div>
              </button>
            )}



          </div>
        </div>}

        {/* ── Recent Runs ── */}
        {!isBasic && <div className="space-y-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Recent Runs</h3>
          </div>
          {recentRuns.length === 0 ? (
            <p className="text-sm text-gray-600">No completed runs yet. Run a task to see its summary here.</p>
          ) : (
            <div className="space-y-2">
              {recentRuns.map((run) => {
                const parts = (run.details ?? "").split(" | ");
                const statMap: Record<string, string> = {};
                for (const p of parts) {
                  const idx = p.indexOf(": ");
                  if (idx !== -1) statMap[p.slice(0, idx)] = p.slice(idx + 2);
                }

                const taskStatus = run.scheduled_tasks?.status ?? "";
                const statusColor =
                  taskStatus === "completed"
                    ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
                    : taskStatus === "completed_with_errors"
                    ? "text-red-400 bg-red-500/10 border-red-500/20"
                    : taskStatus === "completed_with_warnings"
                    ? "text-orange-400 bg-orange-500/10 border-orange-500/20"
                    : taskStatus === "cancelled"
                    ? "text-gray-400 bg-gray-500/10 border-gray-500/20"
                    : "text-violet-400 bg-violet-500/10 border-violet-500/20";

                const highlight = [
                  statMap["Rows Processed"] ? `${statMap["Rows Processed"]} rows` : null,
                  statMap["Created"]  && statMap["Created"]  !== "0" ? `${statMap["Created"]} created`  : null,
                  statMap["Updated"]  && statMap["Updated"]  !== "0" ? `${statMap["Updated"]} updated`  : null,
                  statMap["Skipped"]  ? `${statMap["Skipped"]} skipped`   : null,
                  statMap["Warnings"] ? `${statMap["Warnings"]} warnings` : null,
                  statMap["Errors"]   ? `${statMap["Errors"]} errors`     : null,
                ].filter(Boolean).join(" · ");

                return (
                  <div
                    key={run.id}
                    className="flex items-start gap-4 p-4 bg-gray-900 border border-gray-800 rounded-2xl hover:border-gray-700 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium text-white truncate">
                          {run.scheduled_tasks?.task_name ?? "Unknown Task"}
                        </span>
                        {taskStatus && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${statusColor}`}>
                            {taskStatus.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                      {highlight && (
                        <p className="text-xs text-gray-400 mb-1">{highlight}</p>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {statMap["Duration"] && (
                          <span className="text-[10px] text-gray-500">Duration: {statMap["Duration"]}</span>
                        )}
                        {statMap["Token Cost"] && (
                          <span className="text-[10px] text-gray-500">
                            AI cost: {statMap["Token Cost"]} ({statMap["Tokens"]} tokens)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-xs text-gray-600">
                        {new Date(run.created_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>}

      </main>
    </div>
  );
}
