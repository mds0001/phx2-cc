export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { mercuryFetch } from "@/lib/mercury";

const MERCURY_CHECKING_ID = "5cb83dc0-4316-11f1-923f-5b93cd90cdab";

export async function GET() {
  try {
    // Checking is a regular Mercury account, but use the global /transactions
    // endpoint with accountId as a filter for consistency with mercury-cc-sync.
    const res = await mercuryFetch(`/transactions?accountId=${MERCURY_CHECKING_ID}&limit=100&order=desc`);

    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try {
        detail = JSON.parse(text)?.errors?.message ?? text;
      } catch {}
      return NextResponse.json({ error: `Mercury fetch failed (${res.status}): ${detail}`, status: res.status }, { status: res.status });
    }

    const { transactions = [] } = await res.json();

    const deposits = transactions
      .filter((t: MercuryTxn) => t.amount > 0 && t.status !== "cancelled" && t.status !== "failed")
      .map((t: MercuryTxn) => ({
        id: t.id,
        date: (t.postedAt ?? t.createdAt ?? "").slice(0, 10),
        description: t.note ?? t.externalMemo ?? t.counterpartyName ?? "Deposit",
        counterpartyName: t.counterpartyName ?? null,
        amount: t.amount,
        status: t.status,
        kind: t.kind,
      }));

    return NextResponse.json({ deposits });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
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
