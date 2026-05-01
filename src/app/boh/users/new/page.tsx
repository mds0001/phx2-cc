import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import UserEditorClient from "@/components/UserEditorClient";

export const dynamic = 'force-dynamic';

export default async function NewUserPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: me }, { data: customers }] = await Promise.all([
    supabase.from("profiles").select("user_type").eq("id", user.id).single(),
    supabase.from("customers").select("id, name, company").order("name"),
  ]);

  if (me?.user_type !== "admin") redirect("/dashboard");

  return (
    <UserEditorClient
      user={null}
      isNew={true}
      currentUserId={user.id}
      customers={customers ?? []}
    />
  );
}
