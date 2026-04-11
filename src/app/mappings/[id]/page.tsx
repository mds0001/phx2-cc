import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import MappingEditorClient from "@/components/MappingEditorClient";

export default async function MappingEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

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
    />
  );
}
