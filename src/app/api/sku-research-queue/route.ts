import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

// POST — upsert a queue item by manufacturer_sku (insert or update status)
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      manufacturer_sku: string;
      status?: string;
      customer_id?: string | null;
    };

    if (!body.manufacturer_sku?.trim()) {
      return NextResponse.json({ error: "manufacturer_sku required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const sku = body.manufacturer_sku.trim().toUpperCase();
    const status = body.status ?? "pending";

    // Upsert by manufacturer_sku — update status if row already exists
    const { data, error } = await admin
      .from("sku_research_queue")
      .upsert(
        {
          manufacturer_sku: sku,
          status,
          customer_id: body.customer_id ?? null,
          seen_count: 1,
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          ...(status === "resolved" ? { resolved_at: new Date().toISOString() } : {}),
        },
        { onConflict: "manufacturer_sku", ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) {
      console.error("[sku-research-queue POST] upsert error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[sku-research-queue POST] exception:", String(err));
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
