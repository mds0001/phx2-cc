import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import SchedulerClient from "@/components/SchedulerClient";
import { isReadOnly } from "@/lib/permissions";

export default async function SchedulerPage() {
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
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <Suspense>
      <SchedulerClient
        profile={profile}
        initialTasks={tasks ?? []}
        userId={user.id}
        isReadOnly={isReadOnly((profile as { role?: string } | null)?.role)}
      />
    </Suspense>
  );
}
