import { NextRequest, NextResponse } from "next/server";
import { mercuryFetch } from "@/lib/mercury";

const MERCURY_CHECKING_ID = "5cb83dc0-4316-11f1-923f-5b93cd90cdab";

async function getOrCreateUsaaRecipient(): Promise<{ id: string } | { error: string }> {
  const listRes = await mercuryFetch("/recipients");
  if (listRes.ok) {
    const { recipients } = await listRes.json();
    const existing = (recipients ?? []).find(
      (r: { name?: string; electronicRoutingInfo?: { accountNumber?: string } }) =>
        r.name?.toLowerCase().includes("usaa") ||
        r.electronicRoutingInfo?.accountNumber?.endsWith("1137")
    );
    if (existing) return { id: existing.id };
  }

  const createRes = await mercuryFetch("/recipients", {
    method: "POST",
    body: JSON.stringify({
      name: "Michael Stout \xe2\x80\x94 USAA Checking",
      emails: ["mdstout@outlook.com"],
      accountType: "personalChecking",
      routingNumber: process.env.MERCURY_USAA_ROUTING,
      accountNumber: process.env.MERCURY_USAA_ACCOUNT,
      paymentMethod: "ach",
    }),
  });

  const created = await createRes.json();
  if (!createRes.ok) return { error: JSON.stringify(created) };
  return { id: created.id };
}

export async function POST(req: NextRequest) {
  const { billId, amount, note, smokeTest } = await req.json();
  const transferAmount = smokeTest ? 0.01 : amount;

  const recipient = await getOrCreateUsaaRecipient();
  if ("error" in recipient) {
    return NextResponse.json({ error: "Failed to create recipient", details: recipient.error }, { status: 500 });
  }

  const idempotencyKey = `cw-pay-${billId}-${smokeTest ? "smoke" : "real"}-${Date.now()}`;

  const transferRes = await mercuryFetch(
    `/accounts/${MERCURY_CHECKING_ID}/transactions`,
    {
      method: "POST",
      body: JSON.stringify({
        recipientId: recipient.id,
        amount: transferAmount,
        paymentMethod: "ach",
        idempotencyKey,
        note: smokeTest ? `[SMOKE TEST $0.01] ${note}` : note,
      }),
    }
  );

  const transferData = await transferRes.json();

  if (!transferRes.ok) {
    return NextResponse.json(
      { error: "Mercury transfer failed", details: transferData },
      { status: transferRes.status }
    );
  }

  return NextResponse.json({
    success: true,
    mercuryTransactionId: transferData.id,
    recipientId: recipient.id,
    amount: transferAmount,
    smokeTest: !!smokeTest,
  });
}
