import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getActiveRoleAssignment } from "@/lib/permissions";
import CustomerEditorClient from "@/components/CustomerEditorClient";

export default async function CustomerEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only Administrators can access Back of House
  const assignment = await getActiveRoleAssignment(user.id);
  if (assignment?.role !== "administrator") redirect("/dashboard");

  const isNew = id === "new";
  let customer = null;
  let licenses = [];

  if (!isNew) {
    const { data: c } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .single();
    if (!c) redirect("/boh/customers");
    customer = c;

    const { data: l } = await supabase
      .from("customer_licenses")
      .select("*")
      .eq("customer_id", id)
      .order("expiry_date", { ascending: true });
    licenses = l ?? [];
  }

  // Fetch all license types for the picker
  const { data: licenseTypes } = await supabase
    .from("license_types")
    .select("*")
    .order("name");

  return (
    <CustomerEditorClient
      customer={customer}
      licenses={licenses}
      licenseTypes={licenseTypes ?? []}
      isNew={isNew}
      userId={user.id}
    />
  );
}
