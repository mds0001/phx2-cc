import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import stripe from "@/lib/stripe";

/**
 * POST /api/stripe/charge
 * Body: { customer_db_id: string, amount_cents: number, description?: string }
 *
 * Creates and immediately confirms a PaymentIntent against the customer's
 * default saved payment method.  Updates payment_status in the DB on success.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { customer_db_id, amount_cents, description } =
      await req.json() as {
        customer_db_id: string;
        amount_cents: number;
        description?: string;
      };

    if (!customer_db_id || !amount_cents || amount_cents <= 0) {
      return NextResponse.json({ error: "customer_db_id and a positive amount_cents are required" }, { status: 400 });
    }

    // Load customer
    const { data: customer, error } = await supabase
      .from("customers")
      .select("id, name, payment_processor_ref")
      .eq("id", customer_db_id)
      .single();

    if (error || !customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const stripeCustomerId = customer.payment_processor_ref as string | null;
    if (!stripeCustomerId || !stripeCustomerId.startsWith("cus_")) {
      return NextResponse.json(
        { error: "No Stripe customer on file — save a card first." },
        { status: 400 }
      );
    }

    // Retrieve default payment method from Stripe customer
    const stripeCustomer = await stripe.customers.retrieve(stripeCustomerId);
    if (stripeCustomer.deleted) {
      return NextResponse.json({ error: "Stripe customer has been deleted." }, { status: 400 });
    }

    const defaultPm = stripeCustomer.invoice_settings?.default_payment_method as string | null;
    if (!defaultPm) {
      return NextResponse.json(
        { error: "No default payment method — save a card first." },
        { status: 400 }
      );
    }

    // Create and confirm the PaymentIntent
    const intent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: "usd",
      customer: stripeCustomerId,
      payment_method: defaultPm,
      confirm: true,
      description: description ?? `Charge for ${customer.name ?? customer_db_id}`,
      metadata: { customer_db_id },
      // Return immediately on requires_action (3DS) rather than waiting
      return_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/boh/customers/${customer_db_id}`,
    });

    // Update payment_status based on outcome
    const newStatus =
      intent.status === "succeeded"
        ? "active"
        : intent.status === "requires_action"
        ? "pending"
        : "failed";

    await supabase
      .from("customers")
      .update({ payment_status: newStatus })
      .eq("id", customer_db_id);

    return NextResponse.json({
      status: intent.status,
      payment_intent_id: intent.id,
      amount_cents: intent.amount,
      requires_action: intent.status === "requires_action",
      next_action_url: intent.next_action?.redirect_to_url?.url ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
