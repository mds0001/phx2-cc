import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import UserEditorClient from "@/components/UserEditorClient";

export default async function NewUserPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (me?.role !== "administrator") redirect("/dashboard");

  return (
    <UserEditorClient
      user={null}
      isNew={true}
      currentUserId={user.id}
    />
  );
}
