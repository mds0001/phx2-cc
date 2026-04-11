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

  const counts = {
    active: tasks?.filter((t) => t.status === "active").length ?? 0,
    waiting: tasks?.filter((t) => t.status === "waiting").length ?? 0,
    completed: tasks?.filter((t) => t.status === "completed").length ?? 0,
    total: tasks?.length ?? 0,
  };

  return <DashboardClient profile={profile} initialCounts={counts} />;
}
