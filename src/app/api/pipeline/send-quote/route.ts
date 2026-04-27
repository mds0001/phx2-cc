import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { sendSmtpEmail } from "@/lib/smtp";
import type { SmtpConfig } from "@/lib/types";
import PDFDocument from "pdfkit";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItemInput {
  name: string;
  description: string;
  unitPriceCents: number;
  qty: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function quoteNumber(): string {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return "CW-" + ymd + "-" + rand;
}

function validUntilStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// ── PDF Generation ────────────────────────────────────────────────────────────

async function generateQuotePdf(opts: {
  quoteNum: string;
  quoteDate: string;
  validUntil: string;
  leadName: string;
  leadEmail: string | null;
  leadCompany: string | null;
  lineItems: LineItemInput[];
  totalCents: number;
  estimatedCloseDate: string | null;
  notes: string | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const indigo = "#6366f1";
    const slate900 = "#0f172a";
    const slate600 = "#475569";
    const slate300 = "#cbd5e1";
    const white = "#ffffff";
    const pageW = doc.page.width;
    const margin = 50;
    const contentW = pageW - margin * 2;

    // Header band
    doc.rect(0, 0, pageW, 80).fill(indigo);
    doc.fillColor(white).font("Helvetica-Bold").fontSize(20).text("Cloud Weaver", margin, 22);
    doc.fillColor("rgba(255,255,255,0.7)").font("Helvetica").fontSize(10).text("Threads Platform", margin, 46);
    doc.fillColor(white).font("Helvetica-Bold").fontSize(26).text("QUOTE", pageW - margin - 100, 22, { align: "right", width: 100 });

    doc.y = 100;

    // Quote meta
    const metaY = doc.y;
    doc.fillColor(slate600).font("Helvetica").fontSize(9);
    doc.text("Quote Number:", margin, metaY).text("Date Issued:", margin, metaY + 14).text("Valid Until:", margin, metaY + 28);
    doc.fillColor(slate900).font("Helvetica-Bold").fontSize(9);
    doc.text(opts.quoteNum, margin + 90, metaY).text(opts.quoteDate, margin + 90, metaY + 14).text(opts.validUntil, margin + 90, metaY + 28);

    doc.y = metaY + 54;

    // Divider
    doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor(slate300).lineWidth(0.5).stroke();
    doc.y += 16;

    // Prepared for
    doc.fillColor(slate600).font("Helvetica").fontSize(9).text("PREPARED FOR", margin, doc.y);
    doc.y += 6;
    doc.fillColor(slate900).font("Helvetica-Bold").fontSize(13).text(opts.leadName, margin, doc.y);
    doc.y += 4;
    if (opts.leadCompany) {
      doc.fillColor(slate600).font("Helvetica").fontSize(10).text(opts.leadCompany, margin, doc.y);
      doc.y += 4;
    }
    if (opts.leadEmail) {
      doc.fillColor(indigo).font("Helvetica").fontSize(10).text(opts.leadEmail, margin, doc.y);
      doc.y += 4;
    }
    doc.y += 20;

    // Line items table header
    doc.rect(margin, doc.y, contentW, 24).fill(slate900);
    const hdrY = doc.y + 8;
    doc.fillColor(white).font("Helvetica-Bold").fontSize(8);
    doc.text("PRODUCT / SERVICE", margin + 8, hdrY);
    doc.text("QTY", margin + contentW * 0.55, hdrY, { width: 40, align: "right" });
    doc.text("UNIT PRICE", margin + contentW * 0.65, hdrY, { width: 60, align: "right" });
    doc.text("TOTAL", margin + contentW * 0.82, hdrY, { width: contentW * 0.18 - 8, align: "right" });
    doc.y += 24 + 2;

    // Line item rows
    opts.lineItems.forEach((item, idx) => {
      const rowH = 36;
      const rowBg = idx % 2 === 0 ? "#f8fafc" : "#f1f5f9";
      const rowY = doc.y;
      doc.rect(margin, rowY, contentW, rowH).fill(rowBg);
      doc.fillColor(slate900).font("Helvetica-Bold").fontSize(9).text(item.name, margin + 8, rowY + 6, { width: contentW * 0.52 });
      if (item.description) {
        doc.fillColor(slate600).font("Helvetica").fontSize(7.5).text(item.description, margin + 8, rowY + 19, { width: contentW * 0.52 });
      }
      doc.fillColor(slate600).font("Helvetica").fontSize(9).text(String(item.qty), margin + contentW * 0.55, rowY + 13, { width: 40, align: "right" });
      doc.fillColor(slate600).font("Helvetica").fontSize(9).text(formatCurrency(item.unitPriceCents), margin + contentW * 0.65, rowY + 13, { width: 60, align: "right" });
      doc.fillColor(slate900).font("Helvetica-Bold").fontSize(9).text(formatCurrency(item.unitPriceCents * item.qty), margin + contentW * 0.82, rowY + 13, { width: contentW * 0.18 - 8, align: "right" });
      doc.y += rowH;
    });

    doc.y += 2;

    // Total bar
    doc.rect(margin, doc.y, contentW, 28).fill(indigo);
    const totY = doc.y + 8;
    doc.fillColor(white).font("Helvetica-Bold").fontSize(10).text("TOTAL", margin + 8, totY);
    doc.fillColor(white).font("Helvetica-Bold").fontSize(14).text(formatCurrency(opts.totalCents), margin + 8, totY - 2, { width: contentW - 16, align: "right" });
    doc.y += 30 + 20;

    // Terms
    if (opts.estimatedCloseDate) {
      doc.fillColor(slate600).font("Helvetica").fontSize(9).text("Estimated decision by: " + formatDate(opts.estimatedCloseDate), margin, doc.y);
      doc.y += 14;
    }
    doc.fillColor(slate600).font("Helvetica").fontSize(9).text(
      "This quote is valid for 30 days from the date of issue. To accept, reply to this email or contact your Cloud Weaver representative.",
      margin, doc.y, { width: contentW }
    );
    if (opts.notes) {
      doc.y += 16;
      doc.fillColor(slate900).font("Helvetica-Bold").fontSize(9).text("Notes", margin, doc.y);
      doc.y += 4;
      doc.fillColor(slate600).font("Helvetica").fontSize(9).text(opts.notes, margin, doc.y, { width: contentW });
    }

    // Footer
    const footerY = doc.page.height - 40;
    doc.moveTo(margin, footerY - 10).lineTo(pageW - margin, footerY - 10).strokeColor(slate300).lineWidth(0.5).stroke();
    doc.fillColor(slate600).font("Helvetica").fontSize(8).text("Cloud Weaver  \u00b7  threads.cloudweavr.com  \u00b7  Questions? Reply to this email.", margin, footerY, { align: "center", width: contentW });

    doc.end();
  });
}

// ── HTML email ─────────────────────────────────────────────────────────────────────────────

function buildQuoteHtml(opts: {
  quoteNum: string;
  quoteDate: string;
  validUntil: string;
  leadName: string;
  leadEmail: string | null;
  leadCompany: string | null;
  lineItems: LineItemInput[];
  totalCents: number;
}): string {
  // Single quotes for HTML attribute values avoid TS double-quote string parsing issues
  const rowsHtml = opts.lineItems.map((item, idx) => {
    const bg = idx % 2 === 0 ? "#f8fafc" : "#f1f5f9";
    const lineTotal = item.unitPriceCents * item.qty;
    const descHtml = item.description
      ? "<br><span style='font-weight:400;font-size:11px;color:#64748b'>" + item.description + "</span>"
      : "";
    return (
      "<tr style='background:" + bg + "'>" +
        "<td style='padding:10px 12px;font-weight:600;font-size:13px'>" + item.name + descHtml + "</td>" +
        "<td style='padding:10px 12px;text-align:center;color:#64748b;font-size:13px'>" + item.qty + "</td>" +
        "<td style='padding:10px 12px;text-align:right;color:#64748b;font-size:13px'>" + formatCurrency(item.unitPriceCents) + "</td>" +
        "<td style='padding:10px 12px;text-align:right;font-weight:700;font-size:13px;color:#0f172a'>" + formatCurrency(lineTotal) + "</td>" +
      "</tr>"
    );
  }).join("");

  const companyRow = opts.leadCompany
    ? "<td style='padding:4px 0'>Company</td><td style='padding:4px 0;font-weight:600;color:#0f172a'>" + opts.leadCompany + "</td>"
    : "<td></td><td></td>";

  return (
    "<!DOCTYPE html><html><body style='font-family:sans-serif;color:#0f172a;background:#f1f5f9;margin:0;padding:32px'>" +
    "<div style='max-width:580px;margin:0 auto'>" +
    "<div style='background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);border-radius:12px 12px 0 0;padding:28px 32px'>" +
      "<div style='display:flex;justify-content:space-between;align-items:center'>" +
        "<div>" +
          "<div style='color:#fff;font-size:20px;font-weight:700'>Cloud Weaver</div>" +
          "<div style='color:rgba(255,255,255,0.7);font-size:12px;margin-top:2px'>Threads Platform</div>" +
        "</div>" +
        "<div style='color:#fff;font-size:28px;font-weight:800;letter-spacing:2px'>QUOTE</div>" +
      "</div>" +
    "</div>" +
    "<div style='background:#fff;border:1px solid #e2e8f0;border-top:none;padding:32px;border-radius:0 0 12px 12px'>" +
      "<p style='margin:0 0 4px;font-size:13px;color:#64748b'>Hi " + opts.leadName + ",</p>" +
      "<p style='margin:0 0 24px;font-size:14px;color:#475569'>Thank you for your interest in the Threads Platform. Your quote is attached as a PDF and summarised below.</p>" +
      "<table style='width:100%;border-collapse:collapse;font-size:12px;color:#64748b;margin-bottom:24px'>" +
        "<tr>" +
          "<td style='padding:4px 0;width:120px'>Quote Number</td>" +
          "<td style='padding:4px 0;font-weight:600;color:#0f172a'>" + opts.quoteNum + "</td>" +
          "<td style='padding:4px 0;width:100px'>Date Issued</td>" +
          "<td style='padding:4px 0;font-weight:600;color:#0f172a'>" + opts.quoteDate + "</td>" +
        "</tr>" +
        "<tr>" +
          "<td style='padding:4px 0'>Valid Until</td>" +
          "<td style='padding:4px 0;font-weight:600;color:#0f172a'>" + opts.validUntil + "</td>" +
          companyRow +
        "</tr>" +
      "</table>" +
      "<table style='width:100%;border-collapse:collapse;font-size:13px;margin-bottom:4px'>" +
        "<thead><tr style='background:#0f172a;color:#fff'>" +
          "<th style='text-align:left;padding:10px 12px;border-radius:6px 0 0 0;font-size:11px;font-weight:600;letter-spacing:.5px'>PRODUCT / SERVICE</th>" +
          "<th style='text-align:center;padding:10px 12px;font-size:11px;font-weight:600;letter-spacing:.5px;width:50px'>QTY</th>" +
          "<th style='text-align:right;padding:10px 12px;font-size:11px;font-weight:600;letter-spacing:.5px;width:100px'>UNIT PRICE</th>" +
          "<th style='text-align:right;padding:10px 12px;border-radius:0 6px 0 0;font-size:11px;font-weight:600;letter-spacing:.5px;width:100px'>TOTAL</th>" +
        "</tr></thead>" +
        "<tbody>" + rowsHtml + "</tbody>" +
      "</table>" +
      "<div style='background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);border-radius:0 0 6px 6px;padding:12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:28px'>" +
        "<span style='color:#fff;font-weight:600;font-size:13px'>TOTAL</span>" +
        "<span style='color:#fff;font-weight:800;font-size:18px'>" + formatCurrency(opts.totalCents) + "</span>" +
      "</div>" +
      "<p style='font-size:12px;color:#64748b;margin:0 0 20px'>This quote is valid for 30 days. To accept, simply reply to this email or contact your Cloud Weaver representative.</p>" +
      "<a href='https://threads.cloudweavr.com' style='display:inline-block;padding:10px 22px;background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);color:#fff;font-size:13px;font-weight:600;text-decoration:none;border-radius:8px'>Visit Threads</a>" +
    "</div>" +
    "<p style='text-align:center;font-size:11px;color:#94a3b8;margin-top:20px'>Cloud Weaver · threads.cloudweavr.com</p>" +
    "</div></body></html>"
  );
}
// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { opportunityId?: string; lineItems?: LineItemInput[] };
    const { opportunityId, lineItems } = body;
    if (!opportunityId) {
      return NextResponse.json({ error: "opportunityId required" }, { status: 400 });
    }
    if (!lineItems || lineItems.length === 0) {
      return NextResponse.json({ error: "lineItems required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: opp, error: oppErr } = await admin
      .from("opportunities")
      .select("*, leads(name, email, company)")
      .eq("id", opportunityId)
      .single();

    if (oppErr || !opp) {
      return NextResponse.json({ error: oppErr?.message ?? "Opportunity not found" }, { status: 404 });
    }

    const lead = opp.leads as { name: string; email: string | null; company: string | null } | null;
    if (!lead?.email) {
      return NextResponse.json({ error: "Lead has no email address" }, { status: 422 });
    }

    // Resolve admin email for CC if requested
    let adminEmail: string | null = null;
    if (opp.send_to_admin) {
      const { data: adminProfiles } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "administrator")
        .limit(1);
      if (adminProfiles && adminProfiles.length > 0) {
        const adminUser = await admin.auth.admin.getUserById(adminProfiles[0].id);
        adminEmail = adminUser.data.user?.email ?? null;
      }
    }
    // In dev/sandbox mode, RESEND_TO_OVERRIDE redirects all emails to one address
    const toOverride = process.env.RESEND_TO_OVERRIDE ?? null;
    const toAddresses = toOverride
      ? [toOverride]
      : adminEmail && adminEmail !== lead.email
        ? [lead.email, adminEmail]
        : [lead.email];

    const totalCents = lineItems.reduce((sum: number, item: LineItemInput) => sum + item.unitPriceCents * item.qty, 0);
    const qNum = quoteNumber();
    const qDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const qValid = validUntilStr();

    const pdfBuffer = await generateQuotePdf({
      quoteNum: qNum,
      quoteDate: qDate,
      validUntil: qValid,
      leadName: lead.name,
      leadEmail: lead.email,
      leadCompany: lead.company,
      lineItems,
      totalCents,
      estimatedCloseDate: opp.estimated_close_date,
      notes: opp.notes,
    });

    const toOverrideActive = !!(process.env.RESEND_TO_OVERRIDE);
    const subject = toOverrideActive
      ? "[TEST → " + lead.email + "] Your Quote from Cloud Weaver (" + qNum + ")"
      : "Your Quote from Cloud Weaver (" + qNum + ")";
    const textLines = [
      "Hi " + lead.name + ",",
      "",
      "Thank you for your interest in the Threads Platform. Please find your quote attached.",
      "",
      "Quote Number:  " + qNum,
      "Date Issued:   " + qDate,
      "Valid Until:   " + qValid,
      "",
      ...lineItems.map((item: LineItemInput) => "  " + item.name + " x" + item.qty + "  " + formatCurrency(item.unitPriceCents * item.qty)),
      "",
      "Total: " + formatCurrency(totalCents),
      "",
      "To accept, reply to this email.",
      "",
      "\u2014 Cloud Weaver",
      "   threads.cloudweavr.com",
    ];

    const htmlBody = buildQuoteHtml({ quoteNum: qNum, quoteDate: qDate, validUntil: qValid, leadName: lead.name, leadEmail: lead.email, leadCompany: lead.company, lineItems, totalCents });

    const resendApiKey = process.env.RESEND_API_KEY;

    async function sendViaResend(apiKey: string, fromAddr: string) {
      const attachmentB64 = pdfBuffer.toString("base64");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Cloud Weaver <" + fromAddr + ">", to: toAddresses, subject, html: htmlBody, text: textLines.join("\n"), attachments: [{ filename: "Quote-" + qNum + ".pdf", content: attachmentB64 }] }),
      });
      if (!res.ok) {
        const b = await res.text().catch(() => "(no body)");
        throw new Error("Resend API error " + res.status + ": " + b);
      }
    }

    if (resendApiKey) {
      await sendViaResend(resendApiKey, "onboarding@resend.dev");
    } else {
      const { data: smtpConnections } = await admin
        .from("endpoint_connections")
        .select("config")
        .eq("type", "smtp")
        .limit(1);

      const smtpConfig = (smtpConnections?.[0]?.config ?? null) as import("@/lib/types").SmtpConfig | null;
      if (!smtpConfig?.server) {
        return NextResponse.json({ error: "No email service configured (set RESEND_API_KEY or add an SMTP connection)" }, { status: 503 });
      }

      const isResend = smtpConfig.server.toLowerCase().includes("resend.com");
      const fromAddress = smtpConfig.from_address || (isResend ? "onboarding@resend.dev" : smtpConfig.login_name);

      if (isResend) {
        await sendViaResend(smtpConfig.password, fromAddress);
      } else {
        await sendSmtpEmail({
          server: smtpConfig.server,
          port: parseInt(smtpConfig.port, 10) || 587,
          login_name: smtpConfig.login_name,
          password: smtpConfig.password,
          from: fromAddress,
          to: toAddresses,
          subject,
          text: textLines.join("\n"),
          html: htmlBody,
          attachments: [{ filename: "Quote-" + qNum + ".pdf", content: pdfBuffer, contentType: "application/pdf" }],
        });
      }
    }

    const sentAt = new Date().toISOString();
    const noteEntry = "[" + new Date().toLocaleDateString("en-US") + "] Quote " + qNum + " sent to " + lead.email;
    const existingNotes = opp.notes ? opp.notes.trim() : "";
    const updatedNotes = existingNotes ? existingNotes + "\n" + noteEntry : noteEntry;

    await admin.from("opportunities").update({ quote_sent_at: sentAt, notes: updatedNotes }).eq("id", opportunityId);

    console.log("[send-quote] Quote " + qNum + " sent to " + lead.email);
    return NextResponse.json({ success: true, quoteNumber: qNum, sentTo: lead.email, sentAt });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-quote] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
