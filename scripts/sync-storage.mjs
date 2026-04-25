/**
 * sync-storage.mjs
 * Copies all files from prod task_files/connections/ → dev task_files/connections/
 * Run from the project root: node scripts/sync-storage.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.seed");

// Parse .env.seed
const env = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const [key, ...rest] = trimmed.split("=");
  env[key.trim()] = rest.join("=").trim();
}

const PROD_URL = env.PROD_SUPABASE_URL;
const PROD_KEY = env.PROD_SUPABASE_SERVICE_ROLE_KEY;
const DEV_URL  = env.DEV_SUPABASE_URL;
const DEV_KEY  = env.DEV_SUPABASE_SERVICE_ROLE_KEY;

if (!PROD_URL || !PROD_KEY || !DEV_URL || !DEV_KEY) {
  console.error("Missing keys in .env.seed");
  process.exit(1);
}

const prod = createClient(PROD_URL, PROD_KEY);
const dev  = createClient(DEV_URL,  DEV_KEY);

const BUCKET = "task_files";
const PREFIX = "connections/";

async function listAll(client, prefix) {
  const all = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const { data, error } = await client.storage
      .from(BUCKET)
      .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }
  return all;
}

console.log(`\nListing files in prod ${BUCKET}/${PREFIX}...`);
const files = await listAll(prod, PREFIX.replace(/\/$/, ""));
console.log(`Found ${files.length} file(s)\n`);

let copied = 0, skipped = 0, failed = 0;

for (const file of files) {
  if (!file.name || file.id === null) continue; // skip folder placeholders
  const path = `${PREFIX}${file.name}`;

  // Check if already exists in dev
  const { data: existing } = await dev.storage.from(BUCKET).list(PREFIX.replace(/\/$/, ""), {
    search: file.name,
  });
  const alreadyExists = existing?.some((f) => f.name === file.name);
  if (alreadyExists) {
    console.log(`  SKIP  ${path} (already in dev)`);
    skipped++;
    continue;
  }

  // Download from prod
  const { data: blob, error: dlErr } = await prod.storage.from(BUCKET).download(path);
  if (dlErr || !blob) {
    console.error(`  FAIL  ${path} — download error: ${dlErr?.message}`);
    failed++;
    continue;
  }

  // Upload to dev
  const buffer = Buffer.from(await blob.arrayBuffer());
  const { error: ulErr } = await dev.storage.from(BUCKET).upload(path, buffer, {
    contentType: blob.type || "application/octet-stream",
    upsert: true,
  });
  if (ulErr) {
    console.error(`  FAIL  ${path} — upload error: ${ulErr.message}`);
    failed++;
    continue;
  }

  console.log(`  OK    ${path}`);
  copied++;
}

console.log(`\nDone. Copied: ${copied} | Skipped: ${skipped} | Failed: ${failed}`);
