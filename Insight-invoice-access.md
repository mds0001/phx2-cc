# Insight CustomerInvoice API — Get a Record

## Your only job

Call Insight's `/NA/CustomerInvoice` API and get a successful response with invoice data.
When you succeed, write the working request body and full raw response to `handback.md`
in the project root.

---

## Credentials

- **URL:** `https://insight-prod-na.prod.apimanagement.us20.hana.ondemand.com`
- **OAuth token path:** `/oauth/token?grant_type=client_credentials`
- **Invoice path:** `/NA/CustomerInvoice`
- **client_key:** `d93F57578ZrX8C9BjiAJ1VGhxWCaNqxq`
- **client_secret:** `jf48p7GOAUoGwiyZ`
- **ClientID header:** `9373908`

Get a Bearer token first:
```
POST https://insight-prod-na.prod.apimanagement.us20.hana.ondemand.com/oauth/token?grant_type=client_credentials
Authorization: Basic base64(client_key:client_secret)
```

Then call the invoice endpoint:
```
POST https://insight-prod-na.prod.apimanagement.us20.hana.ondemand.com/NA/CustomerInvoice
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json
ClientID: 9373908
```

---

## What we know about the request body

The envelope looks like this — but `LanguageKey` and the date field names are unknown:

```json
{
  "MT_WebInvoiceRequest": {
    "InvoiceRequest": {
      "ClientID": "9373908",
      "SearchBy": "DATE",
      "LanguageKey": "???",
      "InvoiceDateFrom": "2026-04-01",
      "InvoiceDateTo": "2026-04-30"
    }
  }
}
```

## Combinations to try

A test script already exists at the project root — just run it:

```bash
node test-invoice-api.mjs
```

It tests 9 `LanguageKey` variants and 6 date field name variants in one shot.

**Note:** This script makes outbound HTTPS calls to Insight. If your sandbox blocks
external network access, you will need to run it on the host machine instead.

---

## What to write to `handback.md`

Once you get a 200 response with invoice data:

1. The exact request body JSON that worked
2. The full raw response (or first 2000 chars if very large)
3. The field names that contain unit price, extended price, and ship date

That's it. Another Claude session will handle wiring it into the app.
