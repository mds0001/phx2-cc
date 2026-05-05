import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getActiveRoleAssignment } from "@/lib/permissions";
import FinanceClient from "@/components/FinanceClient";

export default async function FinancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assignment = await getActiveRoleAssignment(user.id);
  if (assignment?.role !== "administrator") redirect("/dashboard");

  const [{ data: vendors }, { data: bills }, { data: ownerLedger }] = await Promise.all([
    supabase.from("cw_vendors").select("*").order("name"),
    supabase
      .from("cw_bills")
      .select("*, vendor:cw_vendors(*)")
      .order("bill_date", { ascending: false }),
    supabase.from("cw_owner_ledger").select("*").order("date", { ascending: false }),
  ]);

  return (
    <FinanceClient
      vendors={vendors ?? []}
      bills={bills ?? []}
      ownerLedger={ownerLedger ?? []}
    />
  );
}
