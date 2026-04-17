import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ConnectionEditorClient from "@/components/ConnectionEditorClient";
import { isReadOnly } from "@/lib/permissions";

export const dynamic = 'force-dynamic';

export default async function ConnectionEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: userProfile } = await supabase.from("profiles").select("role, customer_id").eq("id", user.id).single();
  const readOnly = isReadOnly(userProfile?.role);
  const isAdmin = userProfile?.role === "administrator";

  // Basic users cannot create new connections
  if (readOnly && id === "new") redirect("/connections");

  const isNew = id === "new";
  let connection = null;

  const [connectionResult, customersResult] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : supabase
      .from("endpoint_connections")
      .select("*")
      .eq("id", id)
      .single(),
    isAdmin
      ? supabase.from("customers").select("id, name, company").order("name")
      : Promise.resolve({ data: [] }),
  ]);

  if (!isNew) {
    if (!connectionResult.data) redirect("/connections");
    connection = connectionResult.data;
  }

  return (
    <ConnectionEditorClient
      connection={connection}
      isNew={isNew}
      userId={user.id}
      isReadOnly={readOnly}
      isAdmin={isAdmin}
      customers={customersResult.data ?? []}
      scopedCustomerId={userProfile?.role === "schedule_administrator" ? (userProfile?.customer_id ?? null) : null}
    />
  );
}
