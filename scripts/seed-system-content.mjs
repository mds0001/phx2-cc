/**
 * seed-system-content.mjs
 *
 * Copies all system content (is_system = true) from the production Supabase
 * project to the dev project. Safe to re-run — existing rows are updated in
 * place (upsert by id).
 *
 * Run this after adding or updating system templates in prod to sync them
 * to dev (or any other environment).
 *
 * Usage:
 *   node scripts/seed-system-content.mjs
 *
 * Config: .env.seed in the project root (gitignored):
 *   PROD_SUPABASE_URL=https://<prod-ref>.supabase.co
 *   PROD_SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
 *   DEV_SUPABASE_URL=https://<dev-ref>.supabase.co
 *   DEV_SUPABASE_SERVICE_ROLE_KEY=<dev-service-role-key>
 */

import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dirname, '../.env.seed');

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

const env = { ...parseEnvFile(envFile), ...process.env };

const PROD_URL = env.PROD_SUPABASE_URL;
const PROD_KEY = env.PROD_SUPABASE_SERVICE_ROLE_KEY;
const DEV_URL  = env.DEV_SUPABASE_URL;
const DEV_KEY  = env.DEV_SUPABASE_SERVICE_ROLE_KEY;

if (!PROD_URL || !PROD_KEY || !DEV_URL || !DEV_KEY) {
  console.error(`
❌  Missing environment variables. Ensure .env.seed contains:

  PROD_SUPABASE_URL=https://<prod-ref>.supabase.co
  PROD_SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
  DEV_SUPABASE_URL=https://<dev-ref>.supabase.co
  DEV_SUPABASE_SERVICE_ROLE_KEY=<dev-service-role-key>
`);
  process.exit(1);
}

const prod = createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false } });
const dev  = createClient(DEV_URL,  DEV_KEY,  { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchSystemRecords(client, table) {
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('is_system', true)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`fetch ${table}: ${error.message}`);
  return data ?? [];
}

async function upsertSystemRecords(client, table, rows) {
  if (rows.length === 0) return;
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await client
      .from(table)
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw new Error(`upsert ${table} (batch ${i}): ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n📦  PHX2 System Content Seed`);
  console.log(`   Source : ${PROD_URL}`);
  console.log(`   Target : ${DEV_URL}\n`);

  const summary = [];

  // Strip prod-specific user references that won't exist in dev
  function sanitize(rows) {
    return rows.map((r) => ({ ...r, created_by: null, customer_id: null }));
  }

  // ── 1. Endpoint connections (must come before mapping_profiles due to FK) ─
  process.stdout.write(`  ${'endpoint_connections'.padEnd(28)}`);
  try {
    const rows = await fetchSystemRecords(prod, 'endpoint_connections');
    if (rows.length === 0) {
      console.log('— (none)');
      summary.push({ table: 'endpoint_connections', count: 0 });
    } else {
      await upsertSystemRecords(dev, 'endpoint_connections', sanitize(rows));
      console.log(`✓  ${rows.length} template${rows.length !== 1 ? 's' : ''}`);
      summary.push({ table: 'endpoint_connections', count: rows.length });
    }
  } catch (err) {
    console.log(`❌ ${err.message}`);
    summary.push({ table: 'endpoint_connections', count: 0, error: true });
  }

  // ── 2. Mapping profiles ────────────────────────────────────────────────────
  process.stdout.write(`  ${'mapping_profiles'.padEnd(28)}`);
  try {
    const rows = await fetchSystemRecords(prod, 'mapping_profiles');
    if (rows.length === 0) {
      console.log('— (none)');
      summary.push({ table: 'mapping_profiles', count: 0 });
    } else {
      await upsertSystemRecords(dev, 'mapping_profiles', sanitize(rows));
      console.log(`✓  ${rows.length} template${rows.length !== 1 ? 's' : ''}`);
      summary.push({ table: 'mapping_profiles', count: rows.length });
    }
  } catch (err) {
    console.log(`❌ ${err.message}`);
    summary.push({ table: 'mapping_profiles', count: 0, error: true });
  }

  // ── 3. Scheduled tasks (system templates) ─────────────────────────────────
  process.stdout.write(`  ${'scheduled_tasks'.padEnd(28)}`);
  try {
    const rows = await fetchSystemRecords(prod, 'scheduled_tasks');
    if (rows.length === 0) {
      console.log('— (none)');
      summary.push({ table: 'scheduled_tasks', count: 0 });
    } else {
      await upsertSystemRecords(dev, 'scheduled_tasks', sanitize(rows));
      console.log(`✓  ${rows.length} template${rows.length !== 1 ? 's' : ''}`);
      summary.push({ table: 'scheduled_tasks', count: rows.length });
    }
  } catch (err) {
    console.log(`❌ ${err.message}`);
    summary.push({ table: 'scheduled_tasks', count: 0, error: true });
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const total = summary.reduce((n, s) => n + s.count, 0);
  const errors = summary.filter((s) => s.error);

  if (errors.length) {
    console.log(`\n⚠️  ${errors.length} table(s) had errors. Check output above.\n`);
    process.exit(1);
  } else {
    console.log(`\n✅  Done — ${total} system template${total !== 1 ? 's' : ''} synced to dev.\n`);
  }
}

main().catch(err => {
  console.error('\n💥  Unexpected error:', err.message);
  process.exit(1);
});
