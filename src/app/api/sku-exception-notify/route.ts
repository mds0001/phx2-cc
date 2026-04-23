import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { sendSmtpEmail } from "@/lib/smtp";
import type { SmtpConfig } from "@/lib/types";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://cloudweavr.com";
const RESEARCH_URL = `${APP_URL}/boh/sku-research`;

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
    headers: {
      "Authorization": `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

/**
 * POST /api/sku-exception-notify
 * Called by the Scheduler after a task run completes with SKU exceptions.
 * Sends a summary email to all administrators.
 *
 * Body: {
 *   task_id:    string,
 *   task_name:  string,
 *   exceptions: { sku: string; row: number; targetField: string }[]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { task_id, task_name, exceptions } = await req.json() as {
      task_id:    string;
      task_name:  string;
      exceptions: { sku: string; row: number; targetField: string }[];
    };

    if (!exceptions?.length) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    const admin = createAdminClient();

    // Look up the task's customer name
    const { data: taskRow } = await admin
      .from("scheduled_tasks")
      .select("customer_id, customers(name)")
      .eq("id", task_id)
      .single();
    const customerName: string = (taskRow?.customers as { name?: string } | null)?.name ?? "Unknown Customer";

    // Fetch all administrator emails
    const { data: adminProfiles } = await admin
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("role", "administrator");

    const adminEmails = (adminProfiles ?? [])
      .map((p) => p.email)
      .filter((e): e is string => !!e);

    if (adminEmails.length === 0) {
      console.log("[sku-exception-notify] No administrators found to notify");
      return NextResponse.json({ success: true, notified: 0 });
    }

    // Deduplicate SKUs for the summary
    const uniqueSkus = [...new Set(exceptions.map((e) => e.sku))];
    const skuCount   = uniqueSkus.length;
    const rowCount   = exceptions.length;

    const subject = `SKU Research Required — ${skuCount} unknown SKU${skuCount !== 1 ? "s" : ""} · ${customerName} · "${task_name}"`;

    // Plain-text version
    const exceptionLines = exceptions
      .map((e) => `  Row ${e.row}: ${e.sku} (field: ${e.targetField})`)
      .join("\n");

    const text = [
      `A scheduled task has completed with ${rowCount} row${rowCount !== 1 ? "s" : ""} skipped due to unrecognised manufacturer SKUs.`,
      ``,
      `Customer: ${customerName}`,
      `Task:     ${task_name}`,
      `Job ID:   ${task_id}`,
      ``,
      `Skipped rows:`,
      exceptionLines,
      ``,
      `Please visit the SKU Research page to identify and classify these SKUs so future runs can process them:`,
      `${RESEARCH_URL}`,
      ``,
      `— Threads by Cloud Weaver`,
    ].join("\n");

    // HTML version
    const rowsHtml = exceptions
      .map(
        (e) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b">${e.row}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;font-family:monospace;font-weight:600;color:#1e293b">${e.sku}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b">${e.targetField}</td>
      </tr>`
      )
      .join("");

    const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1e293b;background:#f8fafc;margin:0;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:32px">
    <div style="font-size:22px;font-weight:700;color:#6366f1;margin-bottom:8px">Threads by Cloud Weaver</div>
    <h2 style="font-size:16px;font-weight:600;margin:0 0 8px">SKU Research Required</h2>
    <div style="margin:0 0 20px">
      <span style="display:inline-block;padding:3px 10px;background:#f1f5f9;border-radius:20px;font-size:12px;font-weight:600;color:#475569;margin-right:6px">${customerName}</span>
      <span style="font-size:13px;color:#94a3b8">${task_name}</span>
    </div>

    <p style="margin:0 0 16px;font-size:14px;color:#475569">
      ${rowCount} row${rowCount !== 1 ? "s were" : " was"} skipped during this run because
      ${skuCount === 1 ? "a manufacturer SKU was" : `${skuCount} manufacturer SKUs were`}
      not found in the taxonomy. These rows will not be imported until the SKUs are classified.
    </p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Row</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Manufacturer SKU</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Target Field</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <a href="${RESEARCH_URL}"
       style="display:inline-block;padding:10px 20px;background:linear-gradient(135deg,#00c8ff 0%,#7B61FF 100%);color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
      Open SKU Research →
    </a>

    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">
      Unknown SKUs are automatically queued in the research backlog. Once classified, re-running the task will import the previously skipped rows.
    </p>
  </div>
</body>
</html>`;

    const resendApiKey = process.env.RESEND_API_KEY;

    // Resolve SMTP config once (only needed if no Resend key)
    let smtpConfig: SmtpConfig | null = null;
    if (!resendApiKey) {
      const { data: smtpConnections } = await admin
        .from("endpoint_connections")
        .select("config")
        .eq("type", "smtp")
        .limit(1);
      smtpConfig = (smtpConnections?.[0]?.config ?? null) as SmtpConfig | null;

      if (!smtpConfig?.server) {
        console.warn("[sku-exception-notify] No RESEND_API_KEY or SMTP connection — skipping email");
        return NextResponse.json({ success: true, notified: 0, warning: "No email service configured" });
      }
    }

    const isResendSmtp = smtpConfig ? smtpConfig.server.toLowerCase().includes("resend.com") : false;
    const fromAddress  = smtpConfig
      ? (smtpConfig.from_address || (isResendSmtp ? "onboarding@resend.dev" : smtpConfig.login_name))
      : "onboarding@resend.dev";

    // Send one email per admin — skip failures so a bad address doesn't block others.
    let notified = 0;
    for (const email of adminEmails) {
      try {
        if (resendApiKey) {
          await sendViaResend({
            apiKey: resendApiKey,
            from: `Threads by Cloud Weaver <${fromAddress}>`,
            to: [email],
            subject,
            html,
            text,
          });
        } else if (isResendSmtp) {
          await sendViaResend({
            apiKey: smtpConfig!.password,
            from: `Threads by Cloud Weaver <${fromAddress}>`,
            to: [email],
            subject,
            html,
            text,
          });
        } else {
          await sendSmtpEmail({
            server:     smtpConfig!.server,
            port:       parseInt(smtpConfig!.port, 10) || 587,
            login_name: smtpConfig!.login_name,
            password:   smtpConfig!.password,
            from:       fromAddress,
            to:         [email],
            subject,
            text,
            html,
          });
        }
        notified++;
      } catch (sendErr) {
        console.warn(`[sku-exception-notify] Failed to send to ${email}:`, sendErr instanceof Error ? sendErr.message : String(sendErr));
      }
    }

    console.log(`[sku-exception-notify] Notified ${notified}/${adminEmails.length} admin(s): ${skuCount} unique SKU(s) in "${task_name}"`);
    return NextResponse.json({ success: true, notified });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sku-exception-notify] Error:", msg);
    return NextResponse.json({ success: true, error: msg }); // don't fail the task run
  }
}
