import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/insight-qa/NA/CustomerInvoice
 *
 * Insight Enterprises Digital Platform API stand-in.
 * Returns a realistic SAP API Management-shaped invoice payload for use with
 * the Ivanti Neurons Composite Action smoke test.
 *
 * Supports ?scenario= for error-path testing:
 *   unauthorized       → 401 fault
 *   missing_client_id  → 400 fault
 *   server_error       → 500 fault
 */

const INVOICE_PAYLOAD = {
  invoices: [
    {
      invoiceNumber: "INV-445201",
      orderNumber: "OR-9373908-00481234",
      customerPONumber: "PO-IT-2026-0421",
      invoiceDate: "2026-04-22T00:00:00Z",
      orderDate: "2026-04-20T14:05:11Z",
      orderStatus: "Invoiced",
      currencyCode: "USD",
      subTotal: "4467.51",
      taxTotal: "365.43",
      freightTotal: "34.95",
      invoiceTotal: "4867.89",
      shipTo: {
        attention: "IT Receiving",
        addressLine1: "123 Main St",
        city: "Phoenix",
        stateCode: "AZ",
        postalCode: "85004",
        countryCode: "US",
      },
      shipment: {
        carrier: "FedEx",
        trackingNumber: "773498123456",
      },
      lines: [
        {
          lineNumber: 10,
          manufacturerPartNumber: "20XK0012US",
          insightMaterialNumber: "INS12345678",
          manufacturerName: "Lenovo",
          itemDescription: "ThinkPad T14 Gen 4 i7/16GB/512/W11P",
          productCategory: "Notebooks",
          quantityOrdered: 2,
          quantityInvoiced: 2,
          unitPrice: "892.14",
          extendedPrice: "1784.28",
          lineStatus: "Shipped",
          requestedShipDate: "2026-04-20",
          actualShipDate: "2026-04-22",
          serialNumbers: ["PF1A1234", "PF1A1235"],
          warrantyTermInMonths: 36,
          contractNumber: "MA-2026-04",
        },
        {
          lineNumber: 20,
          manufacturerPartNumber: "6VA71AV",
          insightMaterialNumber: "INS98765432",
          manufacturerName: "HP",
          itemDescription: "USB-C Universal Dock G5",
          productCategory: "Accessories",
          quantityOrdered: 2,
          quantityInvoiced: 2,
          unitPrice: "251.73",
          extendedPrice: "503.46",
          lineStatus: "Shipped",
          requestedShipDate: "2026-04-20",
          actualShipDate: "2026-04-22",
          serialNumbers: [],
          warrantyTermInMonths: 12,
          contractNumber: "MA-2026-04",
        },
      ],
    },
  ],
};

const FAULT_SCENARIOS: Record<string, { status: number; body: object }> = {
  unauthorized: {
    status: 401,
    body: {
      fault: {
        faultstring: "Invalid ApiKey for given resource",
        detail: { errorcode: "oauth.v2.InvalidApiKeyForGivenResource" },
      },
    },
  },
  missing_client_id: {
    status: 400,
    body: {
      fault: {
        faultstring: "Missing required parameter: ClientID",
        detail: { errorcode: "steps.raisefault.MissingHeader" },
      },
    },
  },
  server_error: {
    status: 500,
    body: {
      fault: {
        faultstring: "Internal Server Error",
        detail: { errorcode: "steps.raisefault.GenericError" },
      },
    },
  },
};

export async function GET(req: NextRequest) {
  // Require a non-empty Bearer token (any value accepted)
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json(
      {
        fault: {
          faultstring: "Missing or invalid Authorization header",
          detail: { errorcode: "oauth.v2.MissingAuthorization" },
        },
      },
      { status: 401 }
    );
  }

  // Optional: log the ClientID header for debugging
  const clientId = req.headers.get("clientid") ?? req.headers.get("ClientID");
  if (clientId) {
    console.log(`[insight-qa] CustomerInvoice called with ClientID: ${clientId}`);
  }

  // Scenario override
  const scenario = req.nextUrl.searchParams.get("scenario");
  if (scenario && scenario in FAULT_SCENARIOS) {
    const { status, body } = FAULT_SCENARIOS[scenario];
    return NextResponse.json(body, { status });
  }

  return NextResponse.json(INVOICE_PAYLOAD);
}
