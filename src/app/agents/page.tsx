import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getActiveRoleAssignment } from "@/lib/permissions";
import AgentsClient from "@/components/AgentsClient";

export default async function AgentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assignment = await getActiveRoleAssignment(user.id);
  if (assignment?.role !== "administrator") redirect("/scheduler");

  // Fetch agents with their customer name
  const { data: agents } = await supabase
    .from("agents")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });

  // Fetch customers for the token generation dropdown
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .order("name");

  return (
    <AgentsClient
      agents={agents ?? []}
      customers={customers ?? []}
    />
  );
}
