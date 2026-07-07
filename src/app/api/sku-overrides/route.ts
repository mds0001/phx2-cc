import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getCurrentUserAssignment } from "@/lib/permissions";

type Gate = { userId: string; role: string; customerId: string | null };

/** Sparse classification fields an override may carry (null = inherit global). */
const CLASS_FIELDS = [
  "manufacturer", "type", "subtype", "description", "model",
  "sw_title", "sw_version", "sw_edition",
] as const;

/**
 * Manage gate: administrator (any customer) or schedule_administrator (their
 * own customer only). Activation to `active` is additionally administrator-only
 * — enforced in PATCH, the two-step approval.
 */
async function requireManage(): Promise<Gate | NextResponse> {
  const auth = await getCurrentUserAssignment();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = auth.assignment?.role ?? null;
  if (role !== "administrator" && role !== "schedule_administrator") {
    return NextResponse.json(
      { error: "Forbidden — administrator or schedule_administrator role required" },
      { status: 403 },
    );
  }
  return { userId: auth.userId, role, customerId: auth.assignment?.customer_id ?? null };
}

const cleanText = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// GET — list overrides. Admins see all (optional ?customer_id / ?status filters);
// schedule_administrators are locked to their own customer.
export async function GET(req: NextRequest) {
  const gate = await requireManage();
  if (gate instanceof NextResponse) return gate;

  const admin = createAdminClient();
  let q = admin.from("sku_taxonomy_overrides").select("*").order("manufacturer_sku");

  if (gate.role === "schedule_administrator") {
    q = q.eq("customer_id", gate.customerId ?? "__none__");
  } else {
    const customerId = req.nextUrl.searchParams.get("customer_id");
    if (customerId) q = q.eq("customer_id", customerId);
  }
  const status = req.nextUrl.searchParams.get("status");
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// POST — create (or re-propose) a PENDING override. Snapshots the global row
// for drift detection. schedule_admin may only target their own customer.
export async function POST(req: NextRequest) {
  try {
    const gate = await requireManage();
    if (gate instanceof NextResponse) return gate;

    const body = (await req.json()) as Record<string, unknown>;
    const customerId = cleanText(body.customer_id);
    const sku = cleanText(body.manufacturer_sku)?.toUpperCase() ?? null;
    const reason = cleanText(body.reason);

    if (!customerId || !sku) {
      return NextResponse.json({ error: "customer_id and manufacturer_sku required" }, { status: 400 });
    }
    if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });
    if (gate.role === "schedule_administrator" && gate.customerId !== customerId) {
      return NextResponse.json({ error: "Forbidden — outside your customer scope" }, { status: 403 });
    }

    const admin = createAdminClient();

    // Snapshot the global row's classification for the drift report.
    const { data: globalRows } = await admin
      .from("sku_taxonomy")
      .select("manufacturer, type, subtype, description, model, sw_title, sw_version, sw_edition, ignore")
      .eq("manufacturer_sku", sku)
      .limit(1);

    const row: Record<string, unknown> = {
      customer_id: customerId,
      manufacturer_sku: sku,
      reason,
      status: "pending",
      created_by: gate.userId,
      activated_by: null,
      global_snapshot: globalRows?.[0] ?? null,
      ignore: typeof body.ignore === "boolean" ? body.ignore : null,
      updated_at: new Date().toISOString(),
    };
    for (const f of CLASS_FIELDS) row[f] = cleanText(body[f]);

    const { data, error } = await admin
      .from("sku_taxonomy_overrides")
      .upsert(row, { onConflict: "customer_id,manufacturer_sku" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH — edit fields / change status by id. Activating (status='active') is
// administrator-only. schedule_admin may only touch their own customer's rows.
export async function PATCH(req: NextRequest) {
  try {
    const gate = await requireManage();
    if (gate instanceof NextResponse) return gate;

    const body = (await req.json()) as Record<string, unknown>;
    const id = cleanText(body.id);
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const admin = createAdminClient();
    const { data: rows } = await admin.from("sku_taxonomy_overrides").select("*").eq("id", id).limit(1);
    const override = rows?.[0] ?? null;
    if (!override) return NextResponse.json({ error: "override not found" }, { status: 404 });

    if (gate.role === "schedule_administrator" && gate.customerId !== override.customer_id) {
      return NextResponse.json({ error: "Forbidden — outside your customer scope" }, { status: 403 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.status === "string") {
      if (!["pending", "active", "disabled"].includes(body.status)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      if (body.status === "active" && gate.role !== "administrator") {
        return NextResponse.json(
          { error: "Forbidden — only an administrator can activate an override" },
          { status: 403 },
        );
      }
      patch.status = body.status;
      patch.activated_by = body.status === "active" ? gate.userId : null;
    }
    for (const f of CLASS_FIELDS) if (f in body) patch[f] = cleanText(body[f]);
    if ("ignore" in body) patch.ignore = typeof body.ignore === "boolean" ? body.ignore : null;
    if (cleanText(body.reason)) patch.reason = cleanText(body.reason);

    const { data, error } = await admin
      .from("sku_taxonomy_overrides").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — remove an override by ?id=. schedule_admin scoped to own customer.
export async function DELETE(req: NextRequest) {
  try {
    const gate = await requireManage();
    if (gate instanceof NextResponse) return gate;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

    const admin = createAdminClient();
    const { data: rows } = await admin.from("sku_taxonomy_overrides").select("customer_id").eq("id", id).limit(1);
    const override = rows?.[0] ?? null;
    if (!override) return NextResponse.json({ error: "override not found" }, { status: 404 });

    if (gate.role === "schedule_administrator" && gate.customerId !== override.customer_id) {
      return NextResponse.json({ error: "Forbidden — outside your customer scope" }, { status: 403 });
    }

    const { error } = await admin.from("sku_taxonomy_overrides").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
