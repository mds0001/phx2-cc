import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("user_type").eq("id", user.id).single();
  if (me?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { opportunityId } = await req.json();
  if (!opportunityId) return NextResponse.json({ error: "opportunityId required" }, { status: 400 });

  // Fetch opportunity + lead
  const { data: opp, error: oppErr } = await supabase
    .from("opportunities")
    .select("*, leads(*)")
    .eq("id", opportunityId)
    .single();

  if (oppErr || !opp) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  if (opp.status === "won") return NextResponse.json({ error: "Already converted" }, { status: 400 });

  const lead = opp.leads as Record<string, string | null> | null;
  if (!lead) return NextResponse.json({ error: "No lead linked to this opportunity" }, { status: 400 });
  if (!lead.email) return NextResponse.json({ error: "Lead must have an email to convert" }, { status: 400 });

  const admin = createAdminClient();

  // Create customer
  const { data: customer, error: custErr } = await admin
    .from("customers")
    .insert({
      name:           lead.name,
      company:        lead.company ?? null,
      email:          lead.email,
      phone:          lead.phone ?? null,
      payment_status: "pending",
      alert_days_before: 30,
      notes:          opp.notes ?? null,
      created_by:     user.id,
    })
    .select()
    .single();

  if (custErr || !customer) {
    return NextResponse.json({ error: custErr?.message ?? "Failed to create customer" }, { status: 500 });
  }

  // Create customer license for the tier
  if (opp.tier && opp.tier !== "free") {
    await admin.from("customer_licenses").insert({
      customer_id:  customer.id,
      product_name: `Threads ${opp.tier.charAt(0).toUpperCase() + opp.tier.slice(1)}`,
      status:       "trial",
      renewal_type: "manual",
      created_by:   user.id,
    });
  }

  // Mark opportunity as won + update lead to qualified
  await admin.from("opportunities").update({ status: "won" }).eq("id", opportunityId);
  if (lead.id) {
    await admin.from("leads").update({ status: "qualified" }).eq("id", lead.id);
  }

  // Send Supabase invite
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(lead.email as string, {
    data: { customer_id: customer.id },
  });

  if (inviteErr) {
    // Customer was created — just warn rather than fail
    return NextResponse.json({
      customerId: customer.id,
      warning: `Customer created but invite failed: ${inviteErr.message}`,
    });
  }

  return NextResponse.json({ customerId: customer.id });
}
