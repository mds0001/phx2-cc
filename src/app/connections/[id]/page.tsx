import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ConnectionEditorClient from "@/components/ConnectionEditorClient";
import { isReadOnly } from "@/lib/permissions";
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
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
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
      scopedCustomerId={userProfile?.role === "schedule_administrator" ? (userProfile?.customer_id ?? null) : null}
    />
  );
}
