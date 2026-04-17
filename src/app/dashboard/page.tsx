import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import DashboardClient from "@/components/DashboardClient";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: tasks } = await supabase
    .from("scheduled_tasks")
    .select("status");

  const role = (profile as { role?: string } | null)?.role ?? "schedule_administrator";
  const isAdmin = role === "administrator";
  const isBasic = role === "basic";

  // BOH attention: only admins have access to the customers table
  const { data: customers } = isAdmin
    ? await supabase
        .from("customers")
        .select("payment_status, alert_days_before, customer_licenses(status, expiry_date, renewal_type)")
    : { data: [] };

  let bohAttention = 0;
  const today = Date.now();
  for (const c of customers ?? []) {
    let flag = false;
    if (c.payment_status === "failed" || c.payment_status === "lapsed") flag = true;
    if (!flag) {
      const threshold = (c.alert_days_before ?? 30) * 86_400_000;
      for (const lic of (c.customer_licenses ?? [])) {
        if (!lic.expiry_date || lic.status === "expired" || lic.status === "cancelled") continue;
        const msLeft = new Date(lic.expiry_date).getTime() - today;
        if (msLeft <= threshold) { flag = true; break; }
        if (lic.renewal_type === "manual" && msLeft <= 60 * 86_400_000) { flag = true; break; }
      }
    }
    if (flag) bohAttention++;
  }

  const COMPLETED = ["completed", "completed_with_errors", "completed_with_warnings"];
  const counts = {
    active: tasks?.filter((t) => t.status === "active").length ?? 0,
    waiting: tasks?.filter((t) => t.status === "waiting").length ?? 0,
    completed: tasks?.filter((t) => COMPLETED.includes(t.status)).length ?? 0,
    completedWithErrors: tasks?.filter((t) => t.status === "completed_with_errors").length ?? 0,
    completedWithWarnings: tasks?.filter((t) => t.status === "completed_with_warnings").length ?? 0,
    cancelled: tasks?.filter((t) => t.status === "cancelled").length ?? 0,
    total: tasks?.length ?? 0,
    bohAttention,
  };

  // Fetch the 10 most recent SUMMARY log entries so the dashboard can show "Recent Runs"
  // Skip for basic users — they only see the summary counts
  const { data: recentSummaryLogs } = isBasic
    ? { data: [] }
    : await supabase
        .from("task_logs")
        .select("id, task_id, details, created_at, scheduled_tasks(task_name, status)")
        .eq("action", "SUMMARY")
        .order("created_at", { ascending: false })
        .limit(10);

  return (
    <DashboardClient
      profile={profile}
      initialCounts={counts}
      role={role as import("@/lib/types").UserRole}
      initialRecentRuns={(recentSummaryLogs ?? []) as unknown as import("@/components/DashboardClient").RecentRun[]}
    />
  );
}
