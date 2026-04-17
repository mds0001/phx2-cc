import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import stripe from "@/lib/stripe";

/**
 * POST /api/stripe/setup-intent
 * Body: { customer_db_id: string }
 *
 * Returns a SetupIntent client_secret so the frontend can securely collect
 * and save a card without charging it.  Creates a Stripe Customer record on
 * the first call and persists the ID in customers.payment_processor_ref.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { customer_db_id } = await req.json() as { customer_db_id: string };
    if (!customer_db_id) {
      return NextResponse.json({ error: "customer_db_id required" }, { status: 400 });
    }

    // Load the customer row
    const { data: customer, error } = await supabase
      .from("customers")
      .select("id, name, email, payment_processor_ref")
      .eq("id", customer_db_id)
      .single();

    if (error || !customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Create Stripe Customer if we don't have one yet
    let stripeCustomerId = customer.payment_processor_ref as string | null;

    if (!stripeCustomerId || !stripeCustomerId.startsWith("cus_")) {
      const stripeCustomer = await stripe.customers.create({
        name: customer.name ?? undefined,
        email: customer.email ?? undefined,
        metadata: { customer_db_id },
      });
      stripeCustomerId = stripeCustomer.id;

      // Persist the Stripe customer ID
      await supabase
        .from("customers")
        .update({ payment_processor_ref: stripeCustomerId })
        .eq("id", customer_db_id);
    }

    // Create the SetupIntent
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      metadata: { customer_db_id },
    });

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      stripeCustomerId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
