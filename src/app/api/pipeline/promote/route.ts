import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "administrator") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { leadId } = await req.json();
    if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

    // Fetch the lead
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    if (!lead.email) return NextResponse.json({ error: "Lead must have an email to promote" }, { status: 400 });

    const admin = createAdminClient();

    // Check if an opportunity already exists for this lead
    const { data: existing } = await admin
      .from("opportunities")
      .select("id")
      .eq("lead_id", leadId)
      .eq("status", "active")
      .maybeSingle();

    let opportunityId: string;

    if (existing) {
      opportunityId = existing.id;
    } else {
      // Create opportunity from lead
      const { data: opp, error: oppErr } = await admin
        .from("opportunities")
        .insert({
          lead_id: leadId,
          tier: lead.tier_interest ?? null,
          status: "active",
          notes: lead.notes ?? null,
          created_by: user.id,
        })
        .select()
        .single();

      if (oppErr || !opp) {
        return NextResponse.json({ error: oppErr?.message ?? "Failed to create opportunity" }, { status: 500 });
      }
      opportunityId = opp.id;
    }

    // Update lead status to "contacted"
    await admin.from("leads").update({ status: "contacted" }).eq("id", leadId);

    // Send onboarding email via Resend
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const firstName = lead.name?.split(" ")[0] ?? lead.name ?? "there";
      const tierLabel = lead.tier_interest
        ? lead.tier_interest.charAt(0).toUpperCase() + lead.tier_interest.slice(1)
        : "Threads";

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Threads by Cloud Weaver <onboarding@resend.dev>",
          to: [lead.email],
          subject: `Welcome to Threads${lead.tier_interest ? ` ${tierLabel}` : ""} — let's get you started`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0">
              <div style="font-size:20px;font-weight:700;color:#6366f1;margin-bottom:24px">Threads by Cloud Weaver</div>
              <p style="font-size:16px;color:#1e293b;margin:0 0 16px">Hi ${firstName},</p>
              <p style="color:#475569;line-height:1.6;margin:0 0 16px">
                Thanks for your interest in Threads${lead.tier_interest ? ` ${tierLabel}` : ""}! We're excited to help you automate your data workflows.
              </p>
              <p style="color:#475569;line-height:1.6;margin:0 0 16px">
                Someone from our team will be in touch shortly to walk you through the platform and answer any questions you have.
              </p>
              <p style="color:#475569;line-height:1.6;margin:0 0 24px">
                In the meantime, feel free to reply to this email with any questions.
              </p>
              <p style="color:#475569;margin:0">Best,<br/><strong>The Cloud Weaver Team</strong></p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
              <p style="font-size:12px;color:#94a3b8;margin:0">
                Cloud Weaver &mdash; <a href="https://cloudweavr.com" style="color:#6366f1">cloudweavr.com</a>
              </p>
            </div>`,
          text: `Hi ${firstName},\n\nThanks for your interest in Threads${lead.tier_interest ? ` ${tierLabel}` : ""}! We're excited to help you automate your data workflows.\n\nSomeone from our team will be in touch shortly.\n\nBest,\nThe Cloud Weaver Team`,
        }),
      }).catch(() => { /* email failure is non-fatal */ });
    }

    return NextResponse.json({ success: true, opportunityId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
