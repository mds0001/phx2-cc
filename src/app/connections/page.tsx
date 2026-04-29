import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ConnectionsListClient from "@/components/ConnectionsListClient";
import { isReadOnly, isAuditor } from "@/lib/permissions";
import { resolveCustomerFilter } from "@/lib/customer-context";

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, customer_id").eq("id", user.id).single();

  const role = profile?.role;
  if (isAuditor(role)) redirect("/scheduler");
  const isAdmin = role === "administrator";
  const activeCustomerId = await resolveCustomerFilter(role, profile?.customer_id);

  const { data: customers } = role !== "basic"
    ? await supabase.from("customers").select("id, name, company").order("name")
    : { data: [] };

  let query = supabase
    .from("endpoint_connections")
    .select("*")
    .order("updated_at", { ascending: false });
  // Scoped users see their customer's records + all system records
  if (activeCustomerId) query = query.or(`customer_id.eq.${activeCustomerId},is_system.eq.true`);

  const { data: connections } = await query;

  return (
    <ConnectionsListClient
      connections={connections ?? []}
      isReadOnly={isReadOnly(role)}
      isAdmin={isAdmin}
      customers={customers ?? []}
      activeCustomerId={activeCustomerId}
    />
  );
}
