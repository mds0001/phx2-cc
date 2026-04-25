import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import type { SmtpConfig } from "@/lib/types";

type ResultField = "type" | "subtype" | "description" | "model" | "manufacturer";

function result(found: boolean, value: string | null, sku: string) {
  return NextResponse.json({ found, value, sku });
}

/** Send via Resend HTTP API */
async function sendViaResend(opts: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: opts.from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
}

async function notifyAdmins(sku: string, seenCount: number) {
  try {
    const admin = createAdminClient();

    const { data: adminProfiles } = await admin
      .from("profiles")
      .select("email")
      .eq("role", "administrator");

    const adminEmails = (adminProfiles ?? []).map((p) => p.email).filter((e): e is string => !!e);
    if (adminEmails.length === 0) return;

    const subject = `SKU Research Required — Unrecognized SKU: ${sku}`;
    const text = [
      `An unrecognized manufacturer SKU was encountered during an import run and requires research.`,
      ``,
      `SKU:       ${sku}`,
      `Seen:      ${seenCount} time(s)`,
      ``,
      `Please log in to Threads → Management → SKU Research to classify this SKU.`,
      `Until it is resolved, rows containing this SKU will be skipped at import time.`,
      ``,
      `— Threads by Cloud Weaver`,
    ].join("\n");

    const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1e293b;background:#f8fafc;margin:0;padding:32px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:32px">
    <div style="font-size:22px;font-weight:700;color:#6366f1;margin-bottom:8px">Threads by Cloud Weaver</div>
    <h2 style="font-size:16px;font-weight:600;margin:0 0 20px;color:#dc2626">SKU Research Required</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#475569">
      An unrecognized manufacturer SKU was encountered during an import run and could not be classified.
      The affected row(s) were skipped.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:6px 0 0 6px;font-weight:600;color:#64748b;width:80px">SKU</td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-family:monospace;color:#1e293b">${sku}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:6px 0 0 6px;font-weight:600;color:#64748b">Seen</td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0">${seenCount} time(s)</td>
      </tr>
    </table>
    <p style="font-size:13px;color:#64748b;margin:0 0 20px">
      Rows containing this SKU will continue to be skipped until a taxonomy entry is created.
    </p>
    <a href="https://cloudweavr.com/boh/sku-research" style="display:inline-block;padding:10px 20px;background:linear-gradient(135deg,#00c8ff 0%,#7B61FF 100%);color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
      Open SKU Research →
    </a>
  </div>
</body>
</html>`;

    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      await sendViaResend({
        apiKey: resendApiKey,
        from: "Threads by Cloud Weaver <onboarding@resend.dev>",
        to: adminEmails, subject, html, text,
      });
    } else {
      const { data: smtpConns } = await admin
        .from("endpoint_connections")
        .select("config").eq("type", "smtp").limit(1);
      const smtpConfig = (smtpConns?.[0]?.config ?? null) as SmtpConfig | null;
      if (!smtpConfig?.server) return;
      const isResend = smtpConfig.server.toLowerCase().includes("resend.com");
      const fromAddr = smtpConfig.from_address || (isResend ? "onboarding@resend.dev" : smtpConfig.login_name);
      if (isResend) {
        await sendViaResend({ apiKey: smtpConfig.password, from: `Threads by Cloud Weaver <${fromAddr}>`, to: adminEmails, subject, html, text });
      } else {
        const { sendSmtpEmail } = await import("@/lib/smtp");
        await sendSmtpEmail({ server: smtpConfig.server, port: parseInt(smtpConfig.port, 10) || 587, login_name: smtpConfig.login_name, password: smtpConfig.password, from: fromAddr, to: adminEmails, subject, text, html });
      }
    }
  } catch (e) {
    console.error("[sku-lookup] Email notify failed:", e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { sku, result_field, customer_id, context } = (await req.json()) as {
      sku?: string;
      result_field?: ResultField;
      customer_id?: string | null;
      context?: Record<string, string> | null;
    };

    if (!sku) return NextResponse.json({ error: "sku required" }, { status: 400 });

    const normalizedSku = sku.trim().toUpperCase();
    const admin = createAdminClient();

    // 1. Check taxonomy — use limit(1) instead of single() to avoid URL encoding
    //    issues with special characters like '#' in SKU names.
    const { data: taxRows } = await admin
      .from("sku_taxonomy")
      .select("type, subtype, description, model, manufacturer")
      .eq("manufacturer_sku", normalizedSku)
      .limit(1);

    const taxonomy = taxRows?.[0] ?? null;

    if (taxonomy) {
      const field = result_field ?? "type";
      const value = (taxonomy as Record<string, string | null>)[field] ?? null;
      return result(true, value, normalizedSku);
    }

    // 2. Not found in taxonomy — check queue status before queuing
    const { data: queueRows } = await admin
      .from("sku_research_queue")
      .select("id, seen_count, status")
      .eq("manufacturer_sku", normalizedSku)
      .limit(1);

    const existing = queueRows?.[0] ?? null;

    // If permanently ignored, treat as silently skipped — no exception, no re-queue
    if (existing?.status === "ignored") {
      return result(false, "__IGNORED__", normalizedSku);
    }

    let newSeenCount = 1;

    if (existing) {
      // Already queued — increment seen_count and update last_seen_at
      newSeenCount = (existing.seen_count ?? 0) + 1;
      await admin
        .from("sku_research_queue")
        .update({
          seen_count:   newSeenCount,
          last_seen_at: new Date().toISOString(),
          // Reset to pending if skipped (soft dismiss). Ignored is permanent — never re-queue.
          ...(existing.status === "skipped" ? { status: "pending" } : {}),
        })
        .eq("manufacturer_sku", normalizedSku);
    } else {
      // First time seeing this SKU
      await admin.from("sku_research_queue").insert({
        manufacturer_sku: normalizedSku,
        status:           "pending",
        seen_count:       1,
        customer_id:      customer_id ?? null,
        context:          context ?? null,
      });
    }

    // 3. Email admins (fire-and-forget, only on first encounter or every 10 sightings)
    if (!existing || newSeenCount % 10 === 0) {
      notifyAdmins(normalizedSku, newSeenCount).catch(() => {});
    }

    return result(false, null, normalizedSku);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sku-lookup] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET: resolve a full taxonomy entry by SKU (used by research UI)
export async function GET(req: NextRequest) {
  const sku = req.nextUrl.searchParams.get("sku");
  if (!sku) return NextResponse.json({ error: "sku required" }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("sku_taxonomy")
    .select("*")
    .eq("manufacturer_sku", sku.trim().toUpperCase())
    .single();

  return NextResponse.json({ data: data ?? null });
}
