import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ConnectionsListClient from "@/components/ConnectionsListClient";
import { isReadOnly } from "@/lib/permissions";

export default async function ConnectionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  const { data: connections } = await supabase
    .from("endpoint_connections")
    .select("*")
    .order("updated_at", { ascending: false });

  return <ConnectionsListClient connections={connections ?? []} isReadOnly={isReadOnly(profile?.role)} />;
}
