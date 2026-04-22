import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-admin";
import type { SmtpConfig } from "@/lib/types";
import nodemailer from "nodemailer";

export interface SendNotificationBody {
  /** ID of the scheduled task (used to look up smtp connection if not provided) */
  taskId:       string;
  /** "fixed" | "stuck" */
  status:       "fixed" | "stuck";
  /** Human-readable summary of what happened */
  message:      string;
  /** Number of iterations it took */
  iterations:   number;
  /** Recipient email — falls back to the task's ai_fix_email, then the creator's email */
  toEmail?:     string;
  /** Override SMTP connection — falls back to task's ai_fix_smtp_connection_id */
  smtpConnectionId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SendNotificationBody;
    const { taskId, status, message, iterations, toEmail, smtpConnectionId } = body;

    const supabase = createClient();

    // ── Resolve task + smtp connection ────────────────────────────────────────
    const { data: task, error: taskErr } = await supabase
      .from("scheduled_tasks")
      .select("task_name, ai_fix_smtp_connection_id, ai_fix_email, created_by")
      .eq("id", taskId)
      .single();

    if (taskErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const connectionId = smtpConnectionId ?? task.ai_fix_smtp_connection_id;
    if (!connectionId) {
      return NextResponse.json({ error: "No SMTP connection configured for this task" }, { status: 400 });
    }

    const { data: conn, error: connErr } = await supabase
      .from("endpoint_connections")
      .select("config")
      .eq("id", connectionId)
      .single();

    if (connErr || !conn) {
      return NextResponse.json({ error: "SMTP connection not found" }, { status: 404 });
    }

    const smtp = conn.config as SmtpConfig;

    // ── Resolve recipient ─────────────────────────────────────────────────────
    let recipient = toEmail ?? task.ai_fix_email ?? null;
    if (!recipient && task.created_by) {
      // Fall back to the task creator's profile email
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", task.created_by)
        .single();
      recipient = (profile as { email?: string } | null)?.email ?? null;
    }
    if (!recipient) {
      return NextResponse.json({ error: "No recipient email resolved" }, { status: 400 });
    }

    // ── Build email ───────────────────────────────────────────────────────────
    const isFixed = status === "fixed";
    const subject = isFixed
      ? `✅ Task fixed: ${task.task_name}`
      : `⚠️ Task stuck after ${iterations} attempts: ${task.task_name}`;

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:${isFixed ? "#16a34a" : "#d97706"}">
          ${isFixed ? "✅ Run Until Fixed — Resolved" : "⚠️ Run Until Fixed — Stuck"}
        </h2>
        <p><strong>Task:</strong> ${task.task_name}</p>
        <p><strong>Status:</strong> ${isFixed ? "Fixed successfully" : `Could not resolve after ${iterations} attempt${iterations !== 1 ? "s" : ""}`}</p>
        <p><strong>Iterations:</strong> ${iterations}</p>
        <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-top:16px">
          <p style="margin:0;white-space:pre-wrap;font-size:14px">${message}</p>
        </div>
        <p style="color:#71717a;font-size:12px;margin-top:24px">Sent by PHX2 autonomous task runner</p>
      </div>
    `;

    // ── Send ──────────────────────────────────────────────────────────────────
    const transporter = nodemailer.createTransport({
      host:   smtp.server,
      port:   smtp.port,
      secure: smtp.port === 465,
      auth: {
        user: smtp.login_name,
        pass: smtp.password,
      },
    });

    await transporter.sendMail({
      from: smtp.from_address ?? smtp.login_name,
      to:   recipient,
      subject,
      html,
    });

    return NextResponse.json({ ok: true, to: recipient, subject });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[send-notification] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
