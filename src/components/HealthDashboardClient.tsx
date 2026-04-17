"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Activity, Users, CheckCircle2, XCircle, Key, UserCog,
  Clock, AlertTriangle, CreditCard, Zap,
  MinusCircle, AlertCircle, Ban, Search, BarChart3,
} from "lucide-react";
import type { PaymentStatus } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────

interface CustomerLicenseSummary {
  id: string;
  status: string;
  expiry_date: string | null;
  renewal_type: string;
}

interface CustomerRow {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  payment_status: PaymentStatus;
  card_type: string | null;
  card_last4: string | null;
  card_expiry_month: number | null;
  card_expiry_year: number | null;
  alert_days_before: number;
  customer_licenses: CustomerLicenseSummary[];
}

interface TaskRow {
  id: string;
  customer_id: string | null;
  status: string;
  updated_at: string;
}

interface Props {
  customers: CustomerRow[];
  tasks: TaskRow[];
  lastRunByTask: Record<string, string>;
}

// ── Helpers ───────────────────────────────────────────────────

const PAYMENT_META: Record<PaymentStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  active:  { label: "Active",  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25", icon: <CheckCircle2 className="w-3 h-3" /> },
  lapsed:  { label: "Lapsed",  color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/25",  icon: <Clock className="w-3 h-3" /> },
  failed:  { label: "Failed",  color: "text-red-400",     bg: "bg-red-500/10 border-red-500/25",        icon: <XCircle className="w-3 h-3" /> },
  pending: { label: "Pending", color: "text-gray-400",    bg: "bg-gray-500/10 border-gray-500/25",      icon: <Clock className="w-3 h-3" /> },
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

type TaskStatusGroup = {
  active: number;
  waiting: number;
  completed: number;
  errors: number;
  warnings: number;
  cancelled: number;
  total: number;
  lastRun: string | null;
};

function groupTasks(tasks: TaskRow[], lastRunByTask: Record<string, string>): TaskStatusGroup {
  const g: TaskStatusGroup = { active: 0, waiting: 0, completed: 0, errors: 0, warnings: 0, cancelled: 0, total: tasks.length, lastRun: null };
  let latestRun: string | null = null;
  for (const t of tasks) {
    if      (t.status === "active")                    g.active++;
    else if (t.status === "waiting")                   g.waiting++;
    else if (t.status === "completed")                 g.completed++;
    else if (t.status === "completed_with_errors")     g.errors++;
    else if (t.status === "completed_with_warnings")   g.warnings++;
    else if (t.status === "cancelled")                 g.cancelled++;

    const lr = lastRunByTask[t.id];
    if (lr && (!latestRun || lr > latestRun)) latestRun = lr;
  }
  g.lastRun = latestRun;
  return g;
}

/** Traffic-light health for tasks */
function taskHealth(g: TaskStatusGroup): "green" | "yellow" | "red" | "none" {
  if (g.total === 0) return "none";
  if (g.errors > 0) return "red";
  if (g.warnings > 0 || g.active > 0) return "yellow";
  return "green";
}

/** Traffic-light health for payment */
function paymentHealth(c: CustomerRow): "green" | "yellow" | "red" | "none" {
  if (c.payment_status === "failed") return "red";
  if (c.payment_status === "lapsed") return "yellow";
  if (c.payment_status === "pending") return "yellow";

  const threshold = (c.alert_days_before ?? 30);
  for (const lic of c.customer_licenses) {
    if (lic.status === "expired" || lic.status === "cancelled") continue;
    const days = daysUntil(lic.expiry_date);
    if (days !== null && days < 0) return "red";
    if (days !== null && days <= threshold) return "yellow";
    if (lic.renewal_type === "manual" && days !== null && days <= 60) return "yellow";
  }
  return "green";
}

const HEALTH_DOT: Record<"green" | "yellow" | "red" | "none", string> = {
  green:  "bg-emerald-500",
  yellow: "bg-yellow-500",
  red:    "bg-red-500",
  none:   "bg-gray-600",
};

function overallHealth(t: "green" | "yellow" | "red" | "none", p: "green" | "yellow" | "red" | "none"): "green" | "yellow" | "red" | "none" {
  if (t === "red" || p === "red") return "red";
  if (t === "yellow" || p === "yellow") return "yellow";
  if (t === "green" && p === "green") return "green";
  if (t === "green" || p === "green") return "green";
  return "none";
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Stat chip ────────────────────────────────────────────────

function Chip({ count, label, color }: { count: number; label: string; color: string }) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ${color}`}>
      {count} {label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────

export default function HealthDashboardClient({ customers, tasks, lastRunByTask }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "red" | "yellow" | "green">("all");

  // Group tasks by customer_id
  const tasksByCustomer: Record<string, TaskRow[]> = {};
  const unassignedTasks: TaskRow[] = [];
  for (const t of tasks) {
    if (!t.customer_id) {
      unassignedTasks.push(t);
    } else {
      tasksByCustomer[t.customer_id] = tasksByCustomer[t.customer_id] ?? [];
      tasksByCustomer[t.customer_id].push(t);
    }
  }

  // Build rows
  const rows = customers.map((c) => {
    const ctasks = tasksByCustomer[c.id] ?? [];
    const tg = groupTasks(ctasks, lastRunByTask);
    const th = taskHealth(tg);
    const ph = paymentHealth(c);
    const oh = overallHealth(th, ph);

    const activeLicenses = c.customer_licenses.filter(
      (l) => l.status === "active" || l.status === "trial"
    );
    const soonestExpiry = c.customer_licenses
      .filter((l) => l.expiry_date && (l.status === "active" || l.status === "trial"))
      .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())[0];
    const soonestDays = soonestExpiry ? daysUntil(soonestExpiry.expiry_date) : null;

    return { customer: c, tg, th, ph, oh, activeLicenses, soonestDays };
  });

  const unassignedGroup = groupTasks(unassignedTasks, lastRunByTask);

  // Filter
  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch =
      r.customer.name.toLowerCase().includes(q) ||
      (r.customer.company ?? "").toLowerCase().includes(q) ||
      (r.customer.email ?? "").toLowerCase().includes(q);
    const matchFilter = filter === "all" || r.oh === filter;
    return matchSearch && matchFilter;
  });

  const redCount    = rows.filter((r) => r.oh === "red").length;
  const yellowCount = rows.filter((r) => r.oh === "yellow").length;
  const greenCount  = rows.filter((r) => r.oh === "green").length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </button>
            <span className="text-gray-700">|</span>
            {/* BOH nav tabs */}
            <nav className="flex items-center gap-1">
              <button
                onClick={() => router.push("/boh/customers")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
              >
                <Users className="w-3.5 h-3.5" />
                Customers
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
              >
                <Activity className="w-3.5 h-3.5" />
                Health
              </button>
              <button
                onClick={() => router.push("/boh/license-types")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
              >
                <Key className="w-3.5 h-3.5" />
                License Types
              </button>
              <button
                onClick={() => router.push("/boh/users")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
              >
                <UserCog className="w-3.5 h-3.5" />
                Users
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* Summary badges */}
            {redCount > 0 && (
              <button
                onClick={() => setFilter(filter === "red" ? "all" : "red")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${filter === "red" ? "bg-red-500/25 border-red-500/50 text-red-300" : "bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/20"}`}
              >
                <XCircle className="w-3.5 h-3.5" />
                {redCount} critical
              </button>
            )}
            {yellowCount > 0 && (
              <button
                onClick={() => setFilter(filter === "yellow" ? "all" : "yellow")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${filter === "yellow" ? "bg-yellow-500/25 border-yellow-500/50 text-yellow-300" : "bg-yellow-500/10 border-yellow-500/25 text-yellow-400 hover:bg-yellow-500/20"}`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {yellowCount} warning
              </button>
            )}
            {/* Search */}
            <div className="relative hidden sm:flex">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customers…"
                className="bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48"
              />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total customers", value: customers.length, icon: <Users className="w-4 h-4" />, color: "text-gray-300" },
            { label: "Critical",        value: redCount,          icon: <XCircle className="w-4 h-4" />, color: redCount > 0 ? "text-red-400" : "text-gray-600" },
            { label: "Warning",         value: yellowCount,       icon: <AlertTriangle className="w-4 h-4" />, color: yellowCount > 0 ? "text-yellow-400" : "text-gray-600" },
            { label: "Healthy",         value: greenCount,        icon: <CheckCircle2 className="w-4 h-4" />, color: greenCount > 0 ? "text-emerald-400" : "text-gray-600" },
          ].map((s) => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className={s.color}>{s.icon}</span>
              <div>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Customer health rows */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <BarChart3 className="w-12 h-12 text-gray-700" />
            <p className="text-gray-400">No customers match your filter</p>
            <button onClick={() => { setSearch(""); setFilter("all"); }} className="text-sm text-indigo-400 hover:text-indigo-300">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(({ customer: c, tg, th, ph, oh, activeLicenses, soonestDays }) => {
              const payMeta = PAYMENT_META[c.payment_status];
              return (
                <div
                  key={c.id}
                  className={`bg-gray-900 border rounded-2xl overflow-hidden transition-colors ${
                    oh === "red" ? "border-red-500/30" : oh === "yellow" ? "border-yellow-500/25" : "border-gray-800"
                  }`}
                >
                  {/* Row header */}
                  <div className="px-5 py-4 flex items-center gap-4">
                    {/* Overall health dot */}
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${HEALTH_DOT[oh]}`} />

                    {/* Name */}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{c.name}</p>
                      {c.company && <p className="text-xs text-gray-500 truncate">{c.company}</p>}
                    </div>

                    {/* Edit link */}
                    <button
                      onClick={() => router.push(`/boh/customers/${c.id}`)}
                      className="shrink-0 text-xs text-gray-500 hover:text-indigo-400 transition-colors"
                    >
                      Edit →
                    </button>
                  </div>

                  {/* Health panels */}
                  <div className="grid grid-cols-1 md:grid-cols-2 border-t border-gray-800 divide-y md:divide-y-0 md:divide-x divide-gray-800">

                    {/* ── Task Health ── */}
                    <div className="px-5 py-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Zap className={`w-3.5 h-3.5 ${th === "red" ? "text-red-400" : th === "yellow" ? "text-yellow-400" : th === "green" ? "text-emerald-400" : "text-gray-600"}`} />
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Task Health</span>
                        {th !== "none" && (
                          <span className={`ml-auto text-xs font-semibold ${th === "red" ? "text-red-400" : th === "yellow" ? "text-yellow-400" : "text-emerald-400"}`}>
                            {th === "red" ? "Errors" : th === "yellow" ? "Active / Warnings" : "OK"}
                          </span>
                        )}
                      </div>

                      {tg.total === 0 ? (
                        <p className="text-xs text-gray-600 flex items-center gap-1.5">
                          <MinusCircle className="w-3.5 h-3.5" />
                          No tasks assigned
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            <Chip count={tg.active}    label="active"    color="bg-sky-500/15 text-sky-400 border border-sky-500/25" />
                            <Chip count={tg.waiting}   label="waiting"   color="bg-gray-500/15 text-gray-400 border border-gray-500/25" />
                            <Chip count={tg.completed} label="completed" color="bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" />
                            <Chip count={tg.errors}    label="errors"    color="bg-red-500/15 text-red-400 border border-red-500/25" />
                            <Chip count={tg.warnings}  label="warnings"  color="bg-yellow-500/15 text-yellow-400 border border-yellow-500/25" />
                            <Chip count={tg.cancelled} label="cancelled" color="bg-gray-700/50 text-gray-500 border border-gray-700" />
                          </div>
                          <p className="text-xs text-gray-600">
                            {tg.total} task{tg.total !== 1 ? "s" : ""} · Last run: {formatRelative(tg.lastRun)}
                          </p>
                        </>
                      )}
                    </div>

                    {/* ── Payment Health ── */}
                    <div className="px-5 py-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <CreditCard className={`w-3.5 h-3.5 ${ph === "red" ? "text-red-400" : ph === "yellow" ? "text-yellow-400" : ph === "green" ? "text-emerald-400" : "text-gray-600"}`} />
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Payment Health</span>
                        <span className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-semibold ${payMeta.bg} ${payMeta.color}`}>
                          {payMeta.icon}
                          {payMeta.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                        {c.card_last4 ? (
                          <span className="flex items-center gap-1">
                            <CreditCard className="w-3 h-3" />
                            {c.card_type ?? "Card"} ···{c.card_last4}
                            {c.card_expiry_month && c.card_expiry_year && (
                              <span className="text-gray-600"> exp {String(c.card_expiry_month).padStart(2, "0")}/{String(c.card_expiry_year).slice(-2)}</span>
                            )}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-gray-600">
                            <AlertCircle className="w-3 h-3" />
                            No card on file
                          </span>
                        )}

                        <span className="flex items-center gap-1">
                          <Key className="w-3 h-3" />
                          {activeLicenses.length} active license{activeLicenses.length !== 1 ? "s" : ""}
                        </span>

                        {soonestDays !== null && (
                          <span className={`flex items-center gap-1 ${soonestDays < 0 ? "text-red-400" : soonestDays <= (c.alert_days_before ?? 30) ? "text-yellow-400" : "text-gray-500"}`}>
                            <Clock className="w-3 h-3" />
                            {soonestDays < 0
                              ? "License expired"
                              : soonestDays === 0
                              ? "Expires today"
                              : `Expires in ${soonestDays}d`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Unassigned tasks row */}
            {unassignedGroup.total > 0 && (
              <div className="bg-gray-900/50 border border-dashed border-gray-700 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 flex items-center gap-4">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-gray-600" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-400">Unassigned</p>
                    <p className="text-xs text-gray-600">Tasks with no customer</p>
                  </div>
                </div>
                <div className="px-5 pb-4 border-t border-gray-800 pt-3 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Chip count={unassignedGroup.active}    label="active"    color="bg-sky-500/15 text-sky-400 border border-sky-500/25" />
                    <Chip count={unassignedGroup.waiting}   label="waiting"   color="bg-gray-500/15 text-gray-400 border border-gray-500/25" />
                    <Chip count={unassignedGroup.completed} label="completed" color="bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" />
                    <Chip count={unassignedGroup.errors}    label="errors"    color="bg-red-500/15 text-red-400 border border-red-500/25" />
                    <Chip count={unassignedGroup.warnings}  label="warnings"  color="bg-yellow-500/15 text-yellow-400 border border-yellow-500/25" />
                    <Chip count={unassignedGroup.cancelled} label="cancelled" color="bg-gray-700/50 text-gray-500 border border-gray-700" />
                  </div>
                  <p className="text-xs text-gray-600">
                    {unassignedGroup.total} task{unassignedGroup.total !== 1 ? "s" : ""} · Last run: {formatRelative(unassignedGroup.lastRun)}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
