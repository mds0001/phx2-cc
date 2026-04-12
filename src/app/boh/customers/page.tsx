import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import CustomersListClient from "@/components/CustomersListClient";

export default async function CustomersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only Administrators can access Back of House
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "administrator") redirect("/dashboard");

  // Fetch customers with a count of their licenses
  const { data: customers } = await supabase
    .from("customers")
    .select("*, customer_licenses(id, status, expiry_date, renewal_type)")
    .order("updated_at", { ascending: false });

  return <CustomersListClient customers={customers ?? []} />;
}
