import { createClient as createServerSupabaseClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import FinanceClient from "@/components/FinanceClient";

export default async function FinancePage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_type, role")
    .eq("id", user.id)
    .single();

  if (profile?.user_type !== "admin") redirect("/dashboard");

  const [{ data: vendors }, { data: bills }] = await Promise.all([
    supabase.from("cw_vendors").select("*").order("name"),
    supabase
      .from("cw_bills")
      .select("*, vendor:cw_vendors(*)")
      .order("bill_date", { ascending: false }),
  ]);

  return (
    <FinanceClient
      vendors={vendors ?? []}
      bills={bills ?? []}
    />
  );
}
