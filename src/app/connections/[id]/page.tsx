import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ConnectionEditorClient from "@/components/ConnectionEditorClient";

export default async function ConnectionEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
    />
  );
}
