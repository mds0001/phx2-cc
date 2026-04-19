import { NextRequest, NextResponse } from "next/server";

const FALLBACK_API_KEY = "251E668B0B42478EB3DA9D6E8446CA0B";

// Module-level cache: maps "${base}:${boName}" -> resolved (pluralized) BO name.
// Avoids a $top=0 probe on every row — probe runs once per BO per process lifetime.
const boNameCache = new Map<string, string>();

// Module-level cache for link-field resolution: maps "${boName}::${displayValue}" -> RecID.
// null = lookup was attempted but failed (so we skip retrying on every row).
const linkFieldCache = new Map<string, string | null>();

// Escape a string value for use inside an OData $filter single-quoted literal.
function odataEscape(val: string): string {
  return val.replace(/'/g, "''");
}

// Encode an Ivanti business-object name for use in a URL path segment.
// Ivanti uses '#' as a namespace separator (e.g. "AddressCountry#", "Location#").
// Node.js fetch() treats bare '#' as a fragment delimiter and strips everything
// from it onward, so '#' must be percent-encoded as '%23' in URL paths.
function encodeBoForUrl(name: string): string {
  return name.replace(/#/g, "%23");
}

// Derive a candidate Ivanti business-object name from a _Link field name.
//   "ivnt_AssignedManufacturerLink" -> "Manufacturer"
//   "ivnt_AssignedModelLink"        -> "Model"
//   "SomethingLink"                 -> "Something"
function boNameFromLinkField(fieldName: string): string | null {
  let name = fieldName;
  if (name.startsWith("ivnt_Assigned")) name = name.slice("ivnt_Assigned".length);
  else if (name.startsWith("ivnt_"))    name = name.slice("ivnt_".length);
  name = name.replace(/Link$/, "");
  return name || null;
}
// Convert Excel serial date numbers to ISO date strings for Ivanti.
// Excel epoch = Dec 30 1899; JS epoch = Jan 1 1970 => offset of 25569 days.
// Converts fields whose name suggests a date value (case-insensitive keywords)
// and whose value is an integer in the range 25569–73050 (roughly 1970–2099).
const DATE_FIELD_KEYWORDS = ["date", "expir", "yearend", "year_end", "fiscal", "warranty", "renewal", "purchased", "retired", "disposed", "received"];
function looksLikeDateField(key: string): boolean {
  const k = key.toLowerCase().replace(/[_\s]/g, "");
  return DATE_FIELD_KEYWORDS.some((kw) => k.includes(kw));
}
function convertExcelDates(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(result)) {
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 25569 &&
      value <= 73050 &&
      looksLikeDateField(key)
    ) {
      const ms = (value - 25569) * 86_400_000;
      const iso = new Date(ms).toISOString().split("T")[0]; // YYYY-MM-DD
      result[key] = iso;
    }
  }
  return result;
}



type ResolvedField = { field: string; value: string; recId: string } | { field: string; value: string; error: string };

// For each _Link field in the payload that carries a display-name string,
// query Ivanti to resolve it to a RecId, then replace the field value with
// the nested object { RecID: "guid" } that OData v4 requires for link fields.
// Returns the modified payload plus a log of what was resolved/failed.
async function resolveLinkFields(
  payload: Record<string, unknown>,
  ivantiUrl: string,
  apiKey: string,
  tenantId?: string,
  businessObject = "CI__Computers",
  linkFieldNames: string[] = [],
  linkFieldBoNames: Record<string, string> = {},
  linkFieldLookupFields: Record<string, string> = {}
): Promise<{ resolved: Record<string, unknown>; log: ResolvedField[] }> {
  const result: Record<string, unknown> = { ...payload };
  const log: ResolvedField[] = [];
  const base = ivantiUrl.replace(/\/$/, "");

  for (const [key, value] of Object.entries(payload)) {
    // Process fields that are either auto-detected _Link fields or explicitly
    // marked as link fields by the user via the mapping editor.
    const isExplicitLink = linkFieldNames.includes(key);
    // Auto-detect "Link"-suffix fields ONLY when the caller has NOT provided an
    // explicit list. When an explicit list is present, trust it completely —
    // don't add extra lookups for fields the user intentionally left unchecked.
    const isAutoLink = linkFieldNames.length === 0 && key.endsWith("Link");
    if (!isAutoLink && !isExplicitLink) continue;
    if (typeof value !== "string" || !value.trim()) continue;

    // Use the explicit BO name supplied by the user in the mapping editor, or
    // fall back to auto-deriving it from the field name.
    const boName = linkFieldBoNames[key] ?? boNameFromLinkField(key);
    console.log(`[ivanti-proxy] resolveLink field="${key}" explicit boName="${linkFieldBoNames[key]}" derived="${boNameFromLinkField(key)}" using="${boName}"`);
    if (!boName) continue;

    // ── Module-level cache check ─────────────────────────────
    // Avoids repeating expensive multi-variant lookups for the same (boName, value)
    // pair across rows.  null in the cache means "previously tried and failed".
    const lfCacheKey = `${boName}::${value}`;
    if (linkFieldCache.has(lfCacheKey)) {
      const cached = linkFieldCache.get(lfCacheKey)!;
      if (cached) {
        delete result[key];
        result[`${key}_RecID`] = cached;
        log.push({ field: key, value, recId: cached });
        console.log(`[ivanti-proxy] ${key}="${value}" -> ${key}_RecID="${cached}" (cache hit)`);
      } else {
        log.push({ field: key, value, error: "Cached: lookup previously failed — skipping retry" });
        console.warn(`[ivanti-proxy] ${key}="${value}": skipping (cached failure)`);
      }
      continue;
    }

    const headers: Record<string, string> = {
      Authorization: `rest_api_key=${apiKey}`,
      Accept: "application/json",
    };
    if (tenantId) headers["X-Tenant-Id"] = tenantId;

    const escapedVal = odataEscape(value);
    let recId: string | null = null;
    let lastError = "";

    // --- Strategy 1: Direct lookup against the linked BO ---
    // Ivanti BO URLs are pluralised and lowercased (e.g. "Manufacturer" -> "manufacturers").
    // Also try with the '#' separator that Ivanti uses for namespaced BOs
    // (e.g. admin UI shows "Manufacturer#", API path may be "manufacturer%23s").
    const boLower = boName.toLowerCase();
    // When the caller explicitly told us the BO name (via linkFieldBoNames), trust it and
    // use a focused variant list. The exhaustive 12-variant list only runs when we have to
    // guess the BO name from the field name alone.
    const hasExplicitBoName = !!linkFieldBoNames[key];
    const boVariants = hasExplicitBoName
      ? [
          `frs_offering_${boName}`,   // most common pattern for Ivanti Neurons picklist BOs
          `frs_offering_${boLower}`,
          boName,                     // exact name as given
          `${boName}s`,               // pluralized
          `${boLower}s`,
          `frs_${boLower}`,
        ]
      : [
          `${boLower}s`,
          `${boName}s`,
          `${boLower}%23s`,
          `${boName}%23s`,
          boName,
          `${boName}%23`,
          `frs_${boName}`,
          `frs_${boLower}`,
          `frs_offering_${boName}`,
          `frs_offering_${boLower}`,
          `frs_offering_${boLower}s`,
          `CI_${boName}`,
        ];
    // When the user explicitly specified a lookup field in the mapping editor, use ONLY
    // that field — no guessing, no fallback list. This is the fastest and most accurate path.
    // Otherwise fall back to the per-BO focused list (explicit BO name) or the broad list.
    const explicitLookupField = linkFieldLookupFields[key];
    const lookupFields = explicitLookupField
      ? [explicitLookupField]
      : hasExplicitBoName
        ? [boName, "Name", "DisplayName"]
        : [boName, "Name", "LoginName", "DisplayName", "FullName", "Email", "PrimaryEmail", "EmailAddress"];

    directSearch:
    for (const boVariant of boVariants) {
      for (const lookupField of lookupFields) {
        for (const filter of [
          `${lookupField} eq '${escapedVal}'`,
          `tolower(${lookupField}) eq tolower('${escapedVal}')`,
          `startswith(tolower(${lookupField}),tolower('${escapedVal}'))`,
        ]) {
          try {
            const url = `${base}/api/odata/businessobject/${boVariant}?$filter=${filter}&$select=RecId`;
            console.log(`[ivanti-proxy] Direct lookup ${key}: GET ${url}`);
            const res = await fetch(url, { method: "GET", headers });
            if (!res.ok) { lastError = `HTTP ${res.status} for ${boVariant}`; continue; }
            const json = (await res.json()) as { value?: Array<{ RecId?: string }> };
            const row = json.value?.[0];
            if (row?.RecId) { recId = row.RecId; break directSearch; }
            lastError = `No record in ${boVariant} where ${lookupField}='${escapedVal}'`;
          } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
        }
      }
    }

    // --- Strategy 2: Indirect lookup via existing CI records ---
    // If the linked BO is not directly queryable, find an existing record in
    // the target BO (e.g. CI__Computers) that already has the same display
    // value and reuse its _RecID.
    if (!recId) {
      try {
        const recIdField = `${key}_RecID`;
        const indirectUrl =
          `${base}/api/odata/businessobject/${businessObject}` +
          `?$filter=${key} eq '${escapedVal}'&$select=${recIdField}&$top=1`;
        console.log(`[ivanti-proxy] Indirect lookup ${key}: GET ${indirectUrl}`);
        const res = await fetch(indirectUrl, { method: "GET", headers });
        if (res.ok) {
          const json = (await res.json()) as { value?: Array<Record<string, string>> };
          const row = json.value?.[0];
          const rid = row?.[recIdField];
          // Only accept a proper GUID-style RecID (not the display value echoed back)
          if (rid && rid !== value && rid.length >= 16) {
            recId = rid;
            console.log(`[ivanti-proxy] Indirect RecID found for ${key}='${value}': ${recId}`);
          } else {
            lastError = `Indirect lookup returned no valid RecID (got: ${rid ?? "nothing"})`;
          }
        } else {
          lastError += ` | Indirect HTTP ${res.status}`;
        }
      } catch (e) {
        lastError += ` | Indirect error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    if (recId) {
      // Ivanti (Neurons) resolves link fields via a flat _RecID companion field.
      // Remove the display-value string and set the RecID field instead.
      linkFieldCache.set(lfCacheKey, recId);
      delete result[key];
      result[`${key}_RecID`] = recId;
      log.push({ field: key, value, recId });
      console.log(`[ivanti-proxy] ${key}="${value}" -> ${key}_RecID="${recId}" (cached)`);
    } else {
      linkFieldCache.set(lfCacheKey, null); // cache failure — skip on subsequent rows
      log.push({ field: key, value, error: lastError || "Unknown lookup failure" });
      console.warn(`[ivanti-proxy] Could not resolve ${key}="${value}": ${lastError}`);
    }
  }

  return { resolved: result, log };
}


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── Mode: check-exists ────────────────────────────────────────────────────
    // Batch-checks which of the supplied key values already exist in the target BO.
    // Used by SchedulerClient in create_only mode to pre-filter rows before AI pre-fetch,
    // so we don't classify assets that will never be written.
    //
    // Body: { mode:"check-exists", ivantiUrl, apiKey?, businessObject?, tenantId?, upsertKey?, keyValues: string[] }
    // Returns: { existing: string[] }  — the subset of keyValues that already exist.
    if ((body as { mode?: string }).mode === "check-exists") {
      const { ivantiUrl: ceUrl, apiKey: ceApiKey, businessObject: ceBo, tenantId: ceTenant,
              upsertKey: ceKey, keyValues } = body as {
        ivantiUrl: string;
        apiKey?: string;
        businessObject?: string;
        tenantId?: string;
        upsertKey?: string;
        keyValues: string[];
      };
      if (!ceUrl || !Array.isArray(keyValues) || keyValues.length === 0) {
        return NextResponse.json({ existing: [] });
      }
      const resolvedCeKey  = ceApiKey ?? FALLBACK_API_KEY;
      const resolvedCeBo   = encodeBoForUrl(ceBo ?? "CI__Computers");
      const keyField       = ceKey ?? "Name";
      const base           = ceUrl.replace(/\/$/, "");
      const endpoint       = `${base}/api/odata/businessobject/${resolvedCeBo}`;
      const headers: Record<string, string> = {
        Authorization: `rest_api_key=${resolvedCeKey}`,
        Accept: "application/json",
      };
      if (ceTenant) headers["X-Tenant-Id"] = ceTenant;

      const CHUNK = 25;   // OData filter length stays manageable
      const existing: string[] = [];

      for (let i = 0; i < keyValues.length; i += CHUNK) {
        const chunk = keyValues.slice(i, i + CHUNK);
        const filterParts = chunk.map((v) => `${keyField} eq '${v.replace(/'/g, "''")}'`);
        const url = `${endpoint}?$filter=${encodeURIComponent(filterParts.join(" or "))}&$select=${keyField}&$top=${CHUNK}`;
        try {
          const res = await fetch(url, { method: "GET", headers });
          if (res.ok) {
            const text = await res.text();
            if (text.trim()) {
              const j = JSON.parse(text) as { value?: Array<Record<string, unknown>> };
              for (const row of j.value ?? []) {
                const val = row[keyField];
                if (typeof val === "string") existing.push(val);
              }
            }
          }
        } catch (e) {
          console.warn("[ivanti-proxy] check-exists chunk failed:", e);
        }
      }

      console.log(`[ivanti-proxy] check-exists: ${existing.length}/${keyValues.length} already exist`);
      return NextResponse.json({ existing });
    }

    const { ivantiUrl, data, apiKey, businessObject, tenantId, linkFieldNames, linkFieldBoNames, linkFieldLookupFields, upsertKey, upsertKeys, skipIfExists } = body as {
      ivantiUrl: string;
      data: Record<string, unknown>;
      apiKey?: string;
      businessObject?: string;
      tenantId?: string;
      linkFieldNames?: string[];
      linkFieldBoNames?: Record<string, string>;
      /** Per-field explicit lookup field name: when set, the proxy uses only this field
       *  to match the display value in the linked BO (e.g. { ivnt_VendorLink: "Name" }). */
      linkFieldLookupFields?: Record<string, string>;
      upsertKey?: string;
      /** Composite upsert key — one or more target field names that together identify
       *  a unique record. Takes precedence over the legacy upsertKey (single field). */
      upsertKeys?: string[];
      /** When true: if a record with the same key already exists, return a skipped response
       *  instead of PATCHing it. */
      skipIfExists?: boolean;
    };

    if (!ivantiUrl || !data) {
      return NextResponse.json(
        { error: "Missing required fields: ivantiUrl and data" },
        { status: 400 }
      );
    }

    const resolvedKey    = apiKey         ?? FALLBACK_API_KEY;
    const resolvedObject = businessObject ?? "CI__Computers";

    // If the payload explicitly specifies a CIType, route to the matching Ivanti CI BO.
    // Ivanti validates ivnt_AssetSubtype (and other _Valid fields) per BO; writing a
    // PeripheralDevice record to CI__Computers fails with "not in validation list".
    const CI_TYPE_BO_MAP: Record<string, string> = {
      "Computer":         "CI__Computers",
      "PeripheralDevice": "CI__PeripheralDevices",
      "MobileDevice":     "CI__MobileDevices",
      "NetworkDevice":    "CI__NetworkDevices",
      "Server":           "CI__Servers",
      "Printer":          "CI__Printers",
    };
    const payloadCIType = (data as Record<string, unknown>)?.CIType as string | undefined;
    const effectiveObject = (payloadCIType && CI_TYPE_BO_MAP[payloadCIType])
      ? CI_TYPE_BO_MAP[payloadCIType]
      : resolvedObject;
    if (effectiveObject !== resolvedObject) {
      console.log(`[ivanti-proxy] CIType="${payloadCIType}" → routing to BO: ${effectiveObject}`);
    }

    // Convert Excel serial dates to ISO strings before posting
    const dateConvertedData = convertExcelDates(data);

    // Resolve any _Link fields (display name -> RecID) before posting
    const { resolved: resolvedData, log: resolveLog } = await resolveLinkFields(
      dateConvertedData, ivantiUrl, resolvedKey, tenantId, effectiveObject, linkFieldNames ?? [], linkFieldBoNames ?? {}, linkFieldLookupFields ?? {}
    );

    const base = ivantiUrl.replace(/\/$/, "");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `rest_api_key=${resolvedKey}`,
      Accept: "application/json",
    };
    if (tenantId) headers["X-Tenant-Id"] = tenantId;

    // Resolve the correct BO endpoint name — try as-is, then pluralized (Ivanti Neurons
    // uses plural entity set names: Location→Locations, Vendor→Vendors, etc.)
    // '#' in BO names is an Ivanti namespace separator and must be percent-encoded
    // as '%23' in URL paths — Node.js fetch() treats bare '#' as a fragment delimiter
    // and strips everything from it onward, producing a malformed request path.
    // Result is cached at module level so the probe only runs once per BO per process.
    const cacheKey = `${base}:${effectiveObject}`;
    let resolvedBoName: string;
    if (boNameCache.has(cacheKey)) {
      resolvedBoName = boNameCache.get(cacheKey)!;
      console.log(`[ivanti-proxy] BO name cache hit: ${effectiveObject} -> ${resolvedBoName}`);
    } else {
      resolvedBoName = encodeBoForUrl(effectiveObject);
      const baseName = encodeBoForUrl(effectiveObject);
      const probeNames = baseName.endsWith("s")
        ? [baseName]
        : [baseName, baseName + "s"];
      for (const candidate of probeNames) {
        try {
          const probeRes = await fetch(`${base}/api/odata/businessobject/${candidate}?$top=0`, { headers });
          if (probeRes.ok) { resolvedBoName = candidate; break; }
        } catch { /* try next */ }
      }
      boNameCache.set(cacheKey, resolvedBoName);
      console.log(`[ivanti-proxy] BO name probe: ${effectiveObject} -> ${resolvedBoName} (cached)`);
    }
    const endpoint = `${base}/api/odata/businessobject/${resolvedBoName}`;

    // ── Upsert: check for an existing record by key field(s) ─────────────────
    // upsertKeys (array) takes precedence over the legacy upsertKey (single field).
    // Falls back to "Name" when neither is supplied.
    const keyFields: string[] = (upsertKeys && upsertKeys.length > 0)
      ? upsertKeys
      : [upsertKey ?? "Name"];

    // Build the OData $filter — compound AND for multiple key fields.
    const filterParts = keyFields
      .map((f) => {
        const v = resolvedData[f];
        if (v === null || v === undefined || v === "") return null;
        const escaped = String(v).replace(/'/g, "''");
        return `${f} eq '${escaped}'`;
      })
      .filter((p): p is string => p !== null);

    let existingRecId: string | null = null;

    if (filterParts.length > 0) {
      try {
        const filter = filterParts.join(" and ");
        const lookupUrl = `${endpoint}?$filter=${encodeURIComponent(filter)}&$select=RecId&$top=1`;
        console.log("[ivanti-proxy] Upsert lookup:", lookupUrl);
        const lookupRes = await fetch(lookupUrl, { method: "GET", headers });
        if (lookupRes.ok) {
          // Ivanti sometimes returns an empty body when no record is found — guard against that.
          const text = await lookupRes.text();
          if (text.trim()) {
            const j = JSON.parse(text) as { value?: Array<{ RecId?: string }> };
            existingRecId = j.value?.[0]?.RecId ?? null;
          }
        }
      } catch (e) {
        console.warn("[ivanti-proxy] Upsert lookup failed, will POST:", e);
      }
    }

    // ── Skip if exists (create_only mode) ────────────────────────────────────
    if (skipIfExists && existingRecId) {
      const keyDesc = keyFields.map((f) => `${f}="${resolvedData[f] ?? ""}"`).join(", ");
      console.log(`[ivanti-proxy] Skipping existing record (${keyDesc}, RecId=${existingRecId})`);
      return NextResponse.json({
        status:  200,
        skipped: true,
        reason:  `Record already exists (${keyDesc})`,
        upsert:  { method: "SKIP", existingRecId },
      });
    }

    // Helper: send the request and read the response body once.
    const sendRequest = async (payload: Record<string, unknown>) => {
      let res: Response;
      if (existingRecId) {
        const patchUrl = `${endpoint}('${existingRecId}')`;
        console.log("[ivanti-proxy] PATCH (update):", patchUrl);
        console.log("[ivanti-proxy] Resolved payload:", JSON.stringify(payload));
        res = await fetch(patchUrl, { method: "PATCH", headers, body: JSON.stringify(payload) });
      } else {
        console.log("[ivanti-proxy] POST (create):", endpoint);
        console.log("[ivanti-proxy] Resolved payload:", JSON.stringify(payload));
        res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      }
      let body: unknown;
      if (res.status === 204) {
        body = null;
      } else {
        const ct = res.headers.get("content-type") ?? "";
        body = ct.includes("application/json") ? await res.json() : await res.text();
      }
      return { res, body };
    };

    let { res: response, body: responseBody } = await sendRequest(resolvedData);

    // Auto-retry: if Ivanti returns 400 UndefinedValidatedValue, strip the offending
    // validated fields and retry once.  This handles cases where the AI guessed a
    // subtype that is valid in a different CI type's validation list (e.g. "All-In-One"
    // is not in CI.Computer's list even though it exists in the global picklist).
    if (response.status === 400 && typeof responseBody === "object" && responseBody !== null) {
      const messages: string[] = (responseBody as { message?: string[] }).message ?? [];
      const invalidFieldRx = /UndefinedValidatedValue: '[^']+' is not in the validation list of validated field [^.]+\.([^\s;,.]+)/g;
      const invalidFields = new Set<string>();
      for (const msg of messages) {
        let m: RegExpExecArray | null;
        while ((m = invalidFieldRx.exec(msg)) !== null) invalidFields.add(m[1]);
      }
      if (invalidFields.size > 0) {
        console.warn(`[ivanti-proxy] Retrying without invalid validated fields: ${[...invalidFields].join(", ")}`);
        // Capture the rejected field values before stripping so the caller can surface them.
        const strippedFieldsList = [...invalidFields];
        const strippedFieldValues: Record<string, unknown> = {};
        for (const f of strippedFieldsList) {
          strippedFieldValues[f] = (resolvedData as Record<string, unknown>)[f];
        }
        const stripped = { ...resolvedData };
        for (const f of invalidFields) delete stripped[f];
        const retry = await sendRequest(stripped);
        response      = retry.res;
        responseBody  = retry.body;
        // Attach to outer scope so the final return can include them.
        (response as Response & { _strippedFields?: string[]; _strippedValues?: Record<string, unknown> })._strippedFields = strippedFieldsList;
        (response as Response & { _strippedFields?: string[]; _strippedValues?: Record<string, unknown> })._strippedValues = strippedFieldValues;
      }
    }

    // Extract any retry-stripping metadata attached above.
    const _resp = response as Response & { _strippedFields?: string[]; _strippedValues?: Record<string, unknown> };
    const strippedFields = _resp._strippedFields;
    const strippedValues = _resp._strippedValues;

    const method = existingRecId ? "PATCH" : "POST";
    console.log(`[ivanti-proxy] ${method} response status:`, response.status);
    console.log("[ivanti-proxy] Response body:", JSON.stringify(responseBody));

    return NextResponse.json(
      {
        status: response.status === 204 ? 200 : response.status,
        statusText: response.status === 204 ? "OK (updated)" : response.statusText,
        body: responseBody,
        linkResolution: resolveLog,
        upsert: { method, existingRecId },
        ...(strippedFields?.length ? { strippedFields, strippedValues } : {}),
      },
      { status: response.ok || response.status === 204 ? 200 : response.status }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    console.error("[ivanti-proxy] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


// Helper: discover field names for an Ivanti Business Object without needing records.
// Tries OData $metadata (per-BO and global) then falls back to the REST schema endpoint.
async function fetchMetadataFields(
  base: string,
  boName: string,
  headers: Record<string, string>
): Promise<{ fields: string[]; metaUrl: string } | { error: string }> {
  const attemptLog: string[] = [];

  // ── Strategy A: OData $metadata ──────────────────────────────────────────
  // Per-BO metadata only contains the one EntityType we need, so we can
  // extract all <Property> elements without searching for a specific type name.
  // Global metadata contains every type; we search for the matching EntityType.
  const boLower = boName.toLowerCase();
  // Ivanti uses '#' as a namespace separator in BO names (e.g. "CI#Computers").
  // Connection configs store this as '__' (e.g. "CI__Computers"). In OData URLs
  // the '#' must be percent-encoded as '%23'.
  const boHash  = boLower.replace(/__/g, "%23");   // ci%23computers
  const metaAttempts: Array<{ url: string; perBo: boolean }> = [
    { url: `${base}/api/odata/businessobject/${boName}/$metadata`,    perBo: true  },
    { url: `${base}/api/odata/businessobject/${boLower}/$metadata`,   perBo: true  },
    { url: `${base}/api/odata/businessobject/${boHash}/$metadata`,    perBo: true  },
    { url: `${base}/api/odata/businessobject/$metadata`,              perBo: false },
    { url: `${base}/api/odata/$metadata`,                             perBo: false },
  ];

  for (const { url: metaUrl, perBo } of metaAttempts) {
    try {
      console.log("[ivanti-proxy] Trying OData metadata:", metaUrl);
      const res = await fetch(metaUrl, {
        method: "GET",
        headers: { ...headers, Accept: "application/xml,text/xml,*/*" },
      });
      attemptLog.push(`${metaUrl} -> HTTP ${res.status}`);
      if (!res.ok) { console.warn(`[ivanti-proxy] ${metaUrl}: HTTP ${res.status}`); continue; }

      const xml = await res.text();
      if (!xml.includes("<Property")) {
        console.warn(`[ivanti-proxy] ${metaUrl}: no <Property> elements in response`);
        continue;
      }

      let searchXml = xml;

      if (!perBo) {
        // Global metadata — find the EntityType block that matches this BO.
        const candidates = [
          boName,
          boName.replace(/__/g, "_"),
          boName.replace(/.*__/, ""),
          boLower,
        ];
        let found = false;
        for (const candidate of candidates) {
          const start = xml.indexOf(`<EntityType Name="${candidate}"`);
          if (start === -1) continue;
          const end = xml.indexOf("</EntityType>", start);
          if (end === -1) continue;
          searchXml = xml.slice(start, end + "</EntityType>".length);
          console.log(`[ivanti-proxy] Matched EntityType "${candidate}" in global metadata`);
          found = true;
          break;
        }
        if (!found) {
          // Log available types and stop — got valid XML, just wrong BO name.
          const allNames: string[] = [];
          const nameRe = /<EntityType\s[^>]*\bName="([^"]+)"/g;
          let nm: RegExpExecArray | null;
          while ((nm = nameRe.exec(xml)) !== null) allNames.push(nm[1]);
          const preview = allNames.slice(0, 20).join(", ") + (allNames.length > 20 ? "..." : "");
          return {
            error:
              `$metadata found but no EntityType matched "${boName}". ` +
              `Available (first 20): ${preview}. Attempts: ${attemptLog.join(" | ")}`,
          };
        }
      }

      // Extract <Property Name="..."> — skips NavigationProperty automatically.
      const propRegex = /<Property\s[^>]*\bName="([^"]+)"/g;
      const names: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = propRegex.exec(searchXml)) !== null) names.push(m[1]);

      if (names.length > 0) {
        console.log(`[ivanti-proxy] OData metadata: ${names.length} fields from ${metaUrl}`);
        return { fields: names, metaUrl };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attemptLog.push(`${metaUrl} -> error: ${msg}`);
      console.warn(`[ivanti-proxy] Metadata fetch error at ${metaUrl}:`, msg);
    }
  }

  // ── Strategy B: REST schema endpoint ─────────────────────────────────────
  // Ivanti exposes /api/rest/businessobject/{name}/schema on many tenants.
  for (const name of [boName, boLower]) {
    const schemaUrl = `${base}/api/rest/businessobject/${name}/schema`;
    try {
      console.log("[ivanti-proxy] Trying REST schema:", schemaUrl);
      const res = await fetch(schemaUrl, {
        method: "GET",
        headers: { ...headers, Accept: "application/json" },
      });
      attemptLog.push(`${schemaUrl} -> HTTP ${res.status}`);
      if (!res.ok) { console.warn(`[ivanti-proxy] ${schemaUrl}: HTTP ${res.status}`); continue; }

      const text = await res.text();
      let schema: unknown;
      try { schema = JSON.parse(text); } catch { continue; }

      // Extract all field Name values from common response shapes.
      const names: string[] = [];
      const obj = schema as Record<string, unknown>;
      const fields = (obj.Fields ?? obj.fields ?? obj.Properties ?? obj.properties) as unknown;
      if (Array.isArray(fields)) {
        for (const f of fields) {
          const n = (f as Record<string, unknown>).Name ?? (f as Record<string, unknown>).name;
          if (typeof n === "string" && n) names.push(n);
        }
      }
      if (names.length > 0) {
        console.log(`[ivanti-proxy] REST schema: ${names.length} fields from ${schemaUrl}`);
        return { fields: names, metaUrl: schemaUrl };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attemptLog.push(`${schemaUrl} -> error: ${msg}`);
    }
  }

  return {
    error: `All schema discovery methods failed. Attempts: ${attemptLog.join(" | ")}`,
  };
}

// PUT: read all records from an Ivanti business object
// Body: { ivantiUrl, apiKey?, businessObject?, tenantId?, top?, skip? }
// Returns: { rows: [...], count: N }
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { ivantiUrl, apiKey, businessObject, tenantId, top, skip } = body as {
      ivantiUrl: string;
      apiKey?: string;
      businessObject?: string;
      tenantId?: string;
      top?: number;
      skip?: number;
    };

    if (!ivantiUrl) {
      return NextResponse.json({ error: "Missing ivantiUrl" }, { status: 400 });
    }

    const resolvedKey    = apiKey         ?? FALLBACK_API_KEY;
    const resolvedObject = encodeBoForUrl(businessObject ?? "CI__Computers");

    // Ivanti enforces a hard cap of 100 records per page.
    // We page through using $skip since this instance doesn't return @odata.nextLink.
    const PAGE_SIZE = top ?? 100;

    const baseUrl = `${ivantiUrl.replace(/\/$/, "")}/api/odata/businessobject/${resolvedObject}`;

    const headers: Record<string, string> = {
      Authorization: `rest_api_key=${resolvedKey}`,
      Accept: "application/json",
    };
    if (tenantId) headers["X-Tenant-Id"] = tenantId;

    const allRows: Record<string, unknown>[] = [];
    let pageCount = 0;
    // Start at caller-supplied skip (default 0) for the first page
    let currentSkip = skip ?? 0;
    // nextLink from @odata.nextLink takes priority when present
    let nextUrl: string | null = null;

    // Build the first URL with $top and optional $skip
    const firstParams = new URLSearchParams();
    firstParams.set("$top", String(PAGE_SIZE));
    if (currentSkip > 0) firstParams.set("$skip", String(currentSkip));
    nextUrl = `${baseUrl}?${firstParams.toString()}`;

    while (nextUrl) {
      console.log(`[ivanti-proxy] GET page ${pageCount + 1}: ${nextUrl}`);
      const response: Response = await fetch(nextUrl, { method: "GET", headers });

      if (!response.ok) {
        const errBody = await response.text();
        return NextResponse.json(
          { error: `Ivanti returned ${response.status}: ${errBody}` },
          { status: response.status }
        );
      }

      // 204 No Content = BO exists but has no records (or is write-only).
      // Treat as empty result set; the client will show the "0 records" error.
      if (response.status === 204) break;

      const rawText = await response.text();
      if (!rawText.trim()) break; // unexpected empty body — stop pagination, return what we have

      let json: { value?: unknown[]; "@odata.nextLink"?: string };
      try {
        json = JSON.parse(rawText) as { value?: unknown[]; "@odata.nextLink"?: string };
      } catch {
        const preview = rawText.slice(0, 200);
        return NextResponse.json(
          { error: `Ivanti returned a non-JSON response (HTTP ${response.status}). Body preview: ${preview}` },
          { status: 502 }
        );
      }
      const rows: Record<string, unknown>[] = Array.isArray(json.value)
        ? (json.value as Record<string, unknown>[])
        : [json as Record<string, unknown>];

      allRows.push(...rows);
      pageCount++;

      if (json["@odata.nextLink"]) {
        // Server gave us the next page URL — use it directly
        nextUrl = json["@odata.nextLink"];
      } else if (rows.length === PAGE_SIZE) {
        // No nextLink but got a full page — server likely doesn't support nextLink,
        // so manually advance $skip to fetch the next page.
        currentSkip += rows.length;
        const skipParams = new URLSearchParams();
        skipParams.set("$top", String(PAGE_SIZE));
        skipParams.set("$skip", String(currentSkip));
        nextUrl = `${baseUrl}?${skipParams.toString()}`;
      } else {
        // Got fewer rows than PAGE_SIZE — we've reached the last page
        nextUrl = null;
      }

      if (pageCount >= 500) break; // safety cap
    }

    console.log(`[ivanti-proxy] Fetched ${allRows.length} records (${pageCount} page(s))`);

    // If the BO has no records, fall back to OData $metadata to enumerate fields.
    // Return a synthetic row (all values null) so the client's key-union loop
    // can extract field names without requiring any actual records.
    if (allRows.length === 0) {
      const base = ivantiUrl.replace(/\/$/, "");
      const metaResult = await fetchMetadataFields(base, resolvedObject, headers);
      if ("fields" in metaResult && metaResult.fields.length > 0) {
        const synthetic: Record<string, null> = {};
        for (const f of metaResult.fields) synthetic[f] = null;
        console.log(`[ivanti-proxy] Returning ${metaResult.fields.length} fields from metadata`);
        return NextResponse.json({ rows: [synthetic], count: 0, fromMetadata: true });
      }
      const metaErr = "error" in metaResult ? metaResult.error : "Unknown metadata failure";
      return NextResponse.json(
        { error: `No records found and metadata fallback failed: ${metaErr}` },
        { status: 422 }
      );
    }

    return NextResponse.json({ rows: allRows, count: allRows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
