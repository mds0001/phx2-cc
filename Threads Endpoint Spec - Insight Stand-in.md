# Threads Endpoint Spec — Insight API Stand-in

**Goal.** Build a small set of endpoints on Threads that mimic Insight Enterprises' Digital Platform API (OAuth token + CustomerInvoice) closely enough that our Ivanti Neurons Composite Action can talk to Threads instead of Insight while we debug the real API. Once Ivanti's flow is proven end-to-end against Threads, we swap the URL back to Insight and work only on the remaining Insight-side fault.

**Why stand-in, not mock.** The point is full-path verification of the Ivanti Composite Action's REST→JSON→Variable→BO pipeline, not functional mocking. The stand-in needs to send a realistic SAP API Management-style response shape so all the JSONPath field mappings in our Ivanti Insert Object can be exercised against real bytes.

## Target base URL

Use whatever Threads gives us. For reference in the examples below I'll write `https://threads.cloudweavr.com/api/insight-qa/...` but substitute the actual URL when the endpoints are live.

## Authentication

Accept OAuth 2.0 `client_credentials` grant. For this QA stand-in, do **not** validate the client_id / client_secret — just accept any Basic-Authed request. That keeps Ivanti's real secrets out of Threads logs.

The token returned should look like a real JWT-ish string but doesn't have to verify. Something like `stub-<random-16-chars>` is fine. When the caller subsequently sends `Authorization: Bearer <that-token>`, accept it.

## Endpoints

### 1. `POST /oauth/token`

**Request**

- Optional query string: `?grant_type=client_credentials`
- Header: `Authorization: Basic base64(client_id:client_secret)` — accept any non-empty value
- Content-Type: `application/x-www-form-urlencoded` (body may be empty)

**Response** — HTTP 200, `application/json`:

```json
{
  "access_token": "stub-AbCdEf1234567890",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "insight.invoices.read"
}
```

The `access_token` value only needs to be a non-empty string. Make it unique per call if trivial; otherwise a constant is fine.

### 2. `GET /NA/CustomerInvoice`

**Request**

- Header: `Authorization: Bearer <token>` — accept any non-empty bearer token (don't verify)
- Header: `ClientID: 9373908` — optional; log it but don't reject when missing
- Optional query params (ignore any Threads doesn't want to honor): `modifiedSince`, `top`, `skip`, `invoiceNumber`
- Request body: none

**Response** — HTTP 200, `application/json`:

Return a small array with ONE fully populated invoice. Shape below. Field names must match exactly — this IS the mapping contract on the Ivanti side.

```json
{
  "invoices": [
    {
      "invoiceNumber": "INV-445201",
      "orderNumber": "OR-9373908-00481234",
      "customerPONumber": "PO-IT-2026-0421",
      "invoiceDate": "2026-04-22T00:00:00Z",
      "orderDate": "2026-04-20T14:05:11Z",
      "orderStatus": "Invoiced",
      "currencyCode": "USD",
      "subTotal": "4467.51",
      "taxTotal": "365.43",
      "freightTotal": "34.95",
      "invoiceTotal": "4867.89",
      "shipTo": {
        "attention": "IT Receiving",
        "addressLine1": "123 Main St",
        "city": "Phoenix",
        "stateCode": "AZ",
        "postalCode": "85004",
        "countryCode": "US"
      },
      "shipment": {
        "carrier": "FedEx",
        "trackingNumber": "773498123456"
      },
      "lines": [
        {
          "lineNumber": 10,
          "manufacturerPartNumber": "20XK0012US",
          "insightMaterialNumber": "INS12345678",
          "manufacturerName": "Lenovo",
          "itemDescription": "ThinkPad T14 Gen 4 i7/16GB/512/W11P",
          "productCategory": "Notebooks",
          "quantityOrdered": 2,
          "quantityInvoiced": 2,
          "unitPrice": "892.14",
          "extendedPrice": "1784.28",
          "lineStatus": "Shipped",
          "requestedShipDate": "2026-04-20",
          "actualShipDate": "2026-04-22",
          "serialNumbers": ["PF1A1234", "PF1A1235"],
          "warrantyTermInMonths": 36,
          "contractNumber": "MA-2026-04"
        },
        {
          "lineNumber": 20,
          "manufacturerPartNumber": "6VA71AV",
          "insightMaterialNumber": "INS98765432",
          "manufacturerName": "HP",
          "itemDescription": "USB-C Universal Dock G5",
          "productCategory": "Accessories",
          "quantityOrdered": 2,
          "quantityInvoiced": 2,
          "unitPrice": "251.73",
          "extendedPrice": "503.46",
          "lineStatus": "Shipped",
          "requestedShipDate": "2026-04-20",
          "actualShipDate": "2026-04-22",
          "serialNumbers": [],
          "warrantyTermInMonths": 12,
          "contractNumber": "MA-2026-04"
        }
      ]
    }
  ]
}
```

Notes:

- One invoice is enough for the Phase 2/3 smoke test. Later we'll spec a multi-invoice variant for array iteration testing.
- The first line has 2 serial numbers (triggers multi-Asset creation in Ivanti); the second line has an empty serialNumbers array (triggers the "placeholder Asset per ordinal" flow). That's intentional — it exercises both code paths.
- All monetary amounts are JSON strings, not numbers. That's how SAP API Management typically returns currency fields and how our Ivanti transform expects to receive them (parseFloat → Decimal(18,2)).
- Dates are ISO-8601, timezone UTC.

### 3. `GET /NA/CustomerInvoice?scenario=<name>` (optional, nice to have)

To let us test Ivanti-side error handling without needing Insight to misbehave, support an optional `scenario` query parameter that returns non-200 responses with SAP API Management-style fault bodies. Ignore unless called explicitly.

| `scenario=` | Status | Body |
|---|---|---|
| `unauthorized` | 401 | `{"fault":{"faultstring":"Invalid ApiKey for given resource","detail":{"errorcode":"oauth.v2.InvalidApiKeyForGivenResource"}}}` |
| `missing_client_id` | 400 | `{"fault":{"faultstring":"Missing required parameter: ClientID","detail":{"errorcode":"steps.raisefault.MissingHeader"}}}` |
| `server_error` | 500 | `{"fault":{"faultstring":"Internal Server Error","detail":{"errorcode":"steps.raisefault.GenericError"}}}` |

Each fault body is valid JSON with a top-level `fault.faultstring` — matches what our Ivanti Action 3 Description field is coded to extract.

### 4. `GET /NA/GetStatus` (phase 2; not blocking smoke test)

Not needed to close smoke Phases 2.1 and 3.1, but helpful to have eventually. Spec TBD — I'll add it to this file once we've closed out CustomerInvoice testing.

## Acceptance criteria

A successful Threads build meets all of these:

1. `POST /oauth/token` returns 200 with a JSON body containing `access_token`, `token_type`, `expires_in` regardless of which Basic Auth credentials are supplied (as long as some are).
2. `GET /NA/CustomerInvoice` with any `Authorization: Bearer ...` header returns 200 with the example payload above.
3. `GET /NA/CustomerInvoice?scenario=missing_client_id` returns 400 with the SAP APIM-shaped fault body.
4. HTTPS, valid cert, reachable from the Ivanti Integration Service host.
5. CORS is not a concern (server-to-server).

## How we'll use it in Ivanti

Once Threads is live:

1. In the Ivanti Composite Action, change Action 1's URL from Insight's OAuth to Threads' `/oauth/token`.
2. Change Action 2's URL from Insight's CustomerInvoice to Threads' `/NA/CustomerInvoice`.
3. Run the composite. We expect the whole pipeline to succeed: OAuth → token captured → CustomerInvoice called with Bearer + ClientID → JSON response stored → Insert Object writes a CI record with fields extracted via JSONPath.
4. This isolates whether the Ivanti plumbing itself works. If it does (and I'm confident it will against this stand-in), we KNOW the remaining problem is specific to Insight's real API — probably a required parameter, different HTTP method, or different header name we haven't tried.
5. From there we either get Insight's API spec from their account team, or use the `scenario=` endpoints to replay Insight's fault shapes and rehearse the handling.

## Not in scope for this stand-in

- Rate limiting
- Pagination (keep responses small enough to not need it for smoke)
- Response times > a few seconds (Ivanti has timeouts we don't want to trip)
- Persistent state — every call can return the same payload

## Change log

- 2026-04-24 v0.1: initial spec for Phase 2/3 smoke test stand-in.
