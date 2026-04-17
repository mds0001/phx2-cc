import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import UsersListClient from "@/components/UsersListClient";
import type { Profile } from "@/lib/types";

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (me?.role !== "administrator") redirect("/dashboard");

  const [{ data: users }, { data: customers }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("customers").select("id, name, company").order("name"),
  ]);

  return (
    <UsersListClient
      users={(users ?? []) as Profile[]}
      currentUserId={user.id}
      customers={customers ?? []}
    />
  );
}
