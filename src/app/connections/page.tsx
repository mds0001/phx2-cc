import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ConnectionsListClient from "@/components/ConnectionsListClient";
import { isReadOnly } from "@/lib/permissions";
import { resolveCustomerFilter } from "@/lib/customer-context";

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, customer_id").eq("id", user.id).single();

  const role = profile?.role;
  const { data: customers } = role !== "basic"
    ? await supabase.from("customers").select("id, name, company").order("name")
    : { data: [] };

  let query = supabase
    .from("endpoint_connections")
    .select("*")
    .order("updated_at", { ascending: false });
  if (activeCustomerId) query = query.eq("customer_id", activeCustomerId);

  const { data: connections } = await query;

  return (
    <ConnectionsListClient
      connections={connections ?? []}
      isReadOnly={isReadOnly(role)}
      customers={customers ?? []}
      activeCustomerId={activeCustomerId}
    />
  );
}
