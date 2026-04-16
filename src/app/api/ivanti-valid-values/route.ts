import { NextRequest, NextResponse } from "next/server";

// ── POST /api/ivanti-valid-values ─────────────────────────────────────────────
//
// Fetches the distinct valid values for a specific field on an Ivanti BO,
// designed to work with validation / picklist BOs as well as regular BOs.
//
// Body: {
//   ivantiUrl:       string,
//   apiKey?:         string,
//   tenantId?:       string,
//   businessObject?: string,   // BO to query (default "CI__Computers")
//   fieldName:       string,   // field whose values to collect
// }
//
// Response: { values: string[] }  — sorted, deduplicated, non-empty
//           { values: [], notFound: true, businessObject }  — BO not accessible anywhere
//
const FALLBACK_API_KEY = "251E668B0B42478EB3DA9D6E8446CA0B";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

// When the exact fieldName yields nothing, try these common picklist value fields.
const VALUE_FIELD_CANDIDATES = ["Name", "DisplayName", "Value", "Description"];

// Ivanti OData requires BO names pluralised with a trailing "s".
// e.g. "ivnt_AssetSubType" → "ivnt_AssetSubTypes", "Incident" → "Incidents"
// Avoid double-s for names already ending in "s" (e.g. "CI__Computers" stays as-is).
function oDataBoName(bo: string): string {
  return bo.endsWith("s") ? bo : `${bo}s`;
}

type FetchResult = { rows: Record<string, unknown>[]; status: number };

async function getPage(url: string, headers: Record<string, string>, tried?: string[]): Promise<FetchResult> {
  tried?.push(url);
  try {
    const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { rows: [], status: res.status };
    const body = await res.json() as { value?: unknown } | unknown[];
    // Handles both OData { value: [...] } and plain array responses
    const rows = Array.isArray(body)
      ? (body as Record<string, unknown>[])
      : Array.isArray((body as { value?: unknown }).value)
        ? ((body as { value: Record<string, unknown>[] }).value)
        : [];
    return { rows, status: 200 };
  } catch {
    return { rows: [], status: 0 };
  }
}

// Extract unique non-empty string values for a given key from an array of records.
function extractValues(rows: Record<string, unknown>[], key: string): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) seen.add(v.trim());
  }
  return [...seen];
}

// Scan a BO via OData paginated requests.  Returns values found, or notFound=true on 404.
async function scanOData(
  base: string,
  bo: string,
  field: string,
  headers: Record<string, string>,
  tried?: string[]
): Promise<{ values: string[]; notFound: boolean }> {
  const seen = new Set<string>();

  const boName = oDataBoName(bo);

  // Fast path: groupby aggregation (one request, distinct values)
  const groupUrl = `${base}/api/odata/businessobject/${boName}?$apply=groupby((${field}))&$top=${PAGE_SIZE}`;
  const { rows: groupRows, status: groupStatus } = await getPage(groupUrl, headers, tried);
  if (groupStatus === 200) {
    const vals = extractValues(groupRows, field);
    if (vals.length > 0) return { values: vals, notFound: false };
  }

  // Paginated scan
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${base}/api/odata/businessobject/${boName}?$select=${field}&$top=${PAGE_SIZE}&$skip=${page * PAGE_SIZE}`;
    const { rows, status } = await getPage(url, headers, tried);
    if (status === 404) return { values: [], notFound: true };
    if (status !== 200) break;
    for (const v of extractValues(rows, field)) seen.add(v);
    if (rows.length < PAGE_SIZE) break;
  }

  return { values: [...seen], notFound: false };
}

// Scan a BO via the classic Ivanti REST API (non-OData).
// Ivanti exposes some BOs here that OData doesn't surface.
async function scanREST(
  base: string,
  bo: string,
  field: string,
  headers: Record<string, string>,
  tried?: string[]
): Promise<{ values: string[]; notFound: boolean }> {
  const seen = new Set<string>();

  // Try two common classic REST URL patterns
  const urlPatterns = [
    `${base}/api/rest/businessobject/${bo}?$select=${field}&$top=${PAGE_SIZE}`,
    `${base}/api/rest/${bo}?$select=${field}&$top=${PAGE_SIZE}`,
  ];

  for (const url of urlPatterns) {
    const { rows, status } = await getPage(url, headers, tried);
    if (status === 404 || status === 0) continue;
    if (status === 200 && rows.length > 0) {
      for (const v of extractValues(rows, field)) seen.add(v);
      // If we got a full page, keep paging
      if (rows.length === PAGE_SIZE) {
        for (let page = 1; page < MAX_PAGES; page++) {
          const pageUrl = url.replace(`$top=${PAGE_SIZE}`, `$top=${PAGE_SIZE}&$skip=${page * PAGE_SIZE}`);
          const { rows: pr, status: ps } = await getPage(pageUrl, headers);
          if (ps !== 200) break;
          for (const v of extractValues(pr, field)) seen.add(v);
          if (pr.length < PAGE_SIZE) break;
        }
      }
      if (seen.size > 0) return { values: [...seen], notFound: false };
    }
  }

  // 404 from all patterns means truly not found
  return { values: [], notFound: true };
}

// Try a BO with the given field; if that returns nothing, try common fallback field names.
async function scanWithFallbackFields(
  base: string,
  bo: string,
  field: string,
  headers: Record<string, string>,
  tried: string[]
): Promise<{ values: string[]; notFound: boolean; fieldUsed: string }> {

  // 1. OData with exact field
  let result = await scanOData(base, bo, field, headers, tried);
  if (result.values.length > 0) return { ...result, fieldUsed: field };

  if (!result.notFound) {
    // BO is accessible but field returned nothing — try candidate fields
    for (const candidate of VALUE_FIELD_CANDIDATES) {
      if (candidate === field) continue;
      const r = await scanOData(base, bo, candidate, headers, tried);
      if (r.values.length > 0) return { ...r, fieldUsed: candidate };
    }
  }

  // 2. OData returned 404 — try classic REST API
  if (result.notFound) {
    const restResult = await scanREST(base, bo, field, headers, tried);
    if (restResult.values.length > 0) return { ...restResult, fieldUsed: field };

    if (!restResult.notFound) {
      // REST BO accessible but field empty — try candidate fields
      for (const candidate of VALUE_FIELD_CANDIDATES) {
        if (candidate === field) continue;
        const r = await scanREST(base, bo, candidate, headers, tried);
        if (r.values.length > 0) return { ...r, fieldUsed: candidate };
      }
    }

    if (restResult.notFound) {
      return { values: [], notFound: true, fieldUsed: field };
    }
  }

  return { values: [], notFound: false, fieldUsed: field };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      ivantiUrl: string;
      apiKey?: string;
      tenantId?: string;
      businessObject?: string;
      fieldName: string;
    };

    const { ivantiUrl, fieldName } = body;
    if (!ivantiUrl || !fieldName) {
      return NextResponse.json({ error: "ivantiUrl and fieldName are required" }, { status: 400 });
    }

    const apiKey         = body.apiKey         ?? FALLBACK_API_KEY;
    const businessObject = body.businessObject ?? "CI__Computers";
    const base           = ivantiUrl.replace(/\/$/, "");

    const headers: Record<string, string> = {
      Authorization: `rest_api_key=${apiKey}`,
      Accept: "application/json",
    };
    if (body.tenantId) headers["X-Tenant-Id"] = body.tenantId;

    const tried: string[] = [];
    const { values, notFound, fieldUsed } = await scanWithFallbackFields(base, businessObject, fieldName, headers, tried);

    if (notFound) {
      // Strip query strings from tried URLs for readability
      const triedPaths = [...new Set(tried.map((u) => u.split("?")[0]))];
      console.log(`[ivanti-valid-values] Not found. Tried: ${triedPaths.join(", ")}`);
      return NextResponse.json({ values: [], notFound: true, businessObject, triedUrls: triedPaths }, { status: 200 });
    }

    const unique = [...new Set(values)].sort((a, b) => a.localeCompare(b));
    console.log(`[ivanti-valid-values] ${businessObject}.${fieldUsed}: ${unique.length} unique values`);
    return NextResponse.json({ values: unique });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
