export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { mercuryFetch } from "@/lib/mercury";

const MERCURY_CC_ID = "f61b1d82-44df-11f1-a091-cf2256cd9db3";

export async function GET() {
  // CC is a Mercury credit account. The /account/{id}/transactions endpoint returns 404
  // for credit accounts. Use the global /transactions endpoint with accountId as a filter.
  const res = await mercuryFetch(`/transactions?accountId=${MERCURY_CC_ID}&limit=500&order=desc`);

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: "Mercury fetch failed", status: res.status, body: text }, { status: res.status });
  }

  const { transactions = [] } = await res.json();

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("cw_bills")
    .select("mercury_transaction_id")
    .not("mercury_transaction_id", "is", null);

  const importedIds = new Set((existing ?? []).map((r: { mercury_transaction_id: string }) => r.mercury_transaction_id));

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
