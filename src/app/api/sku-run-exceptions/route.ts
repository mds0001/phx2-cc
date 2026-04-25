import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

/**
 * POST /api/sku-run-exceptions
 * Called by SchedulerClient after a run completes with SKU exceptions.
 * Creates one record per run grouping all exceptions together.
 *
 * Body: {
 *   task_id:       string,
 *   task_name:     string,
 *   customer_id?:  string,
 *   customer_name?: string,
 *   exceptions:    { sku: string; row: number; targetField: string }[]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      task_id:       string;
      task_name:     string;
      customer_id?:  string;
      customer_name?: string;
      exceptions:    { sku: string; row: number; targetField: string }[];
    };

    if (!body.task_id || !body.exceptions?.length) {
      return NextResponse.json({ error: "task_id and exceptions required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Find existing non-archived record for this task
    const { data: existing } = await admin
      .from("sku_run_exceptions")
      .select("id")
      .eq("task_id", body.task_id)
      .eq("archived", false)
      .limit(1)
      .maybeSingle();

    let data, error;

    if (existing) {
      // Update the existing record with fresh exceptions + timestamp
      ({ data, error } = await admin
        .from("sku_run_exceptions")
        .update({
          task_name:     body.task_name,
          customer_id:   body.customer_id ?? null,
          customer_name: body.customer_name ?? null,
          exceptions:    body.exceptions,
          status:        "pending",
          run_at:        new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single());
    } else {
      // Insert a new record
      ({ data, error } = await admin
        .from("sku_run_exceptions")
        .insert({
          task_id:       body.task_id,
          task_name:     body.task_name,
          customer_id:   body.customer_id ?? null,
          customer_name: body.customer_name ?? null,
          exceptions:    body.exceptions,
          status:        "pending",
        })
        .select()
        .single());
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * GET /api/sku-run-exceptions
 * Returns all run exception records, newest first.
 * Optional ?status=pending|resolved filter.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const status = req.nextUrl.searchParams.get("status");
    const admin  = createAdminClient();

    let query = admin
      .from("sku_run_exceptions")
      .select("*")
      .order("run_at", { ascending: false });

    if (status === "pending" || status === "resolved") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/sku-run-exceptions
 * Archives all non-archived exception runs for a given task_id.
 * Called when a task completes with zero SKU exceptions (clean run).
 *
 * Body: { task_id: string }
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { task_id } = await req.json() as { task_id?: string };
    if (!task_id) return NextResponse.json({ error: "task_id required" }, { status: 400 });

    const admin = createAdminClient();
    const { error } = await admin
      .from("sku_run_exceptions")
      .update({ archived: true })
      .eq("task_id", task_id)
      .eq("archived", false);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
