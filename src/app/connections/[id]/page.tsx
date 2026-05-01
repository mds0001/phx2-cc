import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ConnectionEditorClient from "@/components/ConnectionEditorClient";
import { isReadOnly, getActiveRoleAssignment } from "@/lib/permissions";
import type { ConnectionType } from "@/lib/types";

export const dynamic = 'force-dynamic';

// Credential fields to clear when cloning a system template
const CREDENTIAL_FIELDS: Partial<Record<ConnectionType, string[]>> = {
  cloud:          ["customer_id", "customer_secret"],
  smtp:           ["login_name", "password"],
  odbc:           ["login_name", "password"],
  portal:         ["url", "login_name", "password"],
  ivanti:         ["url", "api_key"],
  ivanti_neurons: ["auth_url", "client_id", "client_secret", "base_url"],
  dell:           ["client_id", "client_secret", "forwarded_client_id", "premier_account_id"],
  cdw:            ["subscription_key", "account_number"],
  azure:          ["client_id", "client_secret", "tenant_id"],
  // file: no credentials — template structure is the value
};

export default async function ConnectionEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; returnTo?: string }>;
}) {
  const { id } = await params;
  const { from, returnTo } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assignment = await getActiveRoleAssignment(user.id);
  const role = assignment?.role;
  if (role === "basic") redirect("/account");
  const readOnly = isReadOnly(role);
  const isAdmin = role === "administrator";

  // Auditors cannot create new connections
  if (readOnly && id === "new") redirect("/connections");

  const isNew = id === "new";
  let connection = null;

  const [connectionResult, customersResult, agentsResult] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : supabase
      .from("endpoint_connections")
      .select("*")
      .eq("id", id)
      .single(),
    isAdmin
      ? supabase.from("customers").select("id, name, company").order("name")
      : Promise.resolve({ data: [] }),
    supabase.from("agents").select("id, name, status, customer_id").order("name"),
  ]);

  if (!isNew) {
    if (!connectionResult.data) redirect("/connections");
    connection = connectionResult.data;
  }

  // "Use as Template" clone: fetch template and clear credential fields
  if (isNew && from) {
    const { data: template } = await supabase
      .from("endpoint_connections")
      .select("*")
      .eq("id", from)
      .single();

    if (template) {
      const credFields = CREDENTIAL_FIELDS[template.type as ConnectionType] ?? [];
      const clearedConfig = { ...(template.config as Record<string, unknown>) };
      for (const field of credFields) clearedConfig[field] = "";
      connection = {
        ...template,
        id: "",
        name: `${template.name} (copy)`,
        is_system: false,
        customer_id: null,
        config: clearedConfig,
      };
    }
  }

  return (
    <ConnectionEditorClient
      connection={connection}
      isNew={isNew}
      userId={user.id}
      isReadOnly={readOnly}
      isAdmin={isAdmin}
      customers={customersResult.data ?? []}
      agents={(agentsResult.data ?? []).map((a: { id: string; name: string; status: string; customer_id: string }) => ({ id: a.id, name: a.name, status: a.status, customer_id: a.customer_id }))}
      scopedCustomerId={role === "schedule_administrator" ? (assignment?.customer_id ?? null) : null}
      returnTo={returnTo ?? null}
    />
  );
}
