import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import type { InsightConfig } from "@/lib/types";

export const maxDuration = 120; // allow up to 2 min for large import windows

// -- Environment -> base URL mapping (new-style connections)
const ENV_BASE: Record<string, string> = {
  "prod-na":   "https://api.insight.com",
  "prod-emea": "https://api.insight.com/EMEA",
  "test-na":   "https://api.uat.insight.com",
  "test-emea": "https://api.uat.insight.com/EMEA",
};

const OAUTH_PATH  = "/oauth2/token";
const STATUS_PATH = "/MT/GetStatus2";

// -- Token cache (keyed by connection id)
interface TokenEntry { token: string; expiresAt: number }
const tokenCache = new Map<string, TokenEntry>();

async function getToken(connId: string, cfg: InsightConfig, tokenUrl: string): Promise<string> {
  const cached = tokenCache.get(connId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  // Apigee OAuthV2 policy reads grant_type from the query string (not the body).
  // Per Insight SOP: auth is Basic only, request body is None.
  // tokenUrl already has ?grant_type=client_credentials appended by the caller.
  const basicAuth = Buffer.from(`${cfg.client_key}:${cfg.client_secret}`).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Accept":        "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Insight OAuth failed -- HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Insight OAuth: no access_token in response");

  const ttl = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const safeTtl = Math.min(ttl - 300, 3300);
  tokenCache.set(connId, { token: data.access_token, expiresAt: Date.now() + safeTtl * 1000 });
  return data.access_token;
}

// -- GetStatus request body builder
// Per Insight SOP: ClientID (all-caps) is inside StatusRequest[0], along with ShipDate / CustomerOrderNumber.
// Example from SOP: {"MT_Status2Request":{"StatusRequest":[{"ClientID":"9373908","ShipDate":"2026-04-26"}]}}
function buildStatusBody(
  clientId: string,
  shipDate?: string,
  orderNumber?: string,
  shipDateFrom?: string,
  shipDateTo?: string,
): unknown {
  const request: Record<string, string> = {};
  if (clientId)     request.ClientID            = clientId;
  if (shipDateFrom) request.ShipDateFrom        = shipDateFrom;
  if (shipDateTo)   request.ShipDateTo          = shipDateTo;
  if (!shipDateFrom && shipDate) request.ShipDate = shipDate;
  if (orderNumber)  request.CustomerOrderNumber = orderNumber;
  // TrackingData "X" is required to receive Delivery details including SerialNumber.
  request.TrackingData = "X";
  return {
    "MT_Status2Request": {
      "StatusRequest": [request],
    },
  };
}


// -- GetStatus response types
interface StatusLine {
  lineNumber?:             number | string;
  manufacturerPartNumber?: string;
  insightPartNumber?:      string;
  manufacturerName?:       string;
  itemDescription?:        string;
  productCategory?:        string;
  quantityOrdered?:        number | string;
  quantityShipped?:        number | string;
  unitPrice?:              number | string;
  extendedPrice?:          number | string;
  lineStatus?:             string;
  shipDate?:               string;
  serialNumbers?:          string | string[];
  trackingNumber?:         string;
  carrier?:                string;
  contractNumber?:         string;
  warrantyMonths?:         number | string;
}

interface StatusOrder {
  customerOrderNumber?: string;
  insightOrderNumber?:  string;
  customerPONumber?:    string;
  orderDate?:           string;
  orderStatus?:         string;
  currencyCode?:        string;
  billTo?:              Record<string, string>;
  shipTo?:              Record<string, string>;
  lines?:               StatusLine[];
}

interface StatusResponse {
  "MT_Status2Response"?: {
    "StatusResponse"?: StatusOrder | StatusOrder[];
  };
}

// -- Date sanitizer: parse whatever format Insight returns, reformat as YYYY-MM-DD,
// and cap to today if the date is in the future (Ivanti rejects future DateSubmitted).
function sanitizeInsightDate(raw: string): string {
  // Helper to return yesterday's date as YYYY-MM-DD (safe fallback -- always strictly in the past)
  const yesterdayStr = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - 1);
    return t.toISOString().split("T")[0];
  };

  if (!raw || raw.trim() === "") return yesterdayStr(); // no date from Insight -> use yesterday

  // Try common formats: YYYYMMDD, YYYY-MM-DD, ISO with time, MM/DD/YYYY
  let d: Date | null = null;
  const s = raw.trim();
  if (/^\d{8}$/.test(s)) {
    d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`);
  } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    d = new Date(`${s.slice(0, 10)}T00:00:00`);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split("/");
    d = new Date(`${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}T00:00:00`);
  } else {
    const attempt = new Date(s);
    if (!isNaN(attempt.getTime())) d = attempt;
  }

  if (!d || isNaN(d.getTime())) return yesterdayStr(); // unparseable -> fall back to yesterday

  // Cap to yesterday if date is today or in the future (Ivanti requires strictly past date)
  const yesterday = new Date();
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d >= yesterday) d = yesterday;

  return d.toISOString().split("T")[0];
}

// Extract serial numbers from Insight Format B responses.
// Handles: plain string, string[], and .NET XML->JSON wrapped objects like {"string": "SN"} or {"string": ["SN1","SN2"]}
// Guards against .NET type-name bleed-through (e.g. "System.Collections...") and [object Object].
function extractSerialNumbers(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s.startsWith("System.") || s === "[object Object]") return [];
    return [s];
  }
  if (Array.isArray(raw)) return raw.flatMap((v) => extractSerialNumbers(v));
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // Insight Format B: Delivery.SerialNumbers = [{SerialNumber: "SN   "}, ...]
    if (obj["SerialNumber"] !== undefined) return extractSerialNumbers(obj["SerialNumber"]);
    // .NET XML->JSON pattern: {"string": value}
    const inner = obj["string"] ?? obj["String"] ?? obj["value"] ?? obj["Value"];
    if (inner !== undefined) return extractSerialNumbers(inner);
  }
  return [];
}

// -- Flatten orders -> rows
// Handles three response formats from the Insight /NA/GetStatus endpoint:
//   Format A: MT_Status2Response (new-style /MT/GetStatus2)
//   Format B: StatusOrderResponse[].Order[].{ OrderHeader[], OrderLineItems[] } (prod /NA/GetStatus)
//   Format C: StatusOrderResponse[] with direct order objects (QA legacy /NA/GetStatus)
function flattenRows(data: Record<string, unknown>): Record<string, string>[] {
  // -- Format A: MT_Status2Response
  const mt2 = data["MT_Status2Response"] as { StatusResponse?: StatusOrder | StatusOrder[] } | undefined;
  if (mt2) {
    const raw = mt2["StatusResponse"];
    const orders: StatusOrder[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return flattenLegacyOrders(orders);
  }

  const sor = data["StatusOrderResponse"];
  if (!sor) return [];
  const sorArr: unknown[] = Array.isArray(sor) ? sor : [sor];

  // -- Format B: prod /NA/GetStatus with nested Order[] inside each StatusOrderResponse item
  const firstDataItem = sorArr.find((item) => {
    if (!item || typeof item !== "object") return false;
    const obj = item as Record<string, unknown>;
    return !obj["ResponseMessage"] && Array.isArray(obj["Order"]);
  }) as Record<string, unknown> | undefined;

  if (firstDataItem) {
    const rows: Record<string, string>[] = [];
    for (const sorItem of sorArr) {
      if (!sorItem || typeof sorItem !== "object") continue;
      const sorObj = sorItem as Record<string, unknown>;
      if (sorObj["ResponseMessage"] && !sorObj["Order"]) continue;
      const orderArr: unknown[] = Array.isArray(sorObj["Order"]) ? sorObj["Order"] as unknown[] : [];
      for (const orderRaw of orderArr) {
        if (!orderRaw || typeof orderRaw !== "object") continue;
        const order = orderRaw as Record<string, unknown>;
        const headerArr: unknown[] = Array.isArray(order["OrderHeader"]) ? order["OrderHeader"] as unknown[] : [];
        const header = (headerArr[0] ?? {}) as Record<string, string | number>;
        const linesArr: unknown[] = Array.isArray(order["OrderLineItems"]) ? order["OrderLineItems"] as unknown[] : [];

        const orderBase: Record<string, string> = {
          customerOrderNumber: String(header["CustomerOrderNumber"] ?? ""),
          insightOrderNumber:  String(header["InsightOrderNumber"]  ?? ""),
          customerPONumber:    "",
          orderDate:           sanitizeInsightDate(String(header["OrderCreationDate"] ?? "")),
          orderStatus:         String(header["OrderStatus"]         ?? ""),
          currencyCode:        "",
          webref:              String(header["Webref"]              ?? ""),
          shippingCondition:   String(header["ShippingCondition"]   ?? ""),
          billToName: "", billToAddress1: "", billToCity: "",
          billToState: "", billToZip: "", billToCountry: "",
          shipToName: "", shipToAddress1: "", shipToCity: "",
          shipToState: "", shipToZip: "", shipToCountry: "",
        };

        for (const lineRaw of linesArr) {
          if (!lineRaw || typeof lineRaw !== "object") continue;
          const line = lineRaw as Record<string, unknown>;
          const deliveries: unknown[] = Array.isArray(line["Delivery"]) ? line["Delivery"] as unknown[] : [];
          const firstDelivery = (deliveries[0] ?? {}) as Record<string, string>;

          rows.push({
            ...orderBase,
            insightOrderItem:      String(line["InsightOrderItem"]        ?? ""),
            lineNumber:            String(line["LineNumber"]              ?? ""),
            manufacturerPartNumber: String(line["ManufacturerSKU"]       ?? ""),
            insightPartNumber:     String(line["MaterialNumber"]          ?? ""),
            manufacturerName:      String(line["Manufacturer"]            ?? ""),
            itemDescription:       String(line["MaterialDescription"]     ?? ""),
            productCategory:       String(line["MaterialGroup"]           ?? ""),
            productCategoryName:   String(line["MaterialGroupName"]       ?? ""),
            quantityOrdered:       String(line["Quantity"]                ?? ""),
            quantityShipped:       String(firstDelivery["Quantity"]       ?? ""),
            salesUoM:              String(line["SalesUoM"]               ?? ""),
            lineStatus:            String(line["ItemStatus"]              ?? ""),
            shipDate:              String(firstDelivery["ActualGoodsIssueDate"] ?? ""),
            estimatedDeliveryDate: String(line["EstClientDeliveryDate"]   ?? ""),
            deliveryNumber:        String(firstDelivery["DeliveryNumber"] ?? ""),
            unitPrice:             String(line["UnitPrice"]             ?? line["NetPrice"]           ?? ""),
            extendedPrice:         String(line["ExtendedPrice"]         ?? line["NetValue"]           ?? ""),
            // Delivery.SerialNumbers = [{SerialNumber: "SN   "}, ...] -- extractSerialNumbers handles this shape
            serialNumber:          extractSerialNumbers(firstDelivery["SerialNumbers"] ?? line["SerialNumbers"] ?? firstDelivery["SerialNumber"] ?? line["SerialNumber"])[0] ?? "",
            serialNumbers:         extractSerialNumbers(firstDelivery["SerialNumbers"] ?? line["SerialNumbers"] ?? firstDelivery["SerialNumber"] ?? line["SerialNumber"]).join(","),
            trackingNumber:        String(firstDelivery["TrackingNumber"] ?? firstDelivery["Tracking"] ?? line["TrackingNumber"] ?? ""),
            carrier:               String(firstDelivery["Carrier"]        ?? line["Carrier"]           ?? ""),
            contractNumber:        String(line["ContractNumber"]          ?? line["Contract"]          ?? ""),
            warrantyMonths:        String(line["WarrantyMonths"]          ?? line["Warranty"]          ?? ""),
          });
        }
      }
    }
    return rows;
  }

  // -- Format C: StatusOrderResponse with direct order objects (QA legacy)
  const legacyOrders: StatusOrder[] = [];
  for (const item of sorArr) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (obj["ResponseMessage"] && !obj["CustomerOrderNumber"] && !obj["customerOrderNumber"]) continue;
    const sr = obj["StatusResponse"];
    if (sr) {
      const srArr: StatusOrder[] = Array.isArray(sr) ? sr as StatusOrder[] : [sr as StatusOrder];
      legacyOrders.push(...srArr);
    } else {
      legacyOrders.push(obj as unknown as StatusOrder);
    }
  }
  return flattenLegacyOrders(legacyOrders);
}

function flattenLegacyOrders(orders: StatusOrder[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (const order of orders) {
    const orderBase: Record<string, string> = {
      customerOrderNumber: order.customerOrderNumber  ?? "",
      insightOrderNumber:  order.insightOrderNumber   ?? "",
      customerPONumber:    order.customerPONumber     ?? "",
      orderDate:           sanitizeInsightDate(order.orderDate ?? ""),
      orderStatus:         order.orderStatus          ?? "",
      currencyCode:        order.currencyCode         ?? "",
      billToName:          order.billTo?.name         ?? "",
      billToAddress1:      order.billTo?.addressLine1 ?? "",
      billToCity:          order.billTo?.city         ?? "",
      billToState:         order.billTo?.stateCode    ?? "",
      billToZip:           order.billTo?.postalCode   ?? "",
      billToCountry:       order.billTo?.countryCode  ?? "",
      shipToName:          order.shipTo?.name         ?? "",
      shipToAddress1:      order.shipTo?.addressLine1 ?? "",
      shipToCity:          order.shipTo?.city         ?? "",
      shipToState:         order.shipTo?.stateCode    ?? "",
      shipToZip:           order.shipTo?.postalCode   ?? "",
      shipToCountry:       order.shipTo?.countryCode  ?? "",
    };
    for (const line of order.lines ?? []) {
      const serials = Array.isArray(line.serialNumbers)
        ? line.serialNumbers
        : line.serialNumbers ? [line.serialNumbers as string] : [];
      rows.push({
        ...orderBase,
        lineNumber:             String(line.lineNumber             ?? ""),
        manufacturerPartNumber: line.manufacturerPartNumber        ?? "",
        insightPartNumber:      line.insightPartNumber             ?? "",
        manufacturerName:       line.manufacturerName              ?? "",
        itemDescription:        line.itemDescription               ?? "",
        productCategory:        line.productCategory               ?? "",
        quantityOrdered:        String(line.quantityOrdered        ?? ""),
        quantityShipped:        String(line.quantityShipped        ?? ""),
        unitPrice:              String(line.unitPrice              ?? ""),
        extendedPrice:          String(line.extendedPrice          ?? ""),
        lineStatus:             line.lineStatus                    ?? "",
        shipDate:               line.shipDate                      ?? "",
        serialNumber:           serials[0]                         ?? "",
        serialNumbers:          serials.join(","),
        trackingNumber:         line.trackingNumber                ?? "",
        carrier:                line.carrier                       ?? "",
        contractNumber:         line.contractNumber                ?? "",
        warrantyMonths:         String(line.warrantyMonths         ?? ""),
      });
    }
  }
  return rows;
}


// -- Route handler
//
// POST /api/insight-proxy
//
// Body:
//   { connection_id: string }                              -- daily poll (ShipDate = yesterday)
//   { connection_id: string, ship_date: "YYYY-MM-DD" }    -- specific date
//   { connection_id: string, order_number: string }        -- on-demand by order number
//
// Response: { rows: Record<string,string>[], order_count: number, line_count: number }
//
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as {
      connection_id:   string;
      ship_date?:      string;
      ship_date_from?: string;
      ship_date_to?:   string;
      order_number?:   string;
      _test_body?:     unknown;
    };

    const { connection_id, ship_date, ship_date_from, ship_date_to, order_number, _test_body } = body;
    if (!connection_id) {
      return NextResponse.json({ error: "connection_id required" }, { status: 400 });
    }

    // Load connection
    const admin = createAdminClient();
    const { data: conn, error: connErr } = await admin
      .from("endpoint_connections")
      .select("id, name, type, config")
      .eq("id", connection_id)
      .single();

    if (connErr || !conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (conn.type !== "insight") {
      return NextResponse.json(
        { error: `Expected insight connection, got: ${conn.type}` },
        { status: 400 }
      );
    }

    // Resolve config — support both new shape (environment + client_key) and
    // legacy shape (url + oauth_token_path + status_path + client_id + client_id_header).
    const raw = conn.config as Record<string, string>;
    const isLegacy = !raw.environment && !!raw.url;

    // Credentials
    const oauthKey    = raw.client_key    || raw.client_id  || "";  // Basic-auth username
    const oauthSecret = raw.client_secret || "";                     // Basic-auth password
    const clientId    = raw.client_id_header || (!isLegacy ? raw.client_id : "") || ""; // ClientID header

    if (!oauthKey || !oauthSecret) {
      return NextResponse.json(
        { error: "Insight connection config incomplete (OAuth key and secret are required)" },
        { status: 400 }
      );
    }

    // Build full OAuth token URL
    const base       = isLegacy
      ? (raw.url?.replace(/\/$/, "") ?? "")
      : (ENV_BASE[raw.environment] ?? ENV_BASE["prod-na"]);
    const oauthPath  = isLegacy ? (raw.oauth_token_path || OAUTH_PATH) : OAUTH_PATH;
    // Apigee OAuthV2 policy reads grant_type from the query string; append if absent
    const rawTokenUrl = `${base}${oauthPath}`;
    const tokenUrl = rawTokenUrl.includes("grant_type")
      ? rawTokenUrl
      : `${rawTokenUrl}${rawTokenUrl.includes("?") ? "&" : "?"}grant_type=client_credentials`;

    // Build full GetStatus URL
    const statusPath = isLegacy ? (raw.status_path || STATUS_PATH) : STATUS_PATH;
    const statusUrl  = `${base}${statusPath}`;

    if (!base) {
      return NextResponse.json(
        { error: "Insight connection config incomplete (base URL / environment required)" },
        { status: 400 }
      );
    }

    // Reconstruct as InsightConfig for the token helper
    const cfg: InsightConfig = {
      client_key:    oauthKey,
      client_secret: oauthSecret,
      client_id:     clientId,
      environment:   (raw.environment as InsightConfig["environment"]) || "prod-na",
    };

    // Resolve date window: explicit range > explicit ship_date > per-day lookback > yesterday
    // NOTE: /NA/GetStatus only accepts single ShipDate per call -- no date ranges.
    // We expand ranges into individual dates and fetch them all in parallel.
    const MAX_AUTO_LOOKBACK_DAYS = 90; // cap for automatic lookback only
    const BATCH_SIZE = 50;             // concurrent calls per batch
    const lookbackDays = Math.min(raw.lookback_days ? parseInt(raw.lookback_days, 10) : 1, MAX_AUTO_LOOKBACK_DAYS);
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]; })();

    const datesToQuery: (string | undefined)[] = [];
    if (order_number) {
      datesToQuery.push(undefined); // order number lookup -- no date needed
    } else if (ship_date) {
      datesToQuery.push(ship_date);
    } else if (ship_date_from || ship_date_to) {
      // Explicit import window: expand ALL days in range with no cap
      const from = new Date(ship_date_from ?? yesterday);
      const to   = new Date(ship_date_to   ?? yesterday);
      const cur  = new Date(from);
      while (cur <= to) {
        datesToQuery.push(cur.toISOString().split("T")[0]);
        cur.setDate(cur.getDate() + 1);
      }
      if (datesToQuery.length === 0) datesToQuery.push(yesterday);
    } else if (lookbackDays > 1) {
      for (let i = lookbackDays; i >= 1; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        datesToQuery.push(d.toISOString().split("T")[0]);
      }
    } else {
      datesToQuery.push(yesterday);
    }

    // Fetch / reuse cached Bearer token (cache keyed by connection id)
    const token = await getToken(conn.id, cfg, tokenUrl);

    const reqHeaders: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    };
    if (clientId) reqHeaders["ClientID"] = clientId;

    // Fetch all dates in parallel (max 7) and accumulate rows
    const allRows: Record<string, string>[] = [];
    const allRawDays: Record<string, unknown>[] = [];

    let _rawDebug: unknown = undefined;
    const isDebug = !!(body as Record<string, unknown>)._debug;
    const isRaw   = !!(body as Record<string, unknown>)._raw;

    const fetchDate = async (qDate: string | undefined, captureDebug = false): Promise<Record<string, string>[]> => {
      const reqBody = _test_body ?? buildStatusBody(clientId, qDate, order_number, undefined, undefined);
      const res = await fetch(statusUrl, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("[insight-proxy] date:", qDate, "HTTP", res.status, txt.slice(0, 200));
        if (captureDebug) _rawDebug = { http_status: res.status, body: txt.slice(0, 500), date: qDate, req_body: reqBody, status_url: statusUrl };
        return [];
      }
      const dayData = await res.json() as Record<string, unknown>;
      if (captureDebug) _rawDebug = { http_status: res.status, date: qDate, raw: dayData, req_body: reqBody, status_url: statusUrl };
      if (isRaw) allRawDays.push({ date: qDate, data: dayData });
      return flattenRows(dayData);
    };

    // Batch the fetches to avoid overwhelming the Insight API
    for (let b = 0; b < datesToQuery.length; b += BATCH_SIZE) {
      const batch = datesToQuery.slice(b, b + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((d, i) => fetchDate(d, isDebug && b === 0 && i === 0)));
      for (const result of results) {
        if (result.status === "fulfilled") allRows.push(...result.value);
      }
    }
    const rows = allRows;

    // _raw mode: return the unflattened API responses directly
    if (isRaw) {
      return NextResponse.json({ raw_days: allRawDays });
    }

    const orderSet = new Set(
      rows.map((r) => r.insightOrderNumber || r.customerOrderNumber).filter(Boolean)
    );

    return NextResponse.json({
      rows,
      order_count: orderSet.size,
      line_count:  rows.length,
      ...((isDebug && _rawDebug !== undefined) ? { _debug: _rawDebug } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[insight-proxy] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
