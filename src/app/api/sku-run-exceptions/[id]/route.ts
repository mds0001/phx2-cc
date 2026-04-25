import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

/**
 * PATCH /api/sku-run-exceptions/[id]
 * Mark a run exception record as resolved.
 * Body: { status: 'resolved' | 'pending' }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as { status?: string; rerun_at?: string; archived?: boolean };

    const admin  = createAdminClient();
    const update: Record<string, unknown> = {};
    if (body.status)              update.status   = body.status;
    if (body.rerun_at)            update.rerun_at = body.rerun_at;
    if (body.archived !== undefined) update.archived = body.archived;

    const { data, error } = await admin
      .from("sku_run_exceptions")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
