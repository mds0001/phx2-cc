import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ConnectionEditorClient from "@/components/ConnectionEditorClient";
import { isReadOnly } from "@/lib/permissions";

export default async function ConnectionEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: userProfile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const readOnly = isReadOnly(userProfile?.role);

  // Basic users cannot create new connections
  if (readOnly && id === "new") redirect("/connections");

  const isNew = id === "new";
  let connection = null;

  if (!isNew) {
    const { data } = await supabase
      .from("endpoint_connections")
      .select("*")
      .eq("id", id)
      .single();
    if (!data) redirect("/connections");
    connection = data;
  }

  return (
    <ConnectionEditorClient
      connection={connection}
      isNew={isNew}
      userId={user.id}
      isReadOnly={readOnly}
    />
  );
}
