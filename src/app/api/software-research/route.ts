import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getCurrentUserAssignment } from "@/lib/permissions";

/**
 * Software Research management API — the knowledge layer behind the Intune
 * software normalization feature (software_catalog / software_signatures /
 * software_research_queue).
 *
 * Gate mirrors sku-overrides: administrator or schedule_administrator may
 * view and propose; ACTIVATING a signature (status='active') is
 * administrator-only — the two-step approval.
 */

type Gate = { userId: string; role: string };

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
  return { userId: auth.userId, role };
}

const cleanText = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const VERDICTS = ["product", "component_of", "noise"] as const;
type Verdict = (typeof VERDICTS)[number];

interface CatalogInput {
  manufacturer: string;
  title: string;
  version: string | null;
  edition: string | null;
  licensable: boolean;
}

function parseCatalogInput(raw: unknown): CatalogInput | null {
  const c = (raw ?? {}) as Record<string, unknown>;
  const manufacturer = cleanText(c.manufacturer);
  const title = cleanText(c.title);
  if (!manufacturer || !title) return null;
  return {
    manufacturer,
    title,
    version: cleanText(c.version),
    edition: cleanText(c.edition),
    licensable: typeof c.licensable === "boolean" ? c.licensable : true,
  };
}

/** Find an existing catalog row by case-insensitive identity, else create it. */
async function findOrCreateCatalog(
  admin: ReturnType<typeof createAdminClient>,
  input: CatalogInput,
  userId: string,
): Promise<{ id: string } | { error: string }> {
  const { data: candidates } = await admin
    .from("software_catalog")
    .select("id, manufacturer, title, version, edition")
    .ilike("manufacturer", input.manufacturer)
    .ilike("title", input.title);

  const eq = (a: string | null, b: string | null) =>
    (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  const existing = (candidates ?? []).find(
    (c) => eq(c.version, input.version) && eq(c.edition, input.edition),
  );
  if (existing) return { id: existing.id };

  const { data, error } = await admin
    .from("software_catalog")
    .insert({ ...input, created_by: userId })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id };
}

// ── GET: the whole knowledge layer in one call ─────────────────────────────
export async function GET() {
  const gate = await requireManage();
  if (gate instanceof NextResponse) return gate;

  const admin = createAdminClient();
  const [queueRes, sigRes, catRes] = await Promise.all([
    admin.from("software_research_queue").select("*")
      .order("status").order("device_count", { ascending: false }).order("seen_count", { ascending: false }),
    admin.from("software_signatures").select("*").order("created_at", { ascending: false }),
    admin.from("software_catalog").select("*").order("manufacturer").order("title"),
  ]);

  const firstError = queueRes.error ?? sigRes.error ?? catRes.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  return NextResponse.json({
    queue: queueRes.data ?? [],
    signatures: sigRes.data ?? [],
    catalog: catRes.data ?? [],
  });
}

// ── POST: resolve a queue item / create catalog entries & signatures ──────
export async function POST(req: NextRequest) {
  try {
    const gate = await requireManage();
    if (gate instanceof NextResponse) return gate;

    const body = (await req.json()) as Record<string, unknown>;
    const action = cleanText(body.action);
    const admin = createAdminClient();

    // "resolve" — the main flow: classify a queue row, creating the catalog
    // entry (unless noise) + a pending signature, and mark the row researched.
    if (action === "resolve") {
      const queueId = cleanText(body.queue_id);
      const verdict = cleanText(body.verdict) as Verdict | null;
      const namePattern = cleanText(body.name_pattern);
      if (!queueId || !verdict || !VERDICTS.includes(verdict)) {
        return NextResponse.json({ error: "queue_id and a valid verdict are required" }, { status: 400 });
      }
      if (!namePattern) return NextResponse.json({ error: "name_pattern is required" }, { status: 400 });

      const { data: qRows } = await admin
        .from("software_research_queue").select("*").eq("id", queueId).limit(1);
      const queueRow = qRows?.[0] ?? null;
      if (!queueRow) return NextResponse.json({ error: "queue item not found" }, { status: 404 });

      let catalogId: string | null = cleanText(body.catalog_id);
      if (verdict !== "noise" && !catalogId) {
        const input = parseCatalogInput(body.catalog);
        if (!input) {
          return NextResponse.json(
            { error: "catalog { manufacturer, title } or catalog_id required for this verdict" },
            { status: 400 },
          );
        }
        const found = await findOrCreateCatalog(admin, input, gate.userId);
        if ("error" in found) return NextResponse.json({ error: found.error }, { status: 500 });
        catalogId = found.id;
      }

      const { data: sig, error: sigErr } = await admin
        .from("software_signatures")
        .insert({
          publisher: cleanText(body.publisher),
          name_pattern: namePattern,
          version_pattern: cleanText(body.version_pattern),
          verdict,
          catalog_id: verdict === "noise" ? null : catalogId,
          status: "pending",
          source: "manual",
          reason: cleanText(body.reason),
          created_by: gate.userId,
        })
        .select()
        .single();
      if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 });

      await admin
        .from("software_research_queue")
        .update({ status: "researched" })
        .eq("id", queueId);

      return NextResponse.json({ data: sig });
    }

    // "catalog" — create a catalog product directly.
    if (action === "catalog") {
      const input = parseCatalogInput(body.catalog ?? body);
      if (!input) return NextResponse.json({ error: "manufacturer and title are required" }, { status: 400 });
      const found = await findOrCreateCatalog(admin, input, gate.userId);
      if ("error" in found) return NextResponse.json({ error: found.error }, { status: 500 });
      return NextResponse.json({ data: found });
    }

    // "signature" — create a signature directly against an existing catalog row.
    if (action === "signature") {
      const verdict = cleanText(body.verdict) as Verdict | null;
      const namePattern = cleanText(body.name_pattern);
      const catalogId = cleanText(body.catalog_id);
      if (!verdict || !VERDICTS.includes(verdict) || !namePattern) {
        return NextResponse.json({ error: "verdict and name_pattern are required" }, { status: 400 });
      }
      if (verdict !== "noise" && !catalogId) {
        return NextResponse.json({ error: "catalog_id required for this verdict" }, { status: 400 });
      }
      const { data, error } = await admin
        .from("software_signatures")
        .insert({
          publisher: cleanText(body.publisher),
          name_pattern: namePattern,
          version_pattern: cleanText(body.version_pattern),
          verdict,
          catalog_id: verdict === "noise" ? null : catalogId,
          status: "pending",
          source: "manual",
          reason: cleanText(body.reason),
          created_by: gate.userId,
        })
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data });
    }

    return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── PATCH: edit queue / signature / catalog rows by id ─────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const gate = await requireManage();
    if (gate instanceof NextResponse) return gate;

    const body = (await req.json()) as Record<string, unknown>;
    const resource = cleanText(body.resource);
    const id = cleanText(body.id);
    if (!resource || !id) return NextResponse.json({ error: "resource and id required" }, { status: 400 });

    const admin = createAdminClient();

    if (resource === "queue") {
      const patch: Record<string, unknown> = {};
      const status = cleanText(body.status);
      if (status) {
        if (!["pending", "researched", "ignored", "skipped"].includes(status)) {
          return NextResponse.json({ error: "invalid queue status" }, { status: 400 });
        }
        patch.status = status;
      }
      if ("notes" in body) patch.notes = cleanText(body.notes);
      const { data, error } = await admin
        .from("software_research_queue").update(patch).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data });
    }

    if (resource === "signature") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const status = cleanText(body.status);
      if (status) {
        if (!["pending", "active", "disabled"].includes(status)) {
          return NextResponse.json({ error: "invalid signature status" }, { status: 400 });
        }
        if (status === "active" && gate.role !== "administrator") {
          return NextResponse.json(
            { error: "Forbidden — only an administrator can activate a signature" },
            { status: 403 },
          );
        }
        patch.status = status;
        patch.activated_by = status === "active" ? gate.userId : null;
      }
      for (const f of ["publisher", "name_pattern", "version_pattern", "reason"] as const) {
        if (f in body) patch[f] = cleanText(body[f]);
      }
      if ("catalog_id" in body) patch.catalog_id = cleanText(body.catalog_id);
      const verdict = cleanText(body.verdict);
      if (verdict) {
        if (!VERDICTS.includes(verdict as Verdict)) {
          return NextResponse.json({ error: "invalid verdict" }, { status: 400 });
        }
        patch.verdict = verdict;
      }
      const { data, error } = await admin
        .from("software_signatures").update(patch).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data });
    }

    if (resource === "catalog") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const f of ["manufacturer", "title", "version", "edition", "notes"] as const) {
        if (f in body) patch[f] = cleanText(body[f]);
      }
      if (typeof body.licensable === "boolean") patch.licensable = body.licensable;
      if (patch.manufacturer === null || patch.title === null) {
        return NextResponse.json({ error: "manufacturer and title cannot be blank" }, { status: 400 });
      }
      const { data, error } = await admin
        .from("software_catalog").update(patch).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data });
    }

    return NextResponse.json({ error: `unknown resource "${resource}"` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── DELETE: remove a row by ?resource=&id= ─────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const gate = await requireManage();
    if (gate instanceof NextResponse) return gate;

    const resource = req.nextUrl.searchParams.get("resource");
    const id = req.nextUrl.searchParams.get("id");
    if (!resource || !id) return NextResponse.json({ error: "resource and id query params required" }, { status: 400 });

    const table =
      resource === "queue" ? "software_research_queue" :
      resource === "signature" ? "software_signatures" :
      resource === "catalog" ? "software_catalog" : null;
    if (!table) return NextResponse.json({ error: `unknown resource "${resource}"` }, { status: 400 });

    const admin = createAdminClient();
    const { error } = await admin.from(table).delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
