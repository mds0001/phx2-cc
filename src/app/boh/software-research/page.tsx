import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getActiveRoleAssignment } from "@/lib/permissions";
import SoftwareResearchClient from "@/components/SoftwareResearchClient";

export const dynamic = "force-dynamic";

export default async function SoftwareResearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assignment = await getActiveRoleAssignment(user.id);
  const role = assignment?.role ?? null;
  if (role !== "administrator" && role !== "schedule_administrator") redirect("/dashboard");

  const admin = createAdminClient();
  const [queueRes, sigRes, catRes] = await Promise.all([
    admin.from("software_research_queue").select("*")
      .order("status").order("device_count", { ascending: false }).order("seen_count", { ascending: false }),
    admin.from("software_signatures").select("*").order("created_at", { ascending: false }),
    admin.from("software_catalog").select("*").order("manufacturer").order("title"),
  ]);

  return (
    <SoftwareResearchClient
      initialQueue={queueRes.data ?? []}
      initialSignatures={sigRes.data ?? []}
      initialCatalog={catRes.data ?? []}
      isAdmin={role === "administrator"}
    />
  );
}
