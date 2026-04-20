// One-shot script to DELETE contract line items from Ivanti using known RecIDs.
// Run from the phx2 directory: node scripts/delete-contract-lineitems.mjs

const IVANTI = "https://cleardata-stg.saasit.com";
const KEY    = "251E668B0B42478EB3DA9D6E8446CA0B";

const RECORDS = [
  { bo: "ivnt_ContractLineItem#ivnt_Entitlement",      recId: "215FAAEF4B3C48C9B84DB3DC8A6B1F4A", name: "Mike Software Entitlement" },
  { bo: "ivnt_ContractLineItem#ivnt_ExtendedWarranty", recId: "D2599A8F96CD446FA0BF8FDF2BAB47D1", name: "Example Extended Warranty 01" },
  { bo: "ivnt_ContractLineItem#ivnt_Lease",            recId: "856834DC81E449DFBBFB154546AD4085", name: "Example Lease 01" },
  { bo: "ivnt_ContractLineItem#ivnt_Maintenance",      recId: "57D703D6BE404304ACB94670BF18EF0F", name: "Example Maintenance 01" },
  { bo: "ivnt_ContractLineItem#ivnt_NDA",              recId: "301E6565F630403A9E316FCB721FC6F9", name: "Example NDA 01" },
  { bo: "ivnt_ContractLineItem#ivnt_Purchase",         recId: "A8F9C70AE0884612B80DB15A6D9F2794", name: "Example Purchase Contract 01" },
  { bo: "ivnt_ContractLineItem#ivnt_Service",          recId: "EA77C9749DF24F5689414A192292EC30", name: "Example Services Contract" },
  { bo: "ivnt_ContractLineItem#ivnt_Support",          recId: "FBF72362B27040618AC67B8A9BFF079D", name: "Example Support Contract 01" },
  { bo: "ivnt_ContractLineItem#ivnt_VolumePurchase",   recId: "E89FC13036DC488AB7FB3C163566BB16", name: "Example Volume Purchase 01" },
];

const headers = {
  "Authorization": `rest_api_key=${KEY}`,
  "Accept": "application/json",
};

let deleted = 0, notFound = 0, errors = 0;

for (const { bo, recId, name } of RECORDS) {
  const encodedBo = bo.replace(/#/g, "%23");
  const url = `${IVANTI}/api/odata/businessobject/${encodedBo}('${recId}')`;
  process.stdout.write(`DELETE ${name} (${bo})... `);
  try {
    const res = await fetch(url, { method: "DELETE", headers });
    if (res.ok || res.status === 204) {
      console.log(`✓ Deleted (${res.status})`);
      deleted++;
    } else if (res.status === 404) {
      console.log(`– Not found (already deleted?)`);
      notFound++;
    } else {
      const body = await res.text().catch(() => "");
      console.log(`✗ Error ${res.status}: ${body.slice(0, 200)}`);
      errors++;
    }
  } catch (e) {
    console.log(`✗ Network error: ${e.message}`);
    errors++;
  }
}

console.log(`\nDone — Deleted: ${deleted} | Not found: ${notFound} | Errors: ${errors}`);
