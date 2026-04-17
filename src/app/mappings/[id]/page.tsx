import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import MappingEditorClient from "@/components/MappingEditorClient";
import { isReadOnly } from "@/lib/permissions";

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

  const { data: userProfile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const readOnly = isReadOnly(userProfile?.role);

  // Basic users cannot create new mapping profiles
  if (readOnly && id === "new") redirect("/mappings");

  let profile = null;
  if (id !== "new") {
    const { data } = await supabase
      .from("mapping_profiles")
      .select("*")
      .eq("id", id)
      .single();
    if (!data) redirect("/mappings");
    profile = data;
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
    />
  );
}
