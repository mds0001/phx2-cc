import { NextRequest, NextResponse } from "next/server";

const MERCURY_API = "https://api.mercury.com/api/v1";
const MERCURY_CHECKING_ID = "5cb83dc0-4316-11f1-923f-5b93cd90cdab";

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.MERCURY_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function getOrCreateUsaaRecipient(): Promise<{ id: string } | { error: string }> {
  // 1. Check if USAA recipient already exists
  const listRes = await fetch(`${MERCURY_API}/recipients`, { headers: authHeaders() });
  if (listRes.ok) {
    const { recipients } = await listRes.json();
    const existing = (recipients ?? []).find(
      (r: { name?: string; electronicRoutingInfo?: { accountNumber?: string } }) =>
        r.name?.toLowerCase().includes("usaa") ||
        r.electronicRoutingInfo?.accountNumber?.endsWith("1137")
    );
    if (existing) return { id: existing.id };
  }

  // 2. Create it
  const createRes = await fetch(`${MERCURY_API}/recipients`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      name: "Michael Stout — USAA Checking",
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

// POST /api/mercury-pay
// Body: { billId, amount, note, smokeTest? }
export async function POST(req: NextRequest) {
  if (!process.env.MERCURY_API_KEY) {
    return NextResponse.json({ error: "MERCURY_API_KEY not set" }, { status: 500 });
  }

  const { billId, amount, note, smokeTest } = await req.json();
  const transferAmount = smokeTest ? 0.01 : amount;

  // Get or create the USAA recipient
  const recipient = await getOrCreateUsaaRecipient();
  if ("error" in recipient) {
    return NextResponse.json({ error: "Failed to create recipient", details: recipient.error }, { status: 500 });
  }

  // Initiate the transfer
  const idempotencyKey = `cw-pay-${billId}-${smokeTest ? "smoke" : "real"}-${Date.now()}`;

  const transferRes = await fetch(
    `${MERCURY_API}/account/${MERCURY_CHECKING_ID}/transactions`,
    {
      method: "POST",
      headers: authHeaders(),
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
