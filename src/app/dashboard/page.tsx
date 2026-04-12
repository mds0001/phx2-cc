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

  // BOH attention: customers with payment issues or licenses expiring soon
  const { data: customers } = await supabase
    .from("customers")
    .select("payment_status, alert_days_before, customer_licenses(status, expiry_date, renewal_type)");

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

  const counts = {
    active: tasks?.filter((t) => t.status === "active").length ?? 0,
    waiting: tasks?.filter((t) => t.status === "waiting").length ?? 0,
    completed: tasks?.filter((t) => t.status === "completed").length ?? 0,
    total: tasks?.length ?? 0,
    bohAttention,
  };

  const role = (profile as { role?: string } | null)?.role ?? "schedule_administrator";

  return <DashboardClient profile={profile} initialCounts={counts} role={role as import("@/lib/types").UserRole} />;
}
