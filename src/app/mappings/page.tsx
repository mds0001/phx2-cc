import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import MappingsListClient from "@/components/MappingsListClient";
import { isReadOnly, isAuditor } from "@/lib/permissions";
import { resolveCustomerFilter } from "@/lib/customer-context";

export const dynamic = 'force-dynamic';

export default async function MappingsPage() {
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
    .from("mapping_profiles")
    .select("id, name, description, created_at, updated_at, source_fields, target_fields, mappings, created_by, customer_id, is_system")
    .order("updated_at", { ascending: false });
  // Scoped users see their customer's records + all system records
  if (activeCustomerId) query = query.or(`customer_id.eq.${activeCustomerId},is_system.eq.true`);

  const { data: profiles } = await query;

  return (
    <MappingsListClient
      profiles={profiles ?? []}
      isReadOnly={isReadOnly(role)}
      isAdmin={isAdmin}
      customers={customers ?? []}
      activeCustomerId={activeCustomerId}
    />
  );
}
