import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import MappingsListClient from "@/components/MappingsListClient";
import { isReadOnly, isAuditor, getActiveRoleAssignment } from "@/lib/permissions";
import { resolveCustomerFilter } from "@/lib/customer-context";

export const dynamic = 'force-dynamic';

export default async function MappingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assignment = await getActiveRoleAssignment(user.id);
  const role = assignment?.role;
  if (isAuditor(role)) redirect("/scheduler");
  if (role === "basic") redirect("/account");
  const isAdmin = role === "administrator";
  const activeCustomerId = await resolveCustomerFilter(assignment);

  const { data: customers } = await supabase.from("customers").select("id, name, company").order("name");

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
