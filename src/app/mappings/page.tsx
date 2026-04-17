import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import MappingsListClient from "@/components/MappingsListClient";
import { isReadOnly } from "@/lib/permissions";

export default async function MappingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  const { data: profiles } = await supabase
    .from("mapping_profiles")
    .select("id, name, description, created_at, updated_at, source_fields, target_fields, mappings, created_by")
    .order("updated_at", { ascending: false });

  return <MappingsListClient profiles={profiles ?? []} isReadOnly={isReadOnly(profile?.role)} />;
}
