import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import OpportunitiesListClient from "@/components/OpportunitiesListClient";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "administrator") redirect("/dashboard");

  const { data: opportunities } = await supabase
    .from("opportunities")
    .select("*, leads(name, email, company)")
    .order("updated_at", { ascending: false });

  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, email, company")
    .order("name");

  const admin = createAdminClient();
  const { data: licenseTypes, error: ltErr } = await admin
    .from("license_types")
    .select("*")
    .order("name");
  if (ltErr) console.error("[opportunities] licenseTypes fetch error:", ltErr.message);

  return (
    <OpportunitiesListClient
      opportunities={opportunities ?? []}
      leads={leads ?? []}
      licenseTypes={licenseTypes ?? []}
      userId={user.id}
    />
  );
}
