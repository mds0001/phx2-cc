import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * POST /api/insight-proxy
 *
 * Fetches invoice data from an Insight (or Insight stand-in) API endpoint,
 * authenticates via OAuth client_credentials, and returns flattened line-item
 * rows ready for the SchedulerClient mapping pipeline.
 *
 * Body: { connection_id: string }
 *
 * Response: {
 *   rows: Record<string, string>[],   // one row per line item
 *   invoice_count: number,
 *   line_count: number,
 * }
 */

interface InsightConfig {
  url: string;
  oauth_token_path: string;
  invoice_path: string;
  client_id: string;
  client_secret: string;
  client_id_header: string;
  grant_type?: string;
}

interface InvoiceLine {
  lineNumber?: number;
  manufacturerPartNumber?: string;
  insightMaterialNumber?: string;
  manufacturerName?: string;
  itemDescription?: string;
  productCategory?: string;
  quantityOrdered?: number;
  quantityInvoiced?: number;
  unitPrice?: string;
  extendedPrice?: string;
  lineStatus?: string;
  requestedShipDate?: string;
  actualShipDate?: string;
  serialNumbers?: string[];
  warrantyTermInMonths?: number;
  contractNumber?: string;
}

interface Invoice {
  invoiceNumber?: string;
  orderNumber?: string;
  customerPONumber?: string;
  invoiceDate?: string;
  orderDate?: string;
  orderStatus?: string;
  currencyCode?: string;
  subTotal?: string;
  taxTotal?: string;
  freightTotal?: string;
  invoiceTotal?: string;
  shipTo?: {
    attention?: string;
    addressLine1?: string;
    city?: string;
    stateCode?: string;
    postalCode?: string;
    countryCode?: string;
  };
  shipment?: {
    carrier?: string;
    trackingNumber?: string;
  };
  lines?: InvoiceLine[];
}

interface InvoiceResponse {
  invoices?: Invoice[];
}

export async function POST(req: NextRequest) {
  try {
    // Auth guard
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { connection_id } = await req.json() as { connection_id: string };
    if (!connection_id) {
      return NextResponse.json({ error: "connection_id required" }, { status: 400 });
    }

    // Load the portal connection config
    const admin = createAdminClient();
    const { data: conn, error: connErr } = await admin
      .from("endpoint_connections")
      .select("id, name, type, config")
      .eq("id", connection_id)
      .single();

    if (connErr || !conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (conn.type !== "portal" && conn.type !== "insight") {
      return NextResponse.json({ error: `Expected insight or portal connection, got: ${conn.type}` }, { status: 400 });
    }

    const cfg = conn.config as InsightConfig;
    if (!cfg.url || !cfg.oauth_token_path || !cfg.invoice_path) {
      return NextResponse.json({ error: "Connection config is incomplete (missing url, oauth_token_path, or invoice_path)" }, { status: 400 });
    }
    if (!cfg.client_id || !cfg.client_secret) {
      return NextResponse.json({ error: "Connection credentials are not set (client_id / client_secret)" }, { status: 400 });
    }

    // ── Step 1: OAuth token ────────────────────────────────────────────────
    const tokenUrl = `${cfg.url.replace(/\/$/, "")}${cfg.oauth_token_path}`;
    const basicAuth = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString("base64");

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "(no body)");
      return NextResponse.json(
        { error: `OAuth token request failed (${tokenRes.status}): ${body}` },
        { status: 502 }
      );
    }

    const tokenData = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return NextResponse.json({ error: "OAuth response missing access_token" }, { status: 502 });
    }

    // ── Step 2: Fetch CustomerInvoice ──────────────────────────────────────
    const invoiceUrl = `${cfg.url.replace(/\/$/, "")}${cfg.invoice_path}`;
    const invoiceHeaders: Record<string, string> = {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    };
    if (cfg.client_id_header) {
      invoiceHeaders["ClientID"] = cfg.client_id_header;
    }

    const invoiceBody = cfg.client_id_header
      ? JSON.stringify({ clientId: cfg.client_id_header })
      : "{}";

    const invoiceRes = await fetch(invoiceUrl, {
      method: "POST",
      headers: invoiceHeaders,
      body: invoiceBody,
    });

    if (!invoiceRes.ok) {
      const body = await invoiceRes.text().catch(() => "(no body)");
      return NextResponse.json(
        { error: `CustomerInvoice request failed (${invoiceRes.status}): ${body}` },
        { status: 502 }
      );
    }

    const invoiceData = await invoiceRes.json() as InvoiceResponse;
    const invoices: Invoice[] = invoiceData.invoices ?? [];

    // ── Step 3: Flatten line items into rows ───────────────────────────────
    // Each line item becomes one row. Invoice-level fields are copied onto
    // every line row. serialNumber uses serialNumbers[0] (or "" if empty).
    const rows: Record<string, string>[] = [];

    for (const invoice of invoices) {
      const invoiceBase: Record<string, string> = {
        invoiceNumber:    invoice.invoiceNumber    ?? "",
        orderNumber:      invoice.orderNumber      ?? "",
        customerPONumber: invoice.customerPONumber ?? "",
        invoiceDate:      invoice.invoiceDate      ?? "",
        orderDate:        invoice.orderDate        ?? "",
        orderStatus:      invoice.orderStatus      ?? "",
        currencyCode:     invoice.currencyCode     ?? "",
        subTotal:         invoice.subTotal         ?? "",
        taxTotal:         invoice.taxTotal         ?? "",
        freightTotal:     invoice.freightTotal     ?? "",
        invoiceTotal:     invoice.invoiceTotal     ?? "",
        // shipTo
        shipToAttention:    invoice.shipTo?.attention    ?? "",
        shipToAddressLine1: invoice.shipTo?.addressLine1 ?? "",
        shipToCity:         invoice.shipTo?.city         ?? "",
        shipToStateCode:    invoice.shipTo?.stateCode    ?? "",
        shipToPostalCode:   invoice.shipTo?.postalCode   ?? "",
        shipToCountryCode:  invoice.shipTo?.countryCode  ?? "",
        // shipment
        carrier:        invoice.shipment?.carrier        ?? "",
        trackingNumber: invoice.shipment?.trackingNumber ?? "",
      };

      for (const line of invoice.lines ?? []) {
        rows.push({
          ...invoiceBase,
          lineNumber:             String(line.lineNumber             ?? ""),
          manufacturerPartNumber: line.manufacturerPartNumber        ?? "",
          insightMaterialNumber:  line.insightMaterialNumber         ?? "",
          manufacturerName:       line.manufacturerName              ?? "",
          itemDescription:        line.itemDescription               ?? "",
          productCategory:        line.productCategory               ?? "",
          quantityOrdered:        String(line.quantityOrdered        ?? ""),
          quantityInvoiced:       String(line.quantityInvoiced       ?? ""),
          unitPrice:              line.unitPrice                     ?? "",
          extendedPrice:          line.extendedPrice                 ?? "",
          lineStatus:             line.lineStatus                    ?? "",
          requestedShipDate:      line.requestedShipDate             ?? "",
          actualShipDate:         line.actualShipDate                ?? "",
          serialNumber:           (line.serialNumbers ?? [])[0]      ?? "",
          serialNumbers:          (line.serialNumbers ?? []).join(","),
          warrantyTermInMonths:   String(line.warrantyTermInMonths   ?? ""),
          contractNumber:         line.contractNumber                ?? "",
        });
      }
    }

    return NextResponse.json({
      rows,
      invoice_count: invoices.length,
      line_count: rows.length,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[insight-proxy] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
