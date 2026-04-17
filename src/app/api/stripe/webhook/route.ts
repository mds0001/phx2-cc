import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import stripe from "@/lib/stripe";

/**
 * POST /api/stripe/webhook
 *
 * Stripe webhook handler.  Must use the raw request body for signature
 * verification — Next.js App Router gives us this via req.text().
 *
 * Handled events:
 *  - payment_intent.succeeded       → payment_status = "active"
 *  - payment_intent.payment_failed  → payment_status = "failed"
 *  - setup_intent.succeeded         → no-op (card save already handled by save-card route)
 *
 * Configure in Stripe Dashboard:
 *   Endpoint URL: https://<your-domain>/api/stripe/webhook
 *   Events: payment_intent.succeeded, payment_intent.payment_failed
 */

// Required: tell Next.js not to parse the body — we need the raw bytes
export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  // Verify the event came from Stripe
  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Webhook signature verification failed:", msg);
    return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 });
  }

  // Use the admin client so we can update any customer row regardless of RLS
  const supabase = createAdminClient();

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object as { metadata?: { customer_db_id?: string } };
      const customerId = pi.metadata?.customer_db_id;
      if (customerId) {
        await supabase
          .from("customers")
          .update({ payment_status: "active" })
          .eq("id", customerId);
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as { metadata?: { customer_db_id?: string } };
      const customerId = pi.metadata?.customer_db_id;
      if (customerId) {
        await supabase
          .from("customers")
          .update({ payment_status: "failed" })
          .eq("id", customerId);
      }
      break;
    }

    // Silently acknowledge other events
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
