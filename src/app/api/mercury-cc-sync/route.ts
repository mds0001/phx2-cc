import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

const MERCURY_API = "https://api.mercury.com/api/v1";
const MERCURY_CC_ID = "f61b1d82-44df-11f1-a091-cf2256cd9db3";

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.MERCURY_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// GET /api/mercury-cc-sync
// Returns unimported Mercury CC transactions (not yet in cw_bills)
export async function GET() {
  if (!process.env.MERCURY_API_KEY) {
    return NextResponse.json({ error: "MERCURY_API_KEY not set" }, { status: 500 });
  }

  // Fetch CC transactions from Mercury
  const params = new URLSearchParams({ limit: "500", order: "desc" });
  const res = await fetch(`${MERCURY_API}/account/${MERCURY_CC_ID}/transactions?${params}`, {
    headers: authHeaders(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ error: "Mercury fetch failed", details: err }, { status: res.status });
  }

  const { transactions = [] } = await res.json();

  // Get already-imported mercury_transaction_ids from Supabase
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("cw_bills")
    .select("mercury_transaction_id")
    .not("mercury_transaction_id", "is", null);

  const importedIds = new Set((existing ?? []).map((r: { mercury_transaction_id: string }) => r.mercury_transaction_id));

  // Filter to unimported charges (negative amount = CC charge, positive = payment/credit)
  const unimported = transactions
    .filter((t: MercuryTxn) => !importedIds.has(t.id) && t.status !== "cancelled" && t.status !== "failed")
    .map((t: MercuryTxn) => ({
      id: t.id,
      date: (t.postedAt ?? t.createdAt ?? "").slice(0, 10),
      description: t.note ?? t.counterpartyName ?? t.externalMemo ?? "CC Charge",
      counterpartyName: t.counterpartyName ?? null,
      amount: Math.abs(t.amount),
      isCharge: t.amount < 0,
      status: t.status,
      kind: t.kind,
    }));

  return NextResponse.json({ transactions: unimported });
}

interface MercuryTxn {
  id: string;
  amount: number;
  status: string;
  kind: string;
  note?: string;
  counterpartyName?: string;
  externalMemo?: string;
  postedAt?: string;
  createdAt?: string;
}
