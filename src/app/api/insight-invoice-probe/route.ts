// GET /api/insight-invoice-probe
// Tries multiple CustomerInvoice request body formats and returns all results.
// Open in browser — no auth required (uses service role client).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

const INVOICE_PATH = "/NA/CustomerInvoice";
const OAUTH_PATH   = "/oauth/token";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createAdminClient();

  // Load Insight Prod connection
  const { data: conn } = await supabase
    .from("endpoint_connections")
    .select("id, config")
    .eq("type", "insight")
    .ilike("name", "%prod%")
    .single();

  if (!conn) return NextResponse.json({ error: "Insight Prod connection not found" }, { status: 404 });

  const raw          = conn.config as Record<string, string>;
  const baseUrl      = raw.url?.replace(/\/$/, "") ?? "";
  const clientKey    = raw.client_key ?? raw.client_id ?? "";
  const clientSecret = raw.client_secret ?? "";
  const clientId     = raw.client_id_header ?? raw.client_id ?? "";

  // Get OAuth token
  const tokenUrl = `${baseUrl}${OAUTH_PATH}?grant_type=client_credentials`;
  const creds    = Buffer.from(`${clientKey}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Authorization": `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const tokenData = await tokenRes.json() as { access_token?: string };
  const token = tokenData.access_token;
  if (!token) return NextResponse.json({ error: "Failed to get OAuth token", tokenData }, { status: 500 });

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Content-Type":  "application/json",
    "Accept":        "application/json",
    "ClientID":      clientId,
  };

  const invoiceUrl    = baseUrl + INVOICE_PATH;
  const yesterday     = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const yesterdaySap  = yesterday.replace(/-/g, "");

  const variants = [
    { label: "No date / EN",              body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: clientId, SearchBy: "DATE", LanguageKey: "EN" } } } },
    { label: "InvoiceDate ISO / EN",      body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: clientId, SearchBy: "DATE", LanguageKey: "EN", InvoiceDate: yesterday } } } },
    { label: "InvoiceDate SAP / EN",      body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: clientId, SearchBy: "DATE", LanguageKey: "EN", InvoiceDate: yesterdaySap } } } },
    { label: "BillingDate SAP / EN",      body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: clientId, SearchBy: "DATE", LanguageKey: "EN", BillingDate: yesterdaySap } } } },
    { label: "PostingDate SAP / EN",      body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: clientId, SearchBy: "DATE", LanguageKey: "EN", PostingDate: yesterdaySap } } } },
    { label: "SearchBy=PO / EN",          body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: clientId, SearchBy: "PO",   LanguageKey: "EN" } } } },
    { label: "SearchBy=INV / EN",         body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: clientId, SearchBy: "INV",  LanguageKey: "EN" } } } },
    { label: "SearchBy=CUSTPO / EN",      body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: clientId, SearchBy: "CUSTPO", LanguageKey: "EN" } } } },
    { label: "No LanguageKey",            body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: clientId, SearchBy: "DATE", InvoiceDate: yesterdaySap } } } },
    { label: "Array InvoiceRequest / EN", body: { MT_WebInvoiceRequest: { InvoiceRequest: [{ ClientID: clientId, SearchBy: "DATE", LanguageKey: "EN", InvoiceDate: yesterdaySap }] } } },
  ];

  const results: Record<string, string> = {};

  for (const { label, body } of variants) {
    try {
      const res  = await fetch(invoiceUrl, { method: "POST", headers, body: JSON.stringify(body) });
      const text = await res.text();
      results[label] = `HTTP ${res.status}: ${text.slice(0, 600)}`;
    } catch (e) {
      results[label] = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Store results in Supabase so Claude can read them later
  await supabase.from("task_logs").insert({
    task_id:    "f78d8cc0-9228-4269-884a-d77adc134af1",
    action:     "INFO",
    details:    `[INVOICE-PROBE] ${JSON.stringify(results, null, 2)}`,
    created_at: new Date().toISOString(),
  });

  return NextResponse.json({ results, yesterday, yesterdaySap });
}
