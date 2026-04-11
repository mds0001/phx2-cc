import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import SchedulerClient from "@/components/SchedulerClient";

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
    <SchedulerClient
      profile={profile}
      initialTasks={tasks ?? []}
      userId={user.id}
    />
  );
}
