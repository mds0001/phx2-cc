// test-invoice-api.mjs
// Run: node test-invoice-api.mjs
// Tries multiple CustomerInvoice request body formats and prints each response.

const BASE_URL     = "https://insight-prod-na.prod.apimanagement.us20.hana.ondemand.com";
const OAUTH_PATH   = "/oauth/token";
const INVOICE_PATH = "/NA/CustomerInvoice";
const CLIENT_KEY   = "d93F57578ZrX8C9BjiAJ1VGhxWCaNqxq";
const CLIENT_SECRET = "jf48p7GOAUoGwiyZ";
const CLIENT_ID    = "9373908";

// --- Get OAuth token ---
const tokenUrl = `${BASE_URL}${OAUTH_PATH}?grant_type=client_credentials`;
const creds    = Buffer.from(`${CLIENT_KEY}:${CLIENT_SECRET}`).toString("base64");
const tokenRes = await fetch(tokenUrl, {
  method: "POST",
  headers: { "Authorization": `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
});
const tokenData = await tokenRes.json();
const token = tokenData.access_token;
console.log(`Token: ${token?.slice(0, 20)}...\n`);

const headers = {
  "Authorization": `Bearer ${token}`,
  "Content-Type":  "application/json",
  "Accept":        "application/json",
  "ClientID":      CLIENT_ID,
};

const TODAY     = new Date().toISOString().split("T")[0];              // YYYY-MM-DD
const TODAY_SAP = TODAY.replace(/-/g, "");                             // YYYYMMDD
const YESTERDAY     = new Date(Date.now() - 86400000).toISOString().split("T")[0];
const YESTERDAY_SAP = YESTERDAY.replace(/-/g, "");

const bodies = [
  // No date — just required fields
  { label: "No date / EN",            body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: CLIENT_ID, SearchBy: "DATE", LanguageKey: "EN" } } } },
  // YYYYMMDD date formats
  { label: "InvoiceDate YYYYMMDD/EN", body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: CLIENT_ID, SearchBy: "DATE", LanguageKey: "EN", InvoiceDate: YESTERDAY_SAP } } } },
  { label: "BillingDate YYYYMMDD/EN", body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: CLIENT_ID, SearchBy: "DATE", LanguageKey: "EN", BillingDate: YESTERDAY_SAP } } } },
  { label: "DocDate YYYYMMDD/EN",     body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: CLIENT_ID, SearchBy: "DATE", LanguageKey: "EN", DocDate: YESTERDAY_SAP } } } },
  // YYYY-MM-DD date formats
  { label: "InvoiceDate ISO/EN",      body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: CLIENT_ID, SearchBy: "DATE", LanguageKey: "EN", InvoiceDate: YESTERDAY } } } },
  // Different SearchBy values
  { label: "SearchBy=PO/EN",          body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: CLIENT_ID, SearchBy: "PO",   LanguageKey: "EN" } } } },
  { label: "SearchBy=INV/EN",         body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: CLIENT_ID, SearchBy: "INV",  LanguageKey: "EN" } } } },
  { label: "SearchBy=CUST/EN",        body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: CLIENT_ID, SearchBy: "CUST", LanguageKey: "EN" } } } },
  // Try without LanguageKey to see if it's optional
  { label: "No LanguageKey",          body: { MT_WebInvoiceRequest: { InvoiceRequest: { ClientID: CLIENT_ID, SearchBy: "DATE", InvoiceDate: YESTERDAY_SAP } } } },
];

for (const { label, body } of bodies) {
  try {
    const res  = await fetch(`${BASE_URL}${INVOICE_PATH}`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`[${label}] HTTP ${res.status}:`);
    console.log(text.slice(0, 400));
    console.log("---");
  } catch (e) {
    console.log(`[${label}] ERROR: ${e.message}\n---`);
  }
}
