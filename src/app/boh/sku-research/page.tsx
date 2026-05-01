import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { resolveCustomerFilter } from "@/lib/customer-context";
import { getActiveRoleAssignment } from "@/lib/permissions";
import SkuResearchClient from "@/components/SkuResearchClient";

export const dynamic = "force-dynamic";

async function fetchAllTaxonomy(admin: ReturnType<typeof createAdminClient>) {
  const pageSize = 1000;
  let page = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];

  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from("sku_taxonomy")
      .select("id, manufacturer_sku, manufacturer, type, subtype, description, model, ignore, updated_at")
      .order("manufacturer_sku")
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    page++;
  }

  return all;
}

export default async function SkuResearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assignment = await getActiveRoleAssignment(user.id);
  const role = assignment?.role;
  const activeCustomerId = await resolveCustomerFilter(assignment);

  const { data: customers } = role !== "basic"
    ? await supabase.from("customers").select("id, name, company").order("name")
    : { data: [] };

  const admin = createAdminClient();

  // Build queue query, optionally scoped to active customer
  let queueQuery = supabase
    .from("sku_research_queue")
    .select("id, manufacturer_sku, status, seen_count, first_seen_at, last_seen_at, customer_id, notes, resolved_at, context, archived, customers(name)")
    .order("status")
    .order("seen_count", { ascending: false });
  if (activeCustomerId) queueQuery = queueQuery.eq("customer_id", activeCustomerId);

  // Build runs query, optionally scoped to active customer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runsQuery = (admin as any)
    .from("sku_run_exceptions")
    .select("id, task_id, task_name, customer_id, customer_name, run_at, exceptions, status, rerun_at, archived, created_at")
    .order("run_at", { ascending: false });
  if (activeCustomerId) runsQuery = runsQuery.eq("customer_id", activeCustomerId);

  const [queueResult, taxonomy, runsResult] = await Promise.all([
    queueQuery,
    fetchAllTaxonomy(admin),
    runsQuery,
  ]);

  return (
    <SkuResearchClient
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue={(queueResult.data ?? []) as any}
      taxonomy={taxonomy}
      runs={(runsResult.data ?? []) as Parameters<typeof SkuResearchClient>[0]["runs"]}
      customers={customers ?? []}
      activeCustomerId={activeCustomerId}
    />
  );
}
