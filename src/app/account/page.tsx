import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import AccountClient from "@/components/AccountClient";
import { redirect } from "next/navigation";

export const metadata = { title: "Security — Threads" };

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("first_name, last_name, email, mfa_enabled")
    .eq("id", user.id)
    .single();

  return (
    <AccountClient
      userId={user.id}
      email={profile?.email ?? user.email ?? ""}
      firstName={profile?.first_name ?? null}
      lastName={profile?.last_name ?? null}
      mfaEnabled={profile?.mfa_enabled ?? false}
    />
  );
}
