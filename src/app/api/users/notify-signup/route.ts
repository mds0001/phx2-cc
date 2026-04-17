import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { sendSmtpEmail } from "@/lib/smtp";
import type { SmtpConfig } from "@/lib/types";

/** Send via Resend HTTP API — simpler and more reliable than raw SMTP for Resend accounts. */
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

export async function POST(req: NextRequest) {
  try {
    const { email, first_name, last_name } = await req.json() as {
      email?: string;
      first_name?: string;
      last_name?: string;
    };

    if (!email) {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Fetch all administrator emails
    const { data: adminProfiles } = await admin
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("role", "administrator");

    const adminEmails = (adminProfiles ?? [])
      .map((p) => p.email)
      .filter((e): e is string => !!e);

    if (adminEmails.length === 0) {
      console.log("[notify-signup] No administrators found to notify");
      return NextResponse.json({ success: true, notified: 0 });
    }

    const displayName = [first_name, last_name].filter(Boolean).join(" ") || email;
    const subject = `New User Registration — LuminaGrid`;
    const text = [
      `A new user has registered on LuminaGrid and is awaiting role assignment.`,
      ``,
      `Name:   ${displayName}`,
      `Email:  ${email}`,
      `Status: Basic (read-only access)`,
      ``,
      `Please log in to User Management to review and assign an appropriate role.`,
      ``,
      `— LuminaGrid`,
    ].join("\n");

    const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1e293b;background:#f8fafc;margin:0;padding:32px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:32px">
    <div style="font-size:22px;font-weight:700;color:#6366f1;margin-bottom:8px">LuminaGrid</div>
    <h2 style="font-size:16px;font-weight:600;margin:0 0 20px">New User Registration</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#475569">
      A new user has registered and is awaiting role assignment.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:6px 0 0 0;font-weight:600;color:#64748b;width:80px">Name</td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 0 0">${displayName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;font-weight:600;color:#64748b">Email</td>
        <td style="padding:8px 12px;background:#f8fafc">${email}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:0 0 0 6px;font-weight:600;color:#64748b">Status</td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 0 6px 0">
          <span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:20px;font-size:12px;font-weight:600">Basic — Read Only</span>
        </td>
      </tr>
    </table>
    <a href="https://phx2-cc.vercel.app/login" style="display:inline-block;margin-top:8px;padding:10px 20px;background:linear-gradient(135deg,#00c8ff 0%,#7B61FF 100%);color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
      Open LuminaGrid →
    </a>
  </div>
</body>
</html>`;

    // Prefer RESEND_API_KEY env var; fall back to SMTP connection config
    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
      await sendViaResend({
        apiKey: resendApiKey,
        from: "LuminaGrid <onboarding@resend.dev>",
        to: adminEmails,
        subject,
        html,
        text,
      });
    } else {
      // Fall back to SMTP connection config
      const { data: smtpConnections } = await admin
        .from("endpoint_connections")
        .select("config")
        .eq("type", "smtp")
        .limit(1);

      const smtpConfig = (smtpConnections?.[0]?.config ?? null) as SmtpConfig | null;

      if (!smtpConfig?.server) {
        console.warn("[notify-signup] No RESEND_API_KEY or SMTP connection configured — skipping");
        return NextResponse.json({ success: true, notified: 0, warning: "No email service configured" });
      }

      const isResend = smtpConfig.server.toLowerCase().includes("resend.com");
      const fromAddress = smtpConfig.from_address || (isResend ? "onboarding@resend.dev" : smtpConfig.login_name);

      if (isResend) {
        await sendViaResend({
          apiKey: smtpConfig.password,
          from: `LuminaGrid <${fromAddress}>`,
          to: adminEmails,
          subject,
          html,
          text,
        });
      } else {
        await sendSmtpEmail({
          server: smtpConfig.server,
          port: parseInt(smtpConfig.port, 10) || 587,
          login_name: smtpConfig.login_name,
          password: smtpConfig.password,
          from: fromAddress,
          to: adminEmails,
          subject,
          text,
          html,
        });
      }
    }

    console.log(`[notify-signup] Notified ${adminEmails.length} admin(s) about new user: ${email}`);
    return NextResponse.json({ success: true, notified: adminEmails.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[notify-signup] Error:", msg);
    // Don't surface email failures to the user — signup should still succeed
    return NextResponse.json({ success: true, error: msg });
  }
}
