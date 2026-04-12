import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
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
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "administrator") redirect("/dashboard");

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

  return (
    <CustomerEditorClient
      customer={customer}
      licenses={licenses}
      isNew={isNew}
      userId={user.id}
    />
  );
}
