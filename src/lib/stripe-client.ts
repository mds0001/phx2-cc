import { loadStripe } from "@stripe/stripe-js";

// Singleton promise — safe to call at module level
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "pk_test_placeholder"
);

export default stripePromise;
