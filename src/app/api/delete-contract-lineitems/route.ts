// TEMPORARY one-shot cleanup route — delete after use
// Hit GET /api/delete-contract-lineitems in your browser to run it

import { NextResponse } from "next/server";

const IVANTI = "https://cleardata-stg.saasit.com";
const KEY    = "251E668B0B42478EB3DA9D6E8446CA0B";

const SUBTYPES = [
  "ivnt_Entitlement",
  "ivnt_ExtendedWarranty",
  "ivnt_Lease",
  "ivnt_Maintenance",
  "ivnt_NDA",
  "ivnt_Purchase",
  "ivnt_Service",
  "ivnt_Support",
  "ivnt_VolumePurchase",
];

const headers = {
  "Authorization": `rest_api_key=${KEY}`,
  "Accept": "application/json",
  "Content-Type": "application/json",
};

export async function GET() {
  const log: string[] = [];
  let deleted = 0, notFound = 0, errors = 0;

  for (const subtype of SUBTYPES) {
    const bo = `ivnt_ContractLineItem%23${subtype}`;
    const listUrl = `${IVANTI}/api/odata/businessobject/${bo}?$select=RecId,DisplayName&$top=50`;

    log.push(`\n--- ${subtype} ---`);

    let records: { RecId: string; DisplayName: string }[] = [];
    try {
      const listRes = await fetch(listUrl, { headers });
      if (!listRes.ok) {
        const body = await listRes.text().catch(() => "");
        log.push(`  LIST error ${listRes.status}: ${body.slice(0, 300)}`);
        errors++;
        continue;
      }
      const data = await listRes.json();
      records = data?.value ?? [];
      log.push(`  Found ${records.length} record(s)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.push(`  LIST network error: ${msg}`);
      errors++;
      continue;
    }

    for (const rec of records) {
      const recId = rec.RecId;
      const name  = rec.DisplayName ?? recId;
      const delUrl = `${IVANTI}/api/odata/businessobject/${bo}('${recId}')`;
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
  }

  return NextResponse.json({
    summary: `Deleted: ${deleted} | Not found: ${notFound} | Errors: ${errors}`,
    log,
  });
}
