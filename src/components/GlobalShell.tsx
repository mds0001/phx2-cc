"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import {
  CalendarClock, GitMerge, Plug, Building2, Users,
  FileText, BarChart3, Activity, ShieldCheck, LogOut, Bot, Tag,
  TrendingUp, UserPlus, Sun, Moon, Contrast,
} from "lucide-react";

// Types
interface Counts {
  active: number;
  waiting: number;
  completed: number;
  completedWithWarnings: number;
  completedWithErrors: number;
  cancelled: number;
  total: number;
}

const HIDDEN_PATHS = ["/login"];
const EMPTY_COUNTS: Counts = {
  active: 0, waiting: 0, completed: 0,
  completedWithWarnings: 0, completedWithErrors: 0,
  cancelled: 0, total: 0,
};

// Nav Item
function NavItem({
  icon, label, href, active, badge,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active: boolean;
  badge?: number;
}) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left transition-all ${
        active
          ? "bg-indigo-600/20 text-indigo-300"
          : "text-gray-500 hover:text-gray-200 hover:bg-gray-800/60"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-indigo-400" : "text-gray-600"}`}>
        {icon}
      </span>
      <span className="text-[15.5px] font-medium flex-1">{label}</span>
      {badge && badge > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 border border-red-500/30 text-red-400">
          {badge}
        </span>
      )}
    </button>
  );
}

// Section Header
function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pt-1 pb-0.5">
      <span className="text-[12.5px] font-semibold text-gray-700 uppercase tracking-widest">
        {label}
      </span>
    </div>
  );
}

// Component
const POLL_KEY     = "phx2_poll_interval";
const DEFAULT_POLL = 30;

export default function GlobalShell() {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);

  const THEMES = ["dark", "light", "high-contrast"] as const;
  const THEME_META = {
    dark:            { label: "Dark",          icon: <Moon className="w-3.5 h-3.5" /> },
    light:           { label: "Office",        icon: <Sun className="w-3.5 h-3.5" /> },
    "high-contrast": { label: "High Contrast", icon: <Contrast className="w-3.5 h-3.5" /> },
  } as const;
  function cycleTheme() {
    const idx = THEMES.indexOf((theme ?? "dark") as typeof THEMES[number]);
    setTheme(THEMES[(idx + 1) % THEMES.length]);
  }

  const [counts,    setCounts]    = useState<Counts>(EMPTY_COUNTS);
  const [bohAlerts, setBohAlerts] = useState(0);
  const [skuPending, setSkuPending] = useState(0);
  const [skuTweCount, setSkuTweCount] = useState(0);
  const [nonTemplateTasks, setNonTemplateTasks] = useState(0);
  const [pipelineActive, setPipelineActive] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  const hidden = HIDDEN_PATHS.some((p) => pathname?.startsWith(p));

  useEffect(() => {
    setThemeMounted(true);
    if (hidden) return;

    function refreshCounts(rows: { status: string }[]) {
      setCounts({
        active:                rows.filter((t) => t.status === "active").length,
        waiting:               rows.filter((t) => t.status === "waiting").length,
        completed:             rows.filter((t) => ["completed", "completed_with_errors", "completed_with_warnings"].includes(t.status)).length,
        completedWithWarnings: rows.filter((t) => t.status === "completed_with_warnings").length,
        completedWithErrors:   rows.filter((t) => t.status === "completed_with_errors").length,
        cancelled:             rows.filter((t) => t.status === "cancelled").length,
        total:                 rows.length,
      });
    }

    function fetchAll() {
      supabase.from("scheduled_tasks").select("status").neq("is_system", true).then(({ data }) => {
        if (data) { refreshCounts(data); setNonTemplateTasks(data.length); }
      });
      supabase.from("customer_licenses").select("id, status")
        .in("status", ["expired", "expiring_soon", "payment_failed"])
        .then(({ data }) => { if (data) setBohAlerts(data.length); });
      supabase.from("sku_research_queue").select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .then(({ count }) => { if (count != null) setSkuPending(count); });
      supabase.from("sku_run_exceptions").select("id", { count: "exact", head: true })
        .neq("archived", true)
        .then(({ count }) => { if (count != null) setSkuTweCount(count); });
      supabase.from("opportunities").select("id", { count: "exact", head: true })
        .eq("status", "active")
        .then(({ count }) => { if (count != null) setPipelineActive(count ?? 0); });
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        supabase.from("profiles").select("role").eq("id", user.id).single()
          .then(({ data }) => { if (data?.role === "administrator") setIsAdmin(true); });
      });
    }

    const stored = typeof window !== "undefined" ? localStorage.getItem(POLL_KEY) : null;
    const pollMs  = (stored ? (parseInt(stored, 10) || DEFAULT_POLL) : DEFAULT_POLL) * 1000;
    fetchAll();
    const interval = setInterval(fetchAll, pollMs);

    return () => { clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  if (hidden) return null;

  const schedulerBadge = nonTemplateTasks;

  const statsRow = [
    { label: "Active",    value: counts.active,                                                                color: "text-emerald-400" },
    { label: "Waiting",   value: counts.waiting,                                                               color: "text-yellow-400"  },
    { label: "Done",      value: counts.completed - counts.completedWithErrors - counts.completedWithWarnings, color: "text-blue-400"    },
    { label: "Warnings",  value: counts.completedWithWarnings,                                                 color: "text-orange-400"  },
    { label: "Errors",    value: counts.completedWithErrors,                                                   color: "text-red-400"     },
    { label: "Cancelled", value: counts.cancelled,                                                             color: "text-gray-500"    },
    { label: "Total",     value: counts.total,                                                                 color: "text-violet-400"  },
  ];

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
      {/* Left Pane */}
      <div className="fixed left-0 top-0 bottom-[44px] w-[220px] bg-gray-900 border-r border-gray-800 z-30 flex flex-col overflow-hidden select-none">

        {/* Brand */}
        <div className="px-4 py-4 border-b border-gray-800 shrink-0">
          <a href="https://www.cloudweavr.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-[36px] h-[36px] rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
              <Activity className="w-[20px] h-[20px] text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[21px] font-semibold text-gray-100 leading-tight">Threads</div>
              <div className="text-[16px] text-gray-600 leading-tight">by Cloud Weaver</div>
            </div>
          </a>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-3">

          {/* AUTOMATION */}
          <div className="flex flex-col gap-0.5">
            <SectionHeader label="Automation" />
            <NavItem
              icon={<CalendarClock className="w-4 h-4" />}
              label="Scheduler"
              href="/scheduler"
              active={pathname?.startsWith("/scheduler") === true}
              badge={schedulerBadge}
            />
            <NavItem
              icon={<GitMerge className="w-4 h-4" />}
              label="Mappings"
              href="/mappings"
              active={pathname?.startsWith("/mappings") === true}
            />
            <NavItem
              icon={<Plug className="w-4 h-4" />}
              label="Endpoints"
              href="/connections"
              active={pathname?.startsWith("/connections") === true}
            />
          </div>

          {/* PIPELINE - admin only */}
          {isAdmin && (
          <div className="flex flex-col gap-0.5">
            <SectionHeader label="Pipeline" />
            <NavItem
              icon={<UserPlus className="w-4 h-4" />}
              label="Leads"
              href="/boh/leads"
              active={pathname?.startsWith("/boh/leads") === true}
            />
            <NavItem
              icon={<TrendingUp className="w-4 h-4" />}
              label="Opportunities"
              href="/boh/opportunities"
              active={pathname?.startsWith("/boh/opportunities") === true}
              badge={pipelineActive > 0 ? pipelineActive : undefined}
            />
          </div>
          )}

          {/* MANAGEMENT - admin only */}
          {isAdmin && (
          <div className="flex flex-col gap-0.5">
            <SectionHeader label="Management" />
            <NavItem
              icon={<Building2 className="w-4 h-4" />}
              label="Customers"
              href="/boh/customers"
              active={pathname?.startsWith("/boh/customers") === true}
              badge={bohAlerts > 0 ? bohAlerts : undefined}
            />
            <NavItem
              icon={<FileText className="w-4 h-4" />}
              label="License Types"
              href="/boh/license-types"
              active={pathname?.startsWith("/boh/license-types") === true}
            />
            <NavItem
              icon={<ShieldCheck className="w-4 h-4" />}
              label="Health"
              href="/boh/health"
              active={pathname?.startsWith("/boh/health") === true}
            />
            <NavItem
              icon={<Tag className="w-4 h-4" />}
              label="SKU Research"
              href="/boh/sku-research"
              active={pathname?.startsWith("/boh/sku-research") === true}
              badge={skuTweCount > 0 ? skuTweCount : undefined}
            />
          </div>
          )}

          {/* ADMIN - admin only */}
          {isAdmin && (
          <div className="flex flex-col gap-0.5">
            <SectionHeader label="Admin" />
            <NavItem
              icon={<Users className="w-4 h-4" />}
              label="Users"
              href="/users"
              active={pathname?.startsWith("/users") === true}
            />
            <NavItem
              icon={<Bot className="w-4 h-4" />}
              label="Agents"
              href="/agents"
              active={pathname?.startsWith("/agents") === true}
            />
          </div>
          )}

        </nav>

        {/* Account / Security */}
        <div className="shrink-0 border-t border-gray-800 px-2 pt-2">
          <NavItem
            icon={<ShieldCheck className="w-4 h-4 shrink-0" />}
            label="Security"
            href="/account"
            active={pathname === "/account"}
          />
        </div>

        {/* Sign out */}
        <div className="shrink-0 border-t border-gray-800 px-2 py-2">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left text-gray-600 hover:text-red-400 hover:bg-gray-800/60 transition-all group"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="text-[15.5px] font-medium">Sign out</span>
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-[220px] right-0 h-[44px] bg-gray-900 border-t border-gray-800 z-30 flex items-center px-5 gap-1">
        {statsRow.map((s, i) => (
          <div key={s.label} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-800 text-xs mx-1">&middot;</span>}
            <span className={`text-sm font-bold tabular-nums ${s.color}`}>{s.value}</span>
            <span className="text-[11px] text-gray-600 ml-0.5">{s.label}</span>
          </div>
               ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={cycleTheme}
            title={themeMounted ? `Theme: ${THEME_META[(theme ?? "dark") as keyof typeof THEME_META]?.label ?? "Dark"} — click to switch` : "Theme"}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all text-[11px] font-medium"
          >
            {themeMounted ? THEME_META[(theme ?? "dark") as keyof typeof THEME_META]?.icon : <Moon className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{themeMounted ? THEME_META[(theme ?? "dark") as keyof typeof THEME_META]?.label : "Dark"}</span>
          </button>
          <span className="text-gray-800 text-xs">&middot;</span>
          <BarChart3 className="w-3 h-3 text-gray-700" />
          <span className="text-[10px] text-gray-700">task stats</span>
        </div>
      </div>
    </>
  );
}
