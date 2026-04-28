import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

// POST — upsert a taxonomy entry
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      manufacturer_sku: string;
      manufacturer?: string;
      type?: string;
      subtype?: string;
      description?: string;
      model?: string;
    };

    if (!body.manufacturer_sku) {
      return NextResponse.json({ error: "manufacturer_sku required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("sku_taxonomy")
      .upsert({
        manufacturer_sku: body.manufacturer_sku.trim().toUpperCase(),
        manufacturer:     body.manufacturer?.trim() || null,
        type:             body.type?.trim() || null,
        subtype:          body.subtype?.trim() || null,
        description:      body.description?.trim() || null,
        model:            body.model?.trim() || null,
        created_by:       user.id,
        updated_at:       new Date().toISOString(),
      }, { onConflict: "manufacturer_sku" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET — list taxonomy (with optional ?sku= filter)
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sku = req.nextUrl.searchParams.get("sku");
  const admin = createAdminClient();

  let query = admin.from("sku_taxonomy").select("*").order("manufacturer_sku");
  if (sku) query = query.eq("manufacturer_sku", sku.trim().toUpperCase());

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// PATCH — toggle or set the ignore flag on a taxonomy entry
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as { manufacturer_sku: string; ignore: boolean };
    if (!body.manufacturer_sku) return NextResponse.json({ error: "manufacturer_sku required" }, { status: 400 });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("sku_taxonomy")
      .update({ ignore: body.ignore, updated_at: new Date().toISOString() })
      .eq("manufacturer_sku", body.manufacturer_sku.trim().toUpperCase())
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — remove a taxonomy entry by ?sku= query param
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sku = req.nextUrl.searchParams.get("sku");
    if (!sku) return NextResponse.json({ error: "sku query param required" }, { status: 400 });

    const admin = createAdminClient();
    const { error } = await admin
      .from("sku_taxonomy")
      .delete()
      .eq("manufacturer_sku", sku.trim().toUpperCase());

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
