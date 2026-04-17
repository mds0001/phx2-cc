import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import MappingsListClient from "@/components/MappingsListClient";
import { isReadOnly } from "@/lib/permissions";
import { resolveCustomerFilter } from "@/lib/customer-context";

export const dynamic = 'force-dynamic';

export default async function MappingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, customer_id").eq("id", user.id).single();
  const role = profile?.role;
  const activeCustomerId = await resolveCustomerFilter(role, profile?.customer_id);

  const role = profile?.role;
  const { data: customers } = role !== "basic"
    ? await supabase.from("customers").select("id, name, company").order("name")
    : { data: [] };

  let query = supabase
    .from("mapping_profiles")
    .select("id, name, description, created_at, updated_at, source_fields, target_fields, mappings, created_by, customer_id")
    .order("updated_at", { ascending: false });
  if (activeCustomerId) query = query.eq("customer_id", activeCustomerId);

  const { data: profiles } = await query;

  return (
    <MappingsListClient
      profiles={profiles ?? []}
      isReadOnly={isReadOnly(role)}
      customers={customers ?? []}
      activeCustomerId={activeCustomerId}
    />
  );
}
