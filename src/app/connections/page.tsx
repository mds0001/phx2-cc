import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ConnectionsListClient from "@/components/ConnectionsListClient";

export default async function ConnectionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: connections } = await supabase
    .from("endpoint_connections")
    .select("*")
    .order("updated_at", { ascending: false });

  return <ConnectionsListClient connections={connections ?? []} />;
}
