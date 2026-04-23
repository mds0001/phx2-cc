import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import SkuResearchClient from "@/components/SkuResearchClient";

export const dynamic = "force-dynamic";

export default async function SkuResearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [queueResult, taxonomyResult, runsResult] = await Promise.all([
    supabase
      .from("sku_research_queue")
      .select("id, manufacturer_sku, status, seen_count, first_seen_at, last_seen_at, customer_id, notes, resolved_at, customers(name)")
      .order("status")
      .order("seen_count", { ascending: false }),
    supabase
      .from("sku_taxonomy")
      .select("id, manufacturer_sku, manufacturer, type, subtype, description, model, updated_at")
      .order("manufacturer_sku"),
    // sku_run_exceptions is not in generated Supabase types yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from("sku_run_exceptions").select("*").order("run_at", { ascending: false }),
  ]);

  return (
    <SkuResearchClient
      queue={queueResult.data ?? []}
      taxonomy={taxonomyResult.data ?? []}
      runs={(runsResult.data ?? []) as Parameters<typeof SkuResearchClient>[0]["runs"]}
    />
  );
}
