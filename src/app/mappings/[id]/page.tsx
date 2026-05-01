import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import MappingEditorClient from "@/components/MappingEditorClient";
import { isReadOnly, getActiveRoleAssignment } from "@/lib/permissions";

export const dynamic = 'force-dynamic';

export default async function MappingEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const assignment = await getActiveRoleAssignment(user.id);
  const role = assignment?.role;
  if (role === "basic") redirect("/account");
  const readOnly = isReadOnly(role);
  const isAdmin = role === "administrator";

  // Auditors cannot create new mapping profiles
  if (readOnly && id === "new") redirect("/mappings");

  const [profileResult, customersResult] = await Promise.all([
    id !== "new"
      ? supabase.from("mapping_profiles").select("*").eq("id", id).single()
      : Promise.resolve({ data: null }),
    isAdmin
      ? supabase.from("customers").select("id, name, company").order("name")
      : Promise.resolve({ data: [] }),
  ]);

  let profile = null;
  if (id !== "new") {
    if (!profileResult.data) redirect("/mappings");
    profile = profileResult.data;
  }

  return (
    <MappingEditorClient
      profile={profile}
      isNew={id === "new"}
      userId={user.id}
      returnTo={typeof sp.returnTo === "string" ? sp.returnTo : null}
      returnMode={typeof sp.returnMode === "string" ? sp.returnMode : null}
      returnTaskId={typeof sp.returnTaskId === "string" ? sp.returnTaskId : null}
      isReadOnly={readOnly}
      isAdmin={isAdmin}
      customers={customersResult.data ?? []}
      scopedCustomerId={role === "schedule_administrator" ? (assignment?.customer_id ?? null) : null}
    />
  );
}
