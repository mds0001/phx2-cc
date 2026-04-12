import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import UsersListClient from "@/components/UsersListClient";
import type { Profile } from "@/lib/types";

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only administrators can access User Management
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (me?.role !== "administrator") redirect("/dashboard");

  // Fetch all user profiles (RLS allows admins to see all)
  const { data: users } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  return (
    <UsersListClient
      users={(users ?? []) as Profile[]}
      currentUserId={user.id}
    />
  );
}
