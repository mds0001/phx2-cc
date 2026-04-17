import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import HealthDashboardClient from "@/components/HealthDashboardClient";

export const dynamic = 'force-dynamic';

export default async function HealthDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "administrator") redirect("/dashboard");

  const [customersResult, tasksResult, logsResult] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, company, email, payment_status, card_type, card_last4, card_expiry_month, card_expiry_year, alert_days_before, customer_licenses(id, status, expiry_date, renewal_type)")
      .order("name"),
    supabase
      .from("scheduled_tasks")
      .select("id, customer_id, status, updated_at"),
    // Most recent SUMMARY log per task — gives us "last run" time
    supabase
      .from("task_logs")
      .select("task_id, created_at")
      .eq("action", "SUMMARY")
      .order("created_at", { ascending: false }),
  ]);

  // Build a map of task_id -> most recent run time
  const lastRunByTask: Record<string, string> = {};
  for (const log of logsResult.data ?? []) {
    if (!lastRunByTask[log.task_id]) {
      lastRunByTask[log.task_id] = log.created_at;
    }
  }

  return (
    <HealthDashboardClient
      customers={customersResult.data ?? []}
      tasks={tasksResult.data ?? []}
      lastRunByTask={lastRunByTask}
    />
  );
}
