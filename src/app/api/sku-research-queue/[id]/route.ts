import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

// PATCH — update status (pending / resolved / ignored) and optional notes
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as { status?: string; notes?: string };

    const update: Record<string, unknown> = {};
    if (body.status) update.status = body.status;
    if (body.notes  !== undefined) update.notes = body.notes;
    if (body.status === "resolved") {
      update.resolved_at = new Date().toISOString();
      update.resolved_by = user.id;
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("sku_research_queue")
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
