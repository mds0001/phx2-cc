# Handback — Insight: one row per purchased device

**Status:** Path resolved. Ready for implementation on dev.

---

## Mission

For each purchased device, produce one row with:

- Serial number
- Manufacturer part number
- Purchase date (ship date is acceptable per customer)
- Price

---

## Resolved approach

**Use Insight's `MT/GetStatus2` API, not `CustomerInvoice`.** Add an opt-in serial-fanout step to the existing `/api/insight-proxy` route so that lines with N serials become N rows. Lines with zero serials are dropped (they are not "purchased devices" per the mission).

---

## Why CustomerInvoice was scoped out

Several rounds of probing failed to get a 200 from `/NA/CustomerInvoice`. Root cause: **wrong-contract assumption**, not a broken endpoint.

Per the SOP (`SOP - API for Customer Invoice - client access.docx`), CustomerInvoice is **not** a date-range search API. It is a per-transaction lookup that requires a known transaction ID:

```json
{
  "MT_WebInvoiceRequest": {
    "InvoiceRequest": {
      "ClientID": "9373908",
      "SearchBy": "INVNUM",
      "LanguageKey": "EN",
      "InvoiceRequestID": { "TransactionID": ["<known invoice/order #>"] }
    }
  }
}
```

`SearchBy` accepts only `APITRX | PONUM | POREL | ORDNUM | WEBREF | INVNUM`. The earlier probes used `SearchBy: "DATE"` and various date-range field names — that is why every variant hit the generic "request is not in a valid JSON format" wall.

**Why we don't need to fix that now:** CustomerInvoice's only added value over Status2 is the true `InvoiceDate` (vs `ShipDate`) and final invoiced price (vs sales-order price). The customer requires neither — ship date is acceptable as "purchase date."

If the mission ever expands to require true invoice date, the path forward is the **two-step orchestration**: Status2 by `ShipDate` to collect orders, then per-order CustomerInvoice with `SearchBy: "ORDNUM"` and `TransactionID: [InsightOrderNumber]`. That hop is unblocked now that the contract is understood.

---

## What Status2 already provides

`src/app/api/insight-proxy/route.ts` calls `MT/GetStatus2` and flattens the response. Format B (`flattenRows`, lines 242–268) emits one row per **line item** with these fields:

| Mission field | Status2 source | Field name in proxy output |
|---|---|---|
| Serial number | `Delivery.SerialNumbers[].SerialNumber` | `serialNumber` (first only) + `serialNumbers` (comma-joined) |
| Manufacturer part number | `ManufacturerSKU` | `manufacturerPartNumber` |
| Purchase date (= ship date) | `Delivery.ActualGoodsIssueDate` | `shipDate` |
| Price | `UnitPrice` / `NetPrice` / `ExtendedPrice` / `NetValue` | `unitPrice`, `extendedPrice` |

OAuth, token caching, ship-date expansion, and concurrent batching (50/batch) are all already in place. The only missing piece is the per-serial fanout.

---

## Change required

### 1. `src/app/api/insight-proxy/route.ts` — opt-in `expand_serials` flag

Add a body flag:

```ts
{ connection_id, ship_date, expand_serials: true }
```

When `expand_serials` is `true`, post-process the rows from `flattenRows()`:

- For each row with N parsed serials, emit N rows where `serialNumber` is the unique serial and `serialNumbers` is the same single value.
- **Drop rows with zero serials** (consumables, licenses, services, accessories — not "purchased devices" per the mission).

Reuse the existing serial parser (`extractSerialNumbers`, lines 163–180) — it already handles every nested shape.

Default behavior (no flag) stays unchanged, so existing scheduled tasks that rely on the comma-joined `serialNumbers` are not affected.

### 2. `src/components/SchedulerClient.tsx` — surface the flag

The proxy is called at `SchedulerClient.tsx:1963`. Add a checkbox to the Insight task config UI: *"Expand to one row per device (serial)"*. Persist on the task and pass through in the POST body.

### 3. `src/components/MappingEditorClient.tsx` — no change

The existing field list at line 504 already exposes both `serialNumber` and `serialNumbers`. Mappings work as-is.

---

## Cleanup — done

Deleted (these were created while chasing the wrong CustomerInvoice contract):

- `test-invoice-api.mjs`, `test-invoice-api-v2.mjs`, `-v3`, `-v4`, `-v5`, `-v6.mjs` (6 files)
- `src/app/api/insight-invoice-probe/route.ts` (and its empty parent directory)

Kept as reference in case the mission later expands to require invoice-level data:

- `SOP - API for Customer Invoice - client access.docx`
- `Insight There are some sample payloads.md`
- `Insight QA Connection Details.md`
- `Insight-invoice-access.md` (note: this was the original "go get an invoice" assignment — superseded by *this* handback, but kept for traceability; safe to delete later)

---

## Verification plan (per project CLAUDE.md workflow: Update → Test → Push)

1. **Update** the proxy and SchedulerClient UI on dev only (`lxcentwfpiefosjkarlx`).
2. **Test on dev**: run a scheduled Insight task with `expand_serials: true` against a recent ship date that has serialized hardware. Confirm:
   - One row per serial (not one row per line)
   - Zero-serial lines dropped
   - All four mission fields populated
   - Existing tasks (without the flag) still produce the legacy comma-joined output
3. **Push** to prod (Vercel + `ogolfqzuqnfslyjivntm`) only after explicit user confirmation.

---

## Pointers for a fresh session

- **Existing working code**: `src/app/api/insight-proxy/route.ts` — read top-to-bottom; `flattenRows` (line 187) and `extractSerialNumbers` (line 163) are the two functions you'll touch around.
- **Caller**: `src/components/SchedulerClient.tsx:1961-1963`.
- **Insight connection** records live in Supabase table `endpoint_connections` with `type = 'insight'`. Pick one from the **dev** project for testing.
- **Sample Status2 request bodies**: `Insight There are some sample payloads.md`.
- **OAuth flow + token caching**: already implemented in `getToken` (line 24).
- **Status2 ship-date semantics**: only single `ShipDate` per call; range expansion is already implemented (lines 450–473).
