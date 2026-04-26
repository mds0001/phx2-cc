import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import OpportunitiesListClient from "@/components/OpportunitiesListClient";

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
    .eq("status", "qualified")
    .order("name");

  return (
    <OpportunitiesListClient
      opportunities={opportunities ?? []}
      leads={leads ?? []}
      userId={user.id}
    />
  );
}
