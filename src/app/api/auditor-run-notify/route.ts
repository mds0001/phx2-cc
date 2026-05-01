import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import type { SmtpConfig } from "@/lib/types";

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

export async function POST(req: NextRequest) {
  try {
    const {
      task_id,
      task_name,
      customer_id,
      status,
      duration,
      rows_processed,
      rows_created,
      rows_updated,
      rows_skipped,
      rows_errors,
      warnings,
    } = (await req.json()) as {
      task_id: string;
      task_name: string;
      customer_id: string | null;
      status: string;
      duration: string;
      rows_processed: number;
      rows_created: number;
      rows_updated: number;
      rows_skipped: number;
      rows_errors: number;
      warnings: number;
    };

    if (!customer_id) return NextResponse.json({ skipped: "no customer_id" });

    const admin = createAdminClient();

    // Find auditors scoped to this customer
    const { data: auditorRoles } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "schedule_auditor")
      .eq("customer_id", customer_id);

    const auditorIds = (auditorRoles ?? []).map((r) => r.user_id);
    let recipients: string[] = [];
    if (auditorIds.length > 0) {
      const { data: auditors } = await admin
        .from("profiles")
        .select("email, first_name")
        .in("id", auditorIds);
      recipients = (auditors ?? [])
        .map((a) => a.email)
        .filter((e): e is string => !!e);
    }

    if (recipients.length === 0) return NextResponse.json({ skipped: "no auditors" });

    // Build status color
    const isError   = status.toLowerCase().includes("error");
    const isWarning = status.toLowerCase().includes("warning");
    const statusColor = isError ? "#dc2626" : isWarning ? "#d97706" : "#16a34a";

    const subject = `[Threads] Task Complete: ${task_name} — ${status}`;

    const text = [
      `Task run complete.`,
      ``,
      `Task:     ${task_name}`,
      `Status:   ${status}`,
      `Duration: ${duration}`,
      ``,
      `Rows Processed: ${rows_processed}`,
      `  Created:  ${rows_created}`,
      `  Updated:  ${rows_updated}`,
      `  Skipped:  ${rows_skipped}`,
      `  Errors:   ${rows_errors}`,
      `  Warnings: ${warnings}`,
      ``,
      `— Threads by Cloud Weaver`,
    ].join("\n");

    const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1e293b;background:#f8fafc;margin:0;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:32px">
    <div style="font-size:22px;font-weight:700;color:#6366f1;margin-bottom:8px">Threads by Cloud Weaver</div>
    <h2 style="font-size:16px;font-weight:600;margin:0 0 4px;color:#1e293b">Task Run Complete</h2>
    <p style="font-size:13px;color:#64748b;margin:0 0 20px">${task_name}</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:6px 0 0 0;font-weight:600;color:#64748b;width:110px">Status</td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 0 0;font-weight:700;color:${statusColor}">${status}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;font-weight:600;color:#64748b">Duration</td>
        <td style="padding:8px 12px;background:#f8fafc">${duration}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;font-weight:600;color:#64748b">Processed</td>
        <td style="padding:8px 12px;background:#f8fafc">${rows_processed} rows</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;font-weight:600;color:#64748b">Created</td>
        <td style="padding:8px 12px;background:#f8fafc">${rows_created}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;font-weight:600;color:#64748b">Updated</td>
        <td style="padding:8px 12px;background:#f8fafc">${rows_updated}</td>
      </tr>
      ${rows_skipped > 0 ? `<tr>
        <td style="padding:8px 12px;background:#f1f5f9;font-weight:600;color:#64748b">Skipped</td>
        <td style="padding:8px 12px;background:#f8fafc;color:#d97706">${rows_skipped}</td>
      </tr>` : ""}
      ${rows_errors > 0 ? `<tr>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:0 0 0 6px;font-weight:600;color:#64748b">Errors</td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 0 6px 0;color:#dc2626;font-weight:600">${rows_errors}</td>
      </tr>` : ""}
      ${warnings > 0 ? `<tr>
        <td style="padding:8px 12px;background:#f1f5f9;font-weight:600;color:#64748b">Warnings</td>
        <td style="padding:8px 12px;background:#f8fafc;color:#d97706">${warnings}</td>
      </tr>` : ""}
    </table>

    <p style="font-size:12px;color:#94a3b8;margin:0">You are receiving this because you are a Schedule Auditor for this customer in Threads.</p>
  </div>
</body>
</html>`;

    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      await sendViaResend({
        apiKey: resendApiKey,
        from: "Threads by Cloud Weaver <onboarding@resend.dev>",
        to: recipients, subject, html, text,
      });
    } else {
      const { data: smtpConns } = await admin
        .from("endpoint_connections")
        .select("config").eq("type", "smtp").limit(1);
      const smtpConfig = (smtpConns?.[0]?.config ?? null) as SmtpConfig | null;
      if (!smtpConfig?.server) return NextResponse.json({ skipped: "no smtp config" });
      const isResend = smtpConfig.server.toLowerCase().includes("resend.com");
      const fromAddr = smtpConfig.from_address || (isResend ? "onboarding@resend.dev" : smtpConfig.login_name);
      if (isResend) {
        await sendViaResend({ apiKey: smtpConfig.password, from: `Threads by Cloud Weaver <${fromAddr}>`, to: recipients, subject, html, text });
      } else {
        const { sendSmtpEmail } = await import("@/lib/smtp");
        await sendSmtpEmail({ server: smtpConfig.server, port: parseInt(smtpConfig.port, 10) || 587, login_name: smtpConfig.login_name, password: smtpConfig.password, from: fromAddr, to: recipients, subject, text, html });
      }
    }

    return NextResponse.json({ sent: recipients.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auditor-run-notify] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
