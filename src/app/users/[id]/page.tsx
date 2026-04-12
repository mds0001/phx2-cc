import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import UserEditorClient from "@/components/UserEditorClient";
import type { Profile } from "@/lib/types";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (me?.role !== "administrator") redirect("/dashboard");

  const { data: target } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .single();

  if (!target) redirect("/users");

  return (
    <UserEditorClient
      user={target as Profile}
      isNew={false}
      currentUserId={user.id}
    />
  );
}
