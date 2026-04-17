import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import stripe from "@/lib/stripe";

/**
 * POST /api/stripe/save-card
 * Body: { customer_db_id: string, payment_method_id: string, stripe_customer_id: string }
 *
 * Called after the frontend successfully confirms a SetupIntent.
 * - Attaches the PaymentMethod to the Stripe customer
 * - Sets it as the default payment method
 * - Updates the customers table with card display fields (brand, last4, expiry)
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { customer_db_id, payment_method_id, stripe_customer_id } =
      await req.json() as {
        customer_db_id: string;
        payment_method_id: string;
        stripe_customer_id: string;
      };

    if (!customer_db_id || !payment_method_id || !stripe_customer_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Attach PM to the Stripe customer (no-op if already attached)
    try {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: stripe_customer_id,
      });
    } catch (err: unknown) {
      // Already attached is fine
      const msg = err instanceof Error ? err.message : "";
      if (!msg.includes("already been attached")) throw err;
    }

    // Set as the default payment method
    await stripe.customers.update(stripe_customer_id, {
      invoice_settings: { default_payment_method: payment_method_id },
    });

    // Retrieve card details for display
    const pm = await stripe.paymentMethods.retrieve(payment_method_id);
    const card = pm.card;

    if (!card) {
      return NextResponse.json({ error: "No card data on payment method" }, { status: 400 });
    }

    const cardBrand = card.brand.charAt(0).toUpperCase() + card.brand.slice(1); // "visa" → "Visa"

    // Update the customers table
    const { error: dbErr } = await supabase
      .from("customers")
      .update({
        card_type: cardBrand,
        card_last4: card.last4,
        card_expiry_month: card.exp_month,
        card_expiry_year: card.exp_year,
        payment_processor_ref: stripe_customer_id,
        payment_status: "active",
      })
      .eq("id", customer_db_id);

    if (dbErr) throw dbErr;

    return NextResponse.json({
      card_type: cardBrand,
      card_last4: card.last4,
      card_expiry_month: card.exp_month,
      card_expiry_year: card.exp_year,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
