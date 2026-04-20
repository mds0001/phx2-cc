// TEMPORARY one-shot cleanup route — delete after use
// Hit GET /api/delete-storage-transactions in your browser to run it

import { NextResponse } from "next/server";

const IVANTI = "https://cleardata-stg.saasit.com";
const KEY    = "251E668B0B42478EB3DA9D6E8446CA0B";

const headers = {
  "Authorization": `rest_api_key=${KEY}`,
  "Accept": "application/json",
  "Content-Type": "application/json",
};

const BO = "ivnt_StorageSpaceTransactions";

export async function GET() {
  const log: string[] = [];
  let deleted = 0, notFound = 0, errors = 0;
  let pageOffset = 0;
  const pageSize = 100;

  log.push(`Emptying ${BO}...`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const listUrl = `${IVANTI}/api/odata/businessobject/${BO}?$select=RecId,DisplayName&$top=${pageSize}&$skip=${pageOffset}`;

    let records: { RecId: string; DisplayName?: string }[] = [];
    try {
      const listRes = await fetch(listUrl, { headers });
      if (!listRes.ok) {
        const body = await listRes.text().catch(() => "");
        log.push(`LIST error ${listRes.status}: ${body.slice(0, 300)}`);
        errors++;
        break;
      }
      const data = await listRes.json();
      records = data?.value ?? [];
      log.push(`Page offset=${pageOffset}: found ${records.length} record(s)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.push(`LIST network error: ${msg}`);
      errors++;
      break;
    }

    if (records.length === 0) break;

    for (const rec of records) {
      const recId = rec.RecId;
      const name  = rec.DisplayName ?? recId;
      const delUrl = `${IVANTI}/api/odata/businessobject/${BO}('${recId}')`;
      try {
        const delRes = await fetch(delUrl, { method: "DELETE", headers });
        if (delRes.ok || delRes.status === 204) {
          log.push(`  ✓ Deleted "${name}" (${recId})`);
          deleted++;
        } else if (delRes.status === 404) {
          log.push(`  – Not found "${name}" (${recId})`);
          notFound++;
        } else {
          const body = await delRes.text().catch(() => "");
          log.push(`  ✗ Error ${delRes.status} "${name}": ${body.slice(0, 200)}`);
          errors++;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.push(`  ✗ Network error "${name}": ${msg}`);
        errors++;
      }
    }

    // If we got fewer than a full page, we're done
    if (records.length < pageSize) break;
    pageOffset += pageSize;
  }

  return NextResponse.json({
    summary: `Deleted: ${deleted} | Not found: ${notFound} | Errors: ${errors}`,
    log,
  });
}
