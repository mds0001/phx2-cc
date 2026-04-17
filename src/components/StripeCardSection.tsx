"use client";

import { useState, useCallback } from "react";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import stripePromise from "@/lib/stripe-client";
import {
  CreditCard, Plus, RefreshCw, Trash2, DollarSign,
  Check, AlertCircle, Loader2, X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────

interface CardInfo {
  card_type: string | null;
  card_last4: string | null;
  card_expiry_month: number | null;
  card_expiry_year: number | null;
  payment_processor_ref: string | null;
}

interface Props {
  customerId: string;              // DB customer UUID
  card: CardInfo;
  onCardSaved: (info: {
    card_type: string;
    card_last4: string;
    card_expiry_month: number;
    card_expiry_year: number;
    payment_processor_ref: string;
  }) => void;
  onChargeComplete: (status: string) => void;
}

// ── Card brand icon map ────────────────────────────────────────

const BRAND_COLORS: Record<string, string> = {
  Visa:       "text-blue-400",
  Mastercard: "text-orange-400",
  Amex:       "text-sky-400",
  Discover:   "text-amber-400",
};

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: "#f9fafb",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: "14px",
      "::placeholder": { color: "#6b7280" },
      backgroundColor: "transparent",
    },
    invalid: { color: "#f87171" },
  },
};

// ── Inner save-card form (needs stripe/elements context) ───────

function SaveCardForm({
  customerId,
  stripeCustomerId,
  clientSecret,
  onSuccess,
  onCancel,
}: {
  customerId: string;
  stripeCustomerId: string;
  clientSecret: string;
  onSuccess: (info: { card_type: string; card_last4: string; card_expiry_month: number; card_expiry_year: number; payment_processor_ref: string }) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);

    const cardEl = elements.getElement(CardElement);
    if (!cardEl) { setSaving(false); return; }

    // Confirm the SetupIntent
    const { error: stripeErr, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card: cardEl },
    });

    if (stripeErr || !setupIntent?.payment_method) {
      setError(stripeErr?.message ?? "Card setup failed — please try again.");
      setSaving(false);
      return;
    }

    // Persist card details via our API
    try {
      const res = await fetch("/api/stripe/save-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_db_id: customerId,
          payment_method_id: setupIntent.payment_method as string,
          stripe_customer_id: stripeCustomerId,
        }),
      });
      const data = await res.json() as {
        card_type?: string; card_last4?: string;
        card_expiry_month?: number; card_expiry_year?: number;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? "Save failed");
      onSuccess({
        card_type: data.card_type!,
        card_last4: data.card_last4!,
        card_expiry_month: data.card_expiry_month!,
        card_expiry_year: data.card_expiry_year!,
        payment_processor_ref: stripeCustomerId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save card");
    } finally {
      setSaving(false);
    }
  }, [stripe, elements, clientSecret, customerId, stripeCustomerId, onSuccess]);

  return (
    <div className="space-y-3">
      <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
        <CardElement options={CARD_ELEMENT_OPTIONS} />
      </div>
      {error && (
        <p className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !stripe}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-all"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? "Saving…" : "Save Card"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Charge modal ───────────────────────────────────────────────

function ChargeModal({
  customerId,
  onComplete,
  onClose,
}: {
  customerId: string;
  onComplete: (status: string) => void;
  onClose: () => void;
}) {
  const [amountStr, setAmountStr] = useState("");
  const [description, setDescription] = useState("");
  const [charging, setCharging] = useState(false);
  const [result, setResult] = useState<{ status: string; error?: string } | null>(null);

  async function handleCharge() {
    const amount = Math.round(parseFloat(amountStr) * 100);
    if (!amount || amount <= 0) return;
    setCharging(true);
    setResult(null);

    try {
      const res = await fetch("/api/stripe/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_db_id: customerId, amount_cents: amount, description: description || undefined }),
      });
      const data = await res.json() as { status?: string; error?: string };
      if (!res.ok || data.error) {
        setResult({ status: "failed", error: data.error });
      } else {
        setResult({ status: data.status! });
        onComplete(data.status!!);
        setTimeout(onClose, 1800);
      }
    } catch (err) {
      setResult({ status: "failed", error: err instanceof Error ? err.message : "Charge failed" });
    } finally {
      setCharging(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-indigo-400" />
            Charge Customer
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm ${
            result.status === "succeeded"
              ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
              : "bg-red-500/10 border-red-500/25 text-red-300"
          }`}>
            {result.status === "succeeded"
              ? <><Check className="w-4 h-4" /> Payment succeeded</>
              : <><AlertCircle className="w-4 h-4" /> {result.error ?? "Payment failed"}</>
            }
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Amount (USD)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-8 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Description (optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Invoice #1234, Annual renewal…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleCharge}
                disabled={charging || !amountStr || parseFloat(amountStr) <= 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-all"
              >
                {charging
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Charging…</>
                  : <><DollarSign className="w-4 h-4" /> Charge {amountStr ? `$${parseFloat(amountStr).toFixed(2)}` : ""}</>
                }
              </button>
              <button type="button" onClick={onClose}
                className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-all">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main exported component ────────────────────────────────────

export default function StripeCardSection({ customerId, card, onCardSaved, onChargeComplete }: Props) {
  const [mode, setMode] = useState<"idle" | "adding">("idle");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripeCustomerId, setStripeCustomerId] = useState<string | null>(
    card.payment_processor_ref?.startsWith("cus_") ? card.payment_processor_ref : null
  );
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [showCharge, setShowCharge] = useState(false);

  const hasCard = !!(card.card_last4 && card.card_type);

  async function startAddCard() {
    setLoadingIntent(true);
    setIntentError(null);
    try {
      const res = await fetch("/api/stripe/setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_db_id: customerId }),
      });
      const data = await res.json() as { clientSecret?: string; stripeCustomerId?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to initialise card setup");
      setClientSecret(data.clientSecret!);
      setStripeCustomerId(data.stripeCustomerId!);
      setMode("adding");
    } catch (err) {
      setIntentError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoadingIntent(false);
    }
  }

  const brandColor = card.card_type ? (BRAND_COLORS[card.card_type] ?? "text-gray-400") : "text-gray-400";

  return (
    <div className="space-y-3">
      {/* Card on file display */}
      {hasCard && mode === "idle" ? (
        <div className="flex items-center justify-between bg-gray-800/60 border border-gray-700 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <CreditCard className={`w-5 h-5 ${brandColor}`} />
            <div>
              <p className="text-sm font-medium text-white">
                {card.card_type} &middot;&middot;&middot;&middot; {card.card_last4}
              </p>
              <p className="text-xs text-gray-500">
                Exp {String(card.card_expiry_month).padStart(2, "0")}/{card.card_expiry_year}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCharge(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 rounded-lg text-xs font-medium transition-all"
            >
              <DollarSign className="w-3.5 h-3.5" />
              Charge
            </button>
            <button
              type="button"
              onClick={startAddCard}
              disabled={loadingIntent}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
            >
              {loadingIntent ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Update
            </button>
          </div>
        </div>
      ) : mode === "idle" ? (
        <div className="flex items-center justify-between bg-gray-800/40 border border-dashed border-gray-700 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-gray-600" />
            <p className="text-sm text-gray-500">No card on file</p>
          </div>
          <button
            type="button"
            onClick={startAddCard}
            disabled={loadingIntent}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 text-indigo-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
          >
            {loadingIntent ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {loadingIntent ? "Preparing…" : "Add Card"}
          </button>
        </div>
      ) : null}

      {intentError && (
        <p className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" />
          {intentError}
        </p>
      )}

      {/* Stripe Elements card entry form */}
      {mode === "adding" && clientSecret && stripeCustomerId && (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <SaveCardForm
            customerId={customerId}
            stripeCustomerId={stripeCustomerId}
            clientSecret={clientSecret}
            onSuccess={(info) => {
              onCardSaved(info);
              setMode("idle");
              setClientSecret(null);
            }}
            onCancel={() => {
              setMode("idle");
              setClientSecret(null);
            }}
          />
        </Elements>
      )}

      {/* Charge modal */}
      {showCharge && (
        <ChargeModal
          customerId={customerId}
          onComplete={(status) => {
            onChargeComplete(status);
          }}
          onClose={() => setShowCharge(false)}
        />
      )}
    </div>
  );
}
