import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getActiveRoleAssignment } from "@/lib/permissions";
import LeadsListClient from "@/components/LeadsListClient";

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assignment = await getActiveRoleAssignment(user.id);
  if (assignment?.role !== "administrator") redirect("/dashboard");

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .order("updated_at", { ascending: false });

  return <LeadsListClient leads={leads ?? []} userId={user.id} />;
}
