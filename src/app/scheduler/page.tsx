import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import SchedulerClient from "@/components/SchedulerClient";
import { isReadOnly, isAuditor } from "@/lib/permissions";
import { resolveCustomerFilter } from "@/lib/customer-context";

export const dynamic = 'force-dynamic';

export default async function SchedulerPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  // Fetch customers for the switcher (non-basic users only)
  const role = (profile as { role?: string } | null)?.role;
  const isAdmin    = role === "administrator";
  const auditor    = isAuditor(role);
  const activeCustomerId = await resolveCustomerFilter(role, (profile as { customer_id?: string | null } | null)?.customer_id);
  const { data: customers } = role !== "basic"
    ? await supabase.from("customers").select("id, name, company").order("name")
    : { data: [] };

  // Fetch tasks scoped to active customer (or all if none selected).
  // System tasks are always included regardless of customer filter.
  let tasksQuery = supabase.from("scheduled_tasks").select("*").order("created_at", { ascending: false });
  if (activeCustomerId) tasksQuery = tasksQuery.or(`customer_id.eq.${activeCustomerId},is_system.eq.true`);

  const { data: tasks } = await tasksQuery;

  return (
    <Suspense>
      <SchedulerClient
        profile={profile}
        initialTasks={tasks ?? []}
        userId={user.id}
        isReadOnly={isReadOnly(role)}
        isAdmin={isAdmin}
        isAuditor={auditor}
        customers={customers ?? []}
        activeCustomerId={activeCustomerId}
      />
    </Suspense>
  );
}
