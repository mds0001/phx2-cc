import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import UsersListClient, { type UserWithRoles } from "@/components/UsersListClient";
import type { Profile, UserRoleAssignment } from "@/lib/types";

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("user_type")
    .eq("id", user.id)
    .single();

  if (me?.user_type !== "admin") redirect("/dashboard");

  const [{ data: users }, { data: customers }, { data: allRoles }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("customers").select("id, name, company").order("name"),
    supabase.from("user_roles").select("*"),
  ]);

  const rolesByUser = new Map<string, UserRoleAssignment[]>();
  for (const r of (allRoles ?? []) as UserRoleAssignment[]) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r);
    rolesByUser.set(r.user_id, arr);
  }

  const usersWithRoles: UserWithRoles[] = ((users ?? []) as Profile[]).map((u) => ({
    ...u,
    roles: rolesByUser.get(u.id) ?? [],
  }));

  return (
    <UsersListClient
      users={usersWithRoles}
      currentUserId={user.id}
      customers={customers ?? []}
    />
  );
}
