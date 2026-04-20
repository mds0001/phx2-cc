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
const DATE_FIELD_KEYWORDS = ["date", "expir", "yearend", "year_end", "fiscal", "warranty", "renewal", "purchased", "retired", "disposed", "received", "delivery", "expected", "expiry", "maint"];
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
    if (typeof value !== "string" || !value.trim()) {
      // Remove null/empty link fields entirely from the payload.
      // Sending null for a link field can cause Ivanti to set unexpected values
      // (e.g. a null ParentLink on Location gets interpreted as a self-parent link).
      delete result[key];
      continue;
    }

    // Use the explicit BO name supplied by the user in the mapping editor, or
    // fall back to auto-deriving it from the field name.
    const boName = linkFieldBoNames[key] ?? boNameFromLinkField(key);
    console.log(`[ivanti-proxy] resolveLink field="${key}" explicit boName="${linkFieldBoNames[key]}" derived="${boNameFromLinkField(key)}" using="${boName}"`);
    if (!boName) continue;

    // ── Module-level cache check ─────────────────────────────
    // Caches successful RecID resolutions only — failures are NOT cached so that
    // config changes (e.g. updating linkFieldLookupField) take effect immediately
    // without requiring a server restart.
    const lfCacheKey = `${boName}::${value}`;
    if (linkFieldCache.has(lfCacheKey)) {
      const cached = linkFieldCache.get(lfCacheKey)!;
      // RecID resolved from cache — keep the display value in the payload for now.
      // The caller will swap to _RecID if this is a PATCH (update); for POST (create)
      // we keep the display value so Ivanti resolves the link internally (sending
      // _RecID on POST causes an implicit varchar→varbinary SQL conversion error).
      log.push({ field: key, value, recId: cached });
      console.log(`[ivanti-proxy] ${key}="${value}" -> RecID="${cached}" (cache hit, display value kept for now)`);
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
          `CI%23${boName}`,
          `ci%23${boLower}`,
          `CI%23${boLower}`,
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
            const url = `${base}/api/odata/businessobject/${encodeBoForUrl(boVariant)}?$filter=${filter}&$top=1`;
            console.log(`[ivanti-proxy] Direct lookup ${key}: GET ${url}`);
            const res = await fetch(url, { method: "GET", headers });
            if (!res.ok) { lastError = `HTTP ${res.status} for ${boVariant}`; continue; }
            const json = (await res.json()) as { value?: Array<Record<string, string>> | string };
            // Some Ivanti endpoints return value as a JSON-encoded string rather than
            // a native array — parse it if needed.
            const rawVal = json.value;
            const valueArr: Array<Record<string, string>> = typeof rawVal === "string"
              ? JSON.parse(rawVal)
              : (Array.isArray(rawVal) ? rawVal : []);
            const row = valueArr[0];
            const foundId = row?.RecId ?? row?.RecID ?? row?._RecID ?? row?.recId ?? row?.recID;
            if (foundId) { recId = foundId; break directSearch; }
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
      // Cache the resolved RecID for future rows.
      linkFieldCache.set(lfCacheKey, recId);
      log.push({ field: key, value, recId });
      // Keep the display value in the payload for now — the caller will swap to
      // _RecID when doing a PATCH (update). For POST (create), Ivanti resolves the
      // display value internally; sending _RecID on POST causes an implicit
      // varchar→varbinary SQL conversion error.
      console.log(`[ivanti-proxy] ${key}="${value}" -> RecID="${recId}" (resolved, display value kept for now)`);
    } else {
      // Do not cache failures — allows config changes to take effect without restart.
      log.push({ field: key, value, error: lastError || "Unknown lookup failure" });
      console.warn(`[ivanti-proxy] Could not resolve ${key}="${value}": ${lastError}`);
    }
  }

  return { resolved: result, log };
}


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── Mode: clear-cache ─────────────────────────────────────────────────────
    // Clears the module-level link-field resolution cache and BO name cache.
    // Called by SchedulerClient at the start of each task run so that stale
    // "previously failed" cache entries from an earlier run don't block lookups
    // for freshly-created records (e.g. HQ location deleted then re-created).
    if ((body as { mode?: string }).mode === "clear-cache") {
      const before = linkFieldCache.size + boNameCache.size;
      linkFieldCache.clear();
      boNameCache.clear();
      console.log(`[ivanti-proxy] clear-cache: cleared ${before} entries`);
      return NextResponse.json({ cleared: before });
    }

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

    // ── Mode: many-to-many relationship linking ──────────────────────────────
    // Resolves both sides to RecIDs, then links them using Ivanti's proprietary
    // SaveDataExecuteAction ASMX endpoint — the same one the Ivanti UI uses.
    // OData navigation-property POSTs return 404 "No service for IEdmModel" on
    // this instance; SaveDataExecuteAction is the only working approach.
    if ((body as { manyToMany?: boolean }).manyToMany) {
      const {
        ivantiUrl: m2mUrl,
        apiKey: m2mApiKeyRaw,
        tenantId: m2mTenant,
        businessObject: m2mPrimaryBo,
        relationshipName: m2mRel,
        linkFieldBoNames: m2mLinkBoNames,
        linkFieldLookupFields: m2mLookupFields,
        data: m2mData,
      } = body as {
        ivantiUrl: string;
        apiKey?: string;
        tenantId?: string;
        businessObject?: string;
        relationshipName: string;
        linkFieldBoNames?: Record<string, string>;
        linkFieldLookupFields?: Record<string, string>;
        data: Record<string, unknown>;
      };

      if (!m2mUrl || !m2mRel || !m2mData) {
        return NextResponse.json({ error: "M2M mode requires ivantiUrl, relationshipName, and data" }, { status: 400 });
      }

      const m2mBase   = m2mUrl.replace(/\/$/, "");
      const m2mApiKey = m2mApiKeyRaw ?? FALLBACK_API_KEY;
      const m2mHeaders: Record<string, string> = {
        Authorization: `rest_api_key=${m2mApiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      if (m2mTenant) m2mHeaders["X-Tenant-Id"] = m2mTenant;

      // Convert OData @odata.type "#Namespace.SubType" → Ivanti "Namespace#SubType".
      // e.g. "#ivnt_ContractLineItem.ivnt_Entitlement" → "ivnt_ContractLineItem#ivnt_Entitlement"
      // e.g. "#CI.Computer"                             → "CI#Computer"
      const odataTypeToIvantiType = (t: string): string | null => {
        const s = t.replace(/^#/, "");
        const dot = s.lastIndexOf(".");
        return dot > 0 ? `${s.slice(0, dot)}#${s.slice(dot + 1)}` : null;
      };

      const m2mLog: ResolvedField[] = [];
      let primaryRecId:  string | null = null;
      let primaryField:  string | null = null;
      let primaryBoType: string        = m2mPrimaryBo ?? "CI#";
      const secondaryRecs: Array<{ field: string; recId: string; bo: string; boType: string }> = [];
      // Collect cookies from OData responses so we can forward them to the ASMX endpoint,
      // which requires session-based auth rather than the API-key header.
      const capturedCookies: string[] = [];

      // Helper: extract cookie name=value pairs from a Set-Cookie header string.
      const captureCookies = (setCookieHeader: string | null) => {
        if (!setCookieHeader) return;
        // Set-Cookie header may contain multiple cookies separated by commas,
        // but each cookie's name=value is the first segment before the first ';'.
        const pairs = setCookieHeader.split(/,(?=[^;]+=[^;]+;)/);
        for (const pair of pairs) {
          const nv = pair.split(";")[0].trim();
          if (nv && !capturedCookies.includes(nv)) capturedCookies.push(nv);
        }
      };

      // Resolve each field to its RecID.
      // Fields WITHOUT a linkFieldBoName entry → primary side (query the main businessObject).
      // Fields WITH a linkFieldBoName entry     → secondary side (query that BO).
      for (const [fieldName, fieldValue] of Object.entries(m2mData)) {
        if (typeof fieldValue !== "string" || !fieldValue.trim()) continue;

        const linkBo      = (m2mLinkBoNames ?? {})[fieldName];
        const lookupField = (m2mLookupFields ?? {})[fieldName] ?? fieldName;
        const targetBo    = linkBo ?? m2mPrimaryBo ?? "CI#";
        const escapedVal  = odataEscape(fieldValue);

        const boBase         = encodeBoForUrl(targetBo);
        const boLower        = boBase.toLowerCase();
        // Strip subtype suffix (e.g. "ivnt_ContractLineItem%23ivnt_Purchase" → "ivnt_ContractLineItem%23").
        const boBaseStripped = boBase.includes("%23") && !boBase.endsWith("%23")
          ? boBase.slice(0, boBase.lastIndexOf("%23") + 3)
          : null;
        const boVariants = [
          boBase,
          boLower,
          ...(boBase.endsWith("s") ? [] : [boBase + "s", boLower + "s"]),
          ...(boBaseStripped ? [boBaseStripped, boBaseStripped.toLowerCase()] : []),
        ];

        let recId: string | null = null;
        let resolvedVariant      = boBase;
        let lastErr              = "";

        for (const boVariant of boVariants) {
          const lookupUrl = `${m2mBase}/api/odata/businessobject/${boVariant}?$filter=${encodeURIComponent(`${lookupField} eq '${escapedVal}'`)}&$select=RecId&$top=1`;
          console.log(`[ivanti-proxy] M2M resolve ${fieldName} in ${boVariant}: GET ${lookupUrl}`);
          try {
            const res = await fetch(lookupUrl, { headers: m2mHeaders });
            captureCookies(res.headers.get("set-cookie"));
            if (res.ok) {
              const json = (await res.json()) as { value?: Array<{ RecId?: string }> };
              recId = json.value?.[0]?.RecId ?? null;
              if (recId) { resolvedVariant = boVariant; break; }
              lastErr = `No record in ${boVariant} where ${lookupField}='${fieldValue}'`;
            } else {
              lastErr = `HTTP ${res.status} for ${boVariant}`;
            }
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e);
          }
        }

        if (recId) {
          // Fetch the resolved record to get its @odata.type which includes the subtype
          // (e.g. "#CI.Computer" or "#ivnt_ContractLineItem.ivnt_Entitlement").
          // Both SaveDataExecuteAction and OData nav-property calls need the full subtype.
          let fullBoType = targetBo; // fallback: use the base BO name as-is
          try {
            const typeUrl = `${m2mBase}/api/odata/businessobject/${resolvedVariant}('${recId}')?$select=RecId`;
            const typeRes = await fetch(typeUrl, { headers: m2mHeaders });
            captureCookies(typeRes.headers.get("set-cookie"));
            if (typeRes.ok) {
              const typeJson = (await typeRes.json()) as { "@odata.type"?: string; [k: string]: unknown };
              const converted = typeJson["@odata.type"] ? odataTypeToIvantiType(typeJson["@odata.type"]) : null;
              if (converted) {
                fullBoType = converted;
                console.log(`[ivanti-proxy] M2M type for ${fieldName}: ${typeJson["@odata.type"]} → ${fullBoType}`);
              }
            }
          } catch {
            // Non-fatal — proceed with base type
          }

          m2mLog.push({ field: fieldName, value: fieldValue, recId });
          if (!linkBo) {
            primaryRecId  = recId;
            primaryField  = fieldName;
            primaryBoType = fullBoType;
          } else {
            secondaryRecs.push({ field: fieldName, recId, bo: targetBo, boType: fullBoType });
          }
        } else {
          m2mLog.push({
            field: fieldName,
            value: fieldValue,
            error: lastErr || `Could not resolve ${fieldName} in ${targetBo}`,
          });
        }
      }

      if (!primaryRecId) {
        return NextResponse.json({
          status: 400,
          statusText: "M2M primary record not found",
          linkResolution: m2mLog,
          error: `Could not resolve primary record (${primaryField ?? "unknown field"}) in ${m2mPrimaryBo}`,
        }, { status: 400 });
      }
      if (secondaryRecs.length === 0) {
        return NextResponse.json({
          status: 400,
          statusText: "M2M secondary record not found",
          linkResolution: m2mLog,
          error: "Could not resolve any secondary (linked) record",
        }, { status: 400 });
      }

      const secondary = secondaryRecs[0];

      // ── SaveDataExecuteAction ──────────────────────────────────────────────
      // This is the endpoint the Ivanti UI calls when a user links two records.
      // Body format reverse-engineered from browser network capture.
      const saveUrl  = `${m2mBase}/Services/Save.asmx/SaveDataExecuteAction`;
      const saveBody = {
        shouldSave: true,
        data: {
          [secondary.recId]: {
            op:                   "link",
            objectId:             secondary.recId,
            objectType:           secondary.boType,
            values:               {},
            valuesOrder:          {},
            forceAutoFill:        {},
            originalValues:       {},
            pureOriginalValues:   {},
            attachementCacheIds:  {},
            uploadedImageIds:     {},
            textFields:           [],
            masterObjectType:     primaryBoType,
            masterObjectId:       primaryRecId,
            relationshipTag:      m2mRel,
            saveItemRel2Name:     null,
            saveItemLinkDataRecID: null,
          },
        },
        actionParams: {
          FormParams: {
            objectId:   primaryRecId,
            formNames:  [],
            clientData: {
              Objects:             {},
              ObjectRelationships: {},
            },
          },
        },
        promptParams: null,
      };

      // Forward any session cookies captured from OData resolution calls.
      // The ASMX SaveDataExecuteAction endpoint requires session auth, not just API key.
      const saveHeaders = { ...m2mHeaders };
      if (capturedCookies.length > 0) {
        saveHeaders["Cookie"] = capturedCookies.join("; ");
        console.log(`[ivanti-proxy] M2M forwarding ${capturedCookies.length} cookie(s) to ASMX: ${capturedCookies.join("; ")}`);
      }

      console.log(`[ivanti-proxy] M2M SaveDataExecuteAction: POST ${saveUrl}`);
      console.log(`[ivanti-proxy] M2M link: masterType=${primaryBoType} masterId=${primaryRecId} childType=${secondary.boType} childId=${secondary.recId} rel=${m2mRel}`);

      let relRes: Response | null = null;
      let relRespBody: unknown    = null;
      let usedStrategy            = "SaveDataExecuteAction";

      try {
        const r = await fetch(saveUrl, {
          method: "POST",
          headers: saveHeaders,
          body: JSON.stringify(saveBody),
        });
        const ct = r.headers.get("content-type") ?? "";
        const rb = r.status === 204
          ? null
          : ct.includes("application/json") ? await r.json() : await r.text();
        console.log(`[ivanti-proxy] M2M SaveDataExecuteAction ${r.status}:`, JSON.stringify(rb));
        if (r.ok || r.status === 204) { relRes = r; relRespBody = rb; }
        else { relRes = r; relRespBody = rb; } // keep going to OData fallbacks only on auth errors
      } catch (e) {
        console.warn(`[ivanti-proxy] M2M SaveDataExecuteAction error:`, e);
      }

      // If SaveDataExecuteAction failed (likely auth/session issue), fall back to OData.
      // Per Ivanti docs the correct format for M2M linking is:
      //   PATCH /{parentBO}('{parentRecId}')/{RelName}('{childRecId}')/$Ref   (empty body)
      // The child RecID goes IN THE URL, not in the request body.  Method is PATCH not POST.
      const saveOk = relRes && (relRes.ok || relRes.status === 204);
      if (!saveOk) {
        const fullPrimaryBoEnc   = encodeBoForUrl(primaryBoType);
        const fullSecondaryBoEnc = encodeBoForUrl(secondary.boType);
        // Base (no subtype) BO names for the "CI#" / "ivnt_ContractLineItem#" case
        const basePrimaryBoEnc   = encodeBoForUrl(m2mPrimaryBo ?? "CI#");
        const baseSecondaryBoEnc = encodeBoForUrl(secondary.bo);
        const emptyBody          = {};

        // Build PATCH $Ref attempts.  Try both full-subtype and base BO names, and
        // both the plural ("s" suffix) and non-plural variants that Ivanti may require.
        type ODataAttempt = { url: string; body: Record<string, unknown>; label: string; method: string };
        const odataAttempts: ODataAttempt[] = [];
        for (const [primaryEnc, secondaryEnc, tag] of [
          [fullPrimaryBoEnc,   fullSecondaryBoEnc, "full"],
          [basePrimaryBoEnc,   baseSecondaryBoEnc, "base"],
          [fullPrimaryBoEnc + "s", fullSecondaryBoEnc + "s", "full-plural"],
          [basePrimaryBoEnc  + "s", baseSecondaryBoEnc + "s", "base-plural"],
        ] as [string, string, string][]) {
          // PATCH from primary → secondary (docs example direction)
          odataAttempts.push({
            url:    `${m2mBase}/api/odata/businessobject/${primaryEnc}('${primaryRecId}')/${m2mRel}('${secondary.recId}')/$Ref`,
            body:   emptyBody,
            label:  `patch-primary-${tag}`,
            method: "PATCH",
          });
          // PATCH from secondary → primary (reverse direction)
          odataAttempts.push({
            url:    `${m2mBase}/api/odata/businessobject/${secondaryEnc}('${secondary.recId}')/${m2mRel}('${primaryRecId}')/$Ref`,
            body:   emptyBody,
            label:  `patch-secondary-${tag}`,
            method: "PATCH",
          });
        }

        for (const attempt of odataAttempts) {
          console.log(`[ivanti-proxy] M2M OData fallback (${attempt.label}): ${attempt.method} ${attempt.url}`);
          try {
            const r = await fetch(attempt.url, { method: attempt.method, headers: m2mHeaders, body: JSON.stringify(attempt.body) });
            const ct = r.headers.get("content-type") ?? "";
            const rb = r.status === 204 ? null : (ct.includes("application/json") ? await r.json() : await r.text());
            console.log(`[ivanti-proxy] M2M OData fallback (${attempt.label}) ${r.status}:`, JSON.stringify(rb));
            if (r.ok || r.status === 204) { relRes = r; relRespBody = rb; usedStrategy = attempt.label; break; }
            if (r.status !== 404 && r.status !== 405) { relRes = r; relRespBody = rb; usedStrategy = attempt.label; break; }
          } catch (e) {
            console.warn(`[ivanti-proxy] M2M OData fallback (${attempt.label}) error:`, e);
          }
        }
      }

      if (!relRes) {
        return NextResponse.json({
          status: 500,
          error: "All M2M link attempts failed (SaveDataExecuteAction + OData fallbacks)",
          linkResolution: m2mLog,
        }, { status: 500 });
      }

      return NextResponse.json(
        {
          status:     relRes.ok || relRes.status === 204 ? 200 : relRes.status,
          statusText: relRes.ok || relRes.status === 204
            ? `OK (linked via ${usedStrategy})`
            : relRes.statusText,
          body:           relRespBody,
          linkResolution: m2mLog,
          m2m: {
            primaryRecId,
            primaryField,
            primaryBoType,
            secondaryRecId:  secondary.recId,
            secondaryField:  secondary.field,
            secondaryBoType: secondary.boType,
            usedStrategy,
          },
        },
        { status: relRes.ok || relRes.status === 204 ? 200 : relRes.status }
      );
    }

    const { ivantiUrl, data, apiKey, businessObject, tenantId, linkFieldNames, linkFieldBoNames, linkFieldLookupFields, upsertKey, upsertKeys, skipIfExists, skipIfNotExists, method, directRecId, directBoName, binaryFields } = body as {
      ivantiUrl: string;
      data: Record<string, unknown>;
      apiKey?: string;
      businessObject?: string;
      /** When "DELETE": look up record by key fields and DELETE it instead of POST/PATCH. */
      method?: "DELETE";
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
      /** When true: if no record with the same key exists, return a skipped response
       *  instead of POSTing a new one (update_only mode). */
      skipIfNotExists?: boolean;
      /** Direct DELETE by known RecID — skips BO name probe and upsert lookup entirely.
       *  Must be paired with directBoName (the already-resolved, URL-encoded BO name). */
      directRecId?: string;
      directBoName?: string;
      /** Binary fields to upload separately via PUT after the main record write.
       *  Ivanti REST API rejects base64 strings for varbinary columns in JSON payloads.
       *  Each entry: fieldName → { base64: string, mimeType: string } */
      binaryFields?: Record<string, { base64: string; mimeType: string }>;
    };

    // ── Direct DELETE by known RecID (fast path used by resetTask) ───────────
    // Bypasses BO name probe and upsert lookup — just DELETE the record directly.
    if (method === "DELETE" && directRecId && directBoName) {
      const base = ivantiUrl.replace(/\/$/, "");
      const resolvedKey = apiKey ?? FALLBACK_API_KEY;
      const hdrs: Record<string, string> = {
        Authorization: `rest_api_key=${resolvedKey}`,
        Accept: "application/json",
      };
      if (tenantId) hdrs["X-Tenant-Id"] = tenantId;
      const delUrl = `${base}/api/odata/businessobject/${directBoName}('${directRecId}')`;
      console.log("[ivanti-proxy] Direct DELETE by RecID:", delUrl);
      const delRes = await fetch(delUrl, { method: "DELETE", headers: hdrs });
      if (delRes.ok || delRes.status === 204) {
        return NextResponse.json({ status: 204, deleted: true, existingRecId: directRecId });
      }
      if (delRes.status === 404) {
        return NextResponse.json({ status: 404, deleted: false, skipped: true, reason: "Not found (already deleted?)" });
      }
      const errText = await delRes.text().catch(() => "");
      return NextResponse.json({ status: delRes.status, deleted: false, error: errText }, { status: delRes.status });
    }

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

    // For DELETE mode we only need key fields to locate the record — skip expensive
    // link-field resolution (which fires 50+ HTTP probes per link field).
    const { resolved: resolvedData, log: resolveLog } = method === "DELETE"
      ? { resolved: dateConvertedData, log: [] }
      : await resolveLinkFields(
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
    // Link fields (isLinkField) are resolved to RecIDs before the record is written, but
    // Ivanti OData does NOT support filtering by link-field RecID values — those filters
    // always return 0 results, causing the existence check to silently fail and the proxy
    // to create a duplicate on every run.  Skip link fields here; non-link keys (e.g. Name)
    // are sufficient to identify an existing record.
    const linkFieldSet = new Set(linkFieldNames ?? []);
    const filterParts = keyFields
      .map((f) => {
        if (linkFieldSet.has(f)) return null; // skip link fields — RecID filter not supported by OData
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

    // ── Skip if not exists (update_only mode) ────────────────────────────────
    if (skipIfNotExists && !existingRecId) {
      const keyDesc = keyFields.map((f) => `${f}="${resolvedData[f] ?? ""}"`).join(", ");
      console.log(`[ivanti-proxy] Skipping non-existent record in update_only mode (${keyDesc})`);
      return NextResponse.json({
        status:  200,
        skipped: true,
        reason:  `Record does not exist — skipping in update_only mode (${keyDesc})`,
        upsert:  { method: "SKIP", existingRecId: null },
      });
    }

    // ── DELETE mode ──────────────────────────────────────────────────────────
    if (method === "DELETE") {
      if (!existingRecId) {
        const keyDesc = keyFields.map((f) => `${f}="${resolvedData[f] ?? ""}"`).join(", ");
        console.log(`[ivanti-proxy] DELETE: record not found (${keyDesc}) — skipping`);
        return NextResponse.json({
          status: 200,
          skipped: true,
          reason: `Record not found — nothing to delete (${keyDesc})`,
          upsert: { method: "SKIP", existingRecId: null },
        });
      }
      const deleteUrl = `${endpoint}('${existingRecId}')`;
      console.log("[ivanti-proxy] DELETE:", deleteUrl);
      const delRes = await fetch(deleteUrl, { method: "DELETE", headers });
      const keyDesc = keyFields.map((f) => `${f}="${resolvedData[f] ?? ""}"`).join(", ");
      if (delRes.ok || delRes.status === 204) {
        return NextResponse.json({ status: 204, deleted: true, existingRecId, keyDesc });
      }
      const errText = await delRes.text().catch(() => "");
      return NextResponse.json({ status: delRes.status, deleted: false, existingRecId, keyDesc, error: errText }, { status: delRes.status });
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

    // For PATCH (update): swap resolved link-field display values to _RecID form.
    // Ivanti silently ignores display values on PATCH but throws a varchar→varbinary
    // conversion error if _RecID is sent on POST (create), so we only do this swap here.
    let sendPayload = resolvedData;
    if (existingRecId) {
      const patchPayload = { ...resolvedData };
      for (const entry of resolveLog) {
        if ("recId" in entry && patchPayload[entry.field] === entry.value) {
          delete patchPayload[entry.field];
          patchPayload[`${entry.field}_RecID`] = entry.recId;
          console.log(`[ivanti-proxy] PATCH swap: ${entry.field}="${entry.value}" -> ${entry.field}_RecID="${entry.recId}"`);
        }
      }
      sendPayload = patchPayload;
    }

    let { res: response, body: responseBody } = await sendRequest(sendPayload);

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
          strippedFieldValues[f] = (sendPayload as Record<string, unknown>)[f];
        }
        const stripped = { ...sendPayload };
        for (const f of invalidFields) delete stripped[f];
        const retry = await sendRequest(stripped);
        response      = retry.res;
        responseBody  = retry.body;
        // Attach to outer scope so the final return can include them.
        (response as Response & { _strippedFields?: string[]; _strippedValues?: Record<string, unknown> })._strippedFields = strippedFieldsList;
        (response as Response & { _strippedFields?: string[]; _strippedValues?: Record<string, unknown> })._strippedValues = strippedFieldValues;
      }
    }

    // Auto-retry for POST link-resolution failures:
    // Ivanti resolves display values for link fields internally on POST for some BOs,
    // but fails for others (e.g. FRS_PriceItem# Manufacturer). When this happens:
    //  1. Strip the unresolvable link fields from the payload and retry the POST.
    //  2. On success, immediately PATCH the new record with _RecID for each resolved link.
    // This avoids both the display-value resolution failure AND the varchar→varbinary
    // conversion error that occurs when _RecID is sent on INSERT.
    if (!existingRecId && response.status === 400) {
      const postErrMsgs: string[] = (responseBody as { body?: { message?: string[] }; message?: string[] })?.body?.message
        ?? (responseBody as { message?: string[] })?.message ?? [];
      const hasLinkNotFound = postErrMsgs.some((m) => /cannot be found/.test(m));

      if (hasLinkNotFound) {
        const resolvedLinks = resolveLog.filter(
          (e): e is { field: string; value: string; recId: string } => "recId" in e
        );

        if (resolvedLinks.length > 0) {
          const strippedLinkPayload = { ...sendPayload };
          for (const entry of resolvedLinks) delete strippedLinkPayload[entry.field];

          console.log(`[ivanti-proxy] POST link-not-found; retrying without: ${resolvedLinks.map((e) => e.field).join(", ")}`);
          const { res: linkRetryRes, body: linkRetryBody } = await sendRequest(strippedLinkPayload);

          if (linkRetryRes.ok || linkRetryRes.status === 204 || linkRetryRes.status === 201) {
            const newRecId = (linkRetryBody as Record<string, unknown> | null)?.RecId as string | undefined;
            if (newRecId) {
              // PATCH the new record with _RecID fields for every resolved link
              const linkPatchPayload: Record<string, unknown> = {};
              for (const entry of resolvedLinks) {
                linkPatchPayload[`${entry.field}_RecID`] = entry.recId;
              }
              const linkPatchUrl = `${endpoint}('${newRecId}')`;
              console.log(`[ivanti-proxy] Post-create PATCH for link _RecIDs:`, linkPatchUrl, JSON.stringify(linkPatchPayload));
              try {
                const lpRes = await fetch(linkPatchUrl, { method: "PATCH", headers, body: JSON.stringify(linkPatchPayload) });
                if (!lpRes.ok && lpRes.status !== 204) {
                  const lpErr = await lpRes.text().catch(() => "");
                  console.warn(`[ivanti-proxy] Post-create link PATCH failed ${lpRes.status}: ${lpErr}`);
                } else {
                  console.log(`[ivanti-proxy] Post-create link PATCH succeeded for RecId=${newRecId}`);
                }
              } catch (lpe) {
                console.warn(`[ivanti-proxy] Post-create link PATCH error:`, lpe);
              }
            }
            response     = linkRetryRes;
            responseBody = linkRetryBody;
          }
        }
      }
    }

    // Extract any retry-stripping metadata attached above.
    const _resp = response as Response & { _strippedFields?: string[]; _strippedValues?: Record<string, unknown> };
    const strippedFields = _resp._strippedFields;
    const strippedValues = _resp._strippedValues;

    const upsertMethod = existingRecId ? "PATCH" : "POST";
    console.log(`[ivanti-proxy] ${upsertMethod} response status:`, response.status);
    console.log("[ivanti-proxy] Response body:", JSON.stringify(responseBody));

    // ── Binary field upload (e.g. ivnt_CatalogImage) ─────────────────────────
    // Ivanti's OData layer cannot accept base64 strings for varbinary fields.
    // Correct approach (reverse-engineered from Ivanti admin UI network traffic):
    //  Step 1: POST multipart to /handlers/SessionStorage/UploadImageHandler.ashx
    //          → response: { success: true, id: "GUID", ... }
    //  Step 2: POST to /Services/Save.asmx/SaveDataExecuteAction with temp GUID
    //          in both values.{fieldName} and uploadedImageIds.{fieldName}.
    const binaryUploadResults: Record<string, string> = {};
    if (binaryFields && Object.keys(binaryFields).length > 0 && (response.ok || response.status === 204)) {
      const finalRecId = existingRecId ?? (responseBody as Record<string, unknown> | null)?.RecId as string | undefined;
      if (finalRecId) {
        // ── Establish session + capture CSRF token ────────────────────────────
        // UploadImageHandler.ashx requires an ASP.NET session with a valid CSRF token.
        // OData (api_key only) doesn't create a browser session, so we must fetch
        // the HEAT main page first — that sets ASP.NET_SessionId and the CSRF cookie.
        const capturedBinaryCookies: string[] = [];
        const captureBinaryCookies = (setCookieHeader: string | null) => {
          if (!setCookieHeader) return;
          const pairs = setCookieHeader.split(/,(?=[^;]+=[^;]+;)/);
          for (const pair of pairs) {
            const nv = pair.split(";")[0].trim();
            if (nv && !capturedBinaryCookies.includes(nv)) capturedBinaryCookies.push(nv);
          }
        };

        // Try fetching the HEAT UI page to establish a session + get CSRF token.
        // Then also probe the OData endpoint to pick up any API-key session cookies.
        let csrfToken = "";
        const sessionProbeUrls = [
          `${base}/HEAT`,
          `${base}/`,
          `${base}/HEAT/`,
        ];
        for (const probeUrl of sessionProbeUrls) {
          try {
            const probeRes = await fetch(probeUrl, {
              method: "GET",
              headers: {
                Accept: "text/html,application/xhtml+xml,*/*",
                Authorization: `rest_api_key=${resolvedKey}`,
                ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
              },
              redirect: "follow",
            });
            captureBinaryCookies(probeRes.headers.get("set-cookie"));
            const html = await probeRes.text().catch(() => "");
            // Extract CSRF token from common Ivanti/ASP.NET meta/input patterns
            const tokenMatch =
              html.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/) ??
              html.match(/name="_csrfToken"[^>]+value="([^"]+)"/) ??
              html.match(/"csrfToken"\s*:\s*"([^"]+)"/) ??
              html.match(/"_csrfToken"\s*:\s*"([^"]+)"/);
            if (tokenMatch?.[1]) {
              csrfToken = tokenMatch[1];
              console.log(`[ivanti-proxy] CSRF from page ${probeUrl}: ${csrfToken.slice(0, 8)}...`);
              break;
            }
            if (capturedBinaryCookies.length > 0) {
              console.log(`[ivanti-proxy] Session probe ${probeUrl}: ${capturedBinaryCookies.length} cookie(s), no inline CSRF`);
              break;
            }
          } catch (e) {
            console.warn(`[ivanti-proxy] Session probe ${probeUrl} error:`, e);
          }
        }

        // Also probe OData to merge in any API-key session cookies
        try {
          const odataProbeRes = await fetch(`${endpoint}?$top=0`, {
            method: "GET",
            headers: {
              Authorization: `rest_api_key=${resolvedKey}`,
              Accept: "application/json",
              ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
            },
          });
          captureBinaryCookies(odataProbeRes.headers.get("set-cookie"));
        } catch { /* non-fatal */ }

        // Try to find CSRF token in cookies if page parsing didn't yield one
        if (!csrfToken) {
          const csrfEntry = capturedBinaryCookies.find(
            (c) => /^(__RequestVerificationToken|csrf|_csrf|csrfToken|CSRF|XSRF|xsrf)/i.test(c)
          );
          csrfToken = csrfEntry ? (csrfEntry.split("=")[1] ?? "") : "";
        }
        console.log(`[ivanti-proxy] CSRF token: ${csrfToken ? csrfToken.slice(0, 8) + "..." : "(none found)"}`);
        console.log(`[ivanti-proxy] Session cookies (${capturedBinaryCookies.length}): ${capturedBinaryCookies.map(c => c.split("=")[0]).join(", ")}`);

        const cookieHeader = capturedBinaryCookies.join("; ");

        // SaveDataExecuteAction objectType uses Ivanti's '#' namespace separator.
        // Config stores it as '__' (e.g. CI__Computers → CI#Computers) or already with '#'.
        const saveObjectType = effectiveObject.includes("#")
          ? effectiveObject
          : effectiveObject.replace(/__/g, "#");

        for (const [fieldName, { base64, mimeType }] of Object.entries(binaryFields)) {
          const bytes = Buffer.from(base64, "base64");
          const sizeKB = Math.round(bytes.byteLength / 1024);
          const ext = mimeType.split("/")[1]?.split("+")[0] ?? "png";
          const fileName = `image.${ext}`;
          let uploaded = false;
          let lastErr = "";

          // ── Step 1: POST to UploadImageHandler.ashx ─────────────────────────
          let tempImageId: string | null = null;
          try {
            const uploadUrl = `${base}/handlers/SessionStorage/UploadImageHandler.ashx`;
            const uploadIdentifier = Date.now().toString(16).toUpperCase().padStart(8, "0");
            const form = new FormData();
            form.append("APC_UPLOAD_PROGRESS", uploadIdentifier);
            form.append("UPLOAD_IDENTIFIER", uploadIdentifier);
            form.append("MAX_FILE_SIZE", "104857600");
            form.append("_csrfToken", csrfToken);
            form.append("path", "");
            form.append("files", "");
            form.append("multiplefiles", "false");
            form.append("cmd", "upload");
            form.append("dir", ".");
            form.append("file", new Blob([bytes], { type: mimeType }), fileName);

            const uploadHeaders: Record<string, string> = {
              Authorization: `rest_api_key=${resolvedKey}`,
              Accept: "application/json, text/plain, */*",
              ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
              ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            };

            console.log(`[ivanti-proxy] Binary step1 upload: POST ${uploadUrl} (${mimeType}, ${sizeKB}KB)`);
            const uploadRes = await fetch(uploadUrl, { method: "POST", headers: uploadHeaders, body: form });
            const uploadText = await uploadRes.text().catch(() => "");
            console.log(`[ivanti-proxy] Binary step1 ${fieldName}: HTTP ${uploadRes.status} ${uploadText.slice(0, 300)}`);

            if (uploadRes.ok) {
              try {
                const uploadJson = JSON.parse(uploadText) as { success?: boolean; id?: string };
                if (uploadJson.success && uploadJson.id) {
                  tempImageId = uploadJson.id;
                  console.log(`[ivanti-proxy] Binary step1 got tempId: ${tempImageId}`);
                } else {
                  lastErr = `Upload handler returned no id: ${uploadText.slice(0, 200)}`;
                }
              } catch {
                lastErr = `Could not parse upload response: ${uploadText.slice(0, 200)}`;
              }
            } else {
              lastErr = `Upload handler HTTP ${uploadRes.status}: ${uploadText.slice(0, 200)}`;
            }
          } catch (e) {
            lastErr = `Step1 error: ${e instanceof Error ? e.message : String(e)}`;
            console.warn(`[ivanti-proxy] Binary step1 error:`, lastErr);
          }

          // ── Step 2: SaveDataExecuteAction with temp GUID ─────────────────────
          if (tempImageId) {
            try {
              const saveUrl = `${base}/Services/Save.asmx/SaveDataExecuteAction`;
              const saveBody = {
                shouldSave: true,
                data: {
                  [finalRecId]: {
                    op:                  "update",
                    objectId:            finalRecId,
                    objectType:          saveObjectType,
                    values:              { [fieldName]: tempImageId },
                    valuesOrder:         { [fieldName]: 0 },
                    forceAutoFill:       {},
                    originalValues:      { [fieldName]: "" },
                    pureOriginalValues:  {},
                    attachementCacheIds: {},
                    uploadedImageIds:    { [fieldName]: tempImageId },
                    textFields:          [],
                  },
                },
                actionParams: {
                  FormParams: {
                    objectId:   finalRecId,
                    formNames:  [],
                    clientData: { Objects: {}, ObjectRelationships: {} },
                  },
                },
                promptParams: null,
              };

              const saveHeaders: Record<string, string> = {
                Authorization: `rest_api_key=${resolvedKey}`,
                "Content-Type": "application/json",
                Accept: "application/json, text/plain, */*",
                ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
                ...(cookieHeader ? { Cookie: cookieHeader } : {}),
              };

              console.log(`[ivanti-proxy] Binary step2 SaveDataExecuteAction: POST ${saveUrl}`);
              console.log(`[ivanti-proxy] Binary step2 objectType=${saveObjectType} recId=${finalRecId} field=${fieldName} tempId=${tempImageId}`);
              const saveRes = await fetch(saveUrl, { method: "POST", headers: saveHeaders, body: JSON.stringify(saveBody) });
              const saveText = saveRes.status === 204 ? "" : await saveRes.text().catch(() => "");
              console.log(`[ivanti-proxy] Binary step2 ${fieldName}: HTTP ${saveRes.status} ${saveText.slice(0, 300)}`);

              if (saveRes.ok || saveRes.status === 204) {
                binaryUploadResults[fieldName] = "ok";
                uploaded = true;
              } else {
                lastErr = `Step2 SaveDataExecuteAction HTTP ${saveRes.status}: ${saveText.slice(0, 200)}`;
              }
            } catch (e) {
              lastErr = `Step2 error: ${e instanceof Error ? e.message : String(e)}`;
              console.warn(`[ivanti-proxy] Binary step2 error:`, lastErr);
            }
          }

          if (!uploaded) {
            binaryUploadResults[fieldName] = lastErr || "upload failed";
            console.warn(`[ivanti-proxy] Binary upload failed for ${fieldName}: ${lastErr}`);
          }
        }
      } else {
        console.warn("[ivanti-proxy] Binary fields present but no RecId available for upload");
        for (const fieldName of Object.keys(binaryFields)) {
          binaryUploadResults[fieldName] = "skipped: no RecId";
        }
      }
    }

    return NextResponse.json(
      {
        status: response.status === 204 ? 200 : response.status,
        statusText: response.status === 204 ? "OK (updated)" : response.statusText,
        body: responseBody,
        linkResolution: resolveLog,
        resolvedBoName,
        upsert: { method: upsertMethod, existingRecId },
        ...(strippedFields?.length ? { strippedFields, strippedValues } : {}),
        ...(Object.keys(binaryUploadResults).length > 0 ? { binaryUploadResults } : {}),
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
