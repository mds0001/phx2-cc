/**
 * seed-dev.mjs
 *
 * Copies all application data (including auth users) from the production
 * Supabase project to the dev Supabase project. Safe to re-run — existing
 * rows are skipped. Auth users are created with DEV_SEED_PASSWORD so you
 * can log in locally without needing prod credentials.
 *
 * Usage:
 *   node scripts/seed-dev.mjs          # skip existing rows
 *   node scripts/seed-dev.mjs --fresh  # wipe dev tables + users, then insert
 *
 * Config: create .env.seed in the project root (gitignored):
 *   PROD_SUPABASE_URL=https://<prod-ref>.supabase.co
 *   PROD_SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
 *   DEV_SUPABASE_URL=https://<dev-ref>.supabase.co
 *   DEV_SUPABASE_SERVICE_ROLE_KEY=<dev-service-role-key>
 *   DEV_SEED_PASSWORD=<password all dev users will share>
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

const PROD_URL       = env.PROD_SUPABASE_URL;
const PROD_KEY       = env.PROD_SUPABASE_SERVICE_ROLE_KEY;
const DEV_URL        = env.DEV_SUPABASE_URL;
const DEV_KEY        = env.DEV_SUPABASE_SERVICE_ROLE_KEY;
const DEV_PASSWORD   = env.DEV_SEED_PASSWORD;

if (!PROD_URL || !PROD_KEY || !DEV_URL || !DEV_KEY || !DEV_PASSWORD) {
  console.error(`
❌  Missing environment variables. Ensure .env.seed contains:

  PROD_SUPABASE_URL=https://<prod-ref>.supabase.co
  PROD_SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
  DEV_SUPABASE_URL=https://<dev-ref>.supabase.co
  DEV_SUPABASE_SERVICE_ROLE_KEY=<dev-service-role-key>
  DEV_SEED_PASSWORD=<shared password for all dev users>
`);
  process.exit(1);
}

const prod = createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false } });
const dev  = createClient(DEV_URL,  DEV_KEY,  { auth: { persistSession: false } });

const FRESH = process.argv.includes('--fresh');

// ---------------------------------------------------------------------------
// Table definitions — ordered by FK dependency (parents before children).
// profiles comes after auth users are seeded.
// ---------------------------------------------------------------------------

const TABLES = [
  // No dependencies
  { table: 'customers',            nullFields: ['created_by'] },
  { table: 'license_types',        nullFields: ['created_by'] },

  // Depends on customers + license_types
  { table: 'customer_licenses',    nullFields: [] },

  // Depends on customers
  { table: 'endpoint_connections', nullFields: ['created_by'] },

  // Depends on endpoint_connections + customers
  { table: 'mapping_profiles',     nullFields: ['created_by'] },

  // Depends on endpoint_connections + mapping_profiles + profiles
  { table: 'rule_types',           nullFields: ['created_by'] },

  // Depends on rule_types + mapping_profiles + endpoint_connections + customers
  { table: 'scheduled_tasks',      nullFields: ['created_by'] },

  // Operational — uncomment to copy run history
  // { table: 'task_logs',         nullFields: ['created_by'] },
  // { table: 'logs',              nullFields: [] },

  // Cache — rebuilds automatically, no need to seed
  // { table: 'ai_lookup_cache',   nullFields: [] },
];

// Reverse order for truncation (children before parents)
const TABLES_REVERSED = [...TABLES].reverse();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyNulls(rows, nullFields) {
  if (!nullFields.length) return rows;
  return rows.map(row => {
    const copy = { ...row };
    for (const f of nullFields) copy[f] = null;
    return copy;
  });
}

async function fetchAll(client, table) {
  const PAGE = 1000;
  let rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function upsertBatch(client, table, rows, batchSize = 200, ignoreDuplicates = true) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await client
      .from(table)
      .upsert(batch, { onConflict: 'id', ignoreDuplicates });
    if (error) throw new Error(`upsert ${table} (batch ${i}): ${error.message}`);
  }
}

async function fetchAllProdUsers() {
  let users = [];
  let page = 1;
  while (true) {
    const { data, error } = await prod.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`fetch auth.users: ${error.message}`);
    if (!data.users || data.users.length === 0) break;
    users = users.concat(data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  return users;
}

async function fetchAllDevUsers() {
  const existing = new Set();
  let page = 1;
  while (true) {
    const { data, error } = await dev.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`fetch dev auth.users: ${error.message}`);
    if (!data.users || data.users.length === 0) break;
    for (const u of data.users) existing.add(u.id);
    if (data.users.length < 1000) break;
    page++;
  }
  return existing;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n🌱  PHX2 Dev Seeder`);
  console.log(`   Source : ${PROD_URL}`);
  console.log(`   Target : ${DEV_URL}`);
  console.log(`   Mode   : ${FRESH ? '🔴 FRESH (wipe + insert)' : '🟢 SAFE (skip existing)'}\n`);

  // ── FRESH: wipe public tables + auth users ──────────────────────────────
  if (FRESH) {
    console.log('🗑️   Truncating dev tables...');
    for (const { table } of TABLES_REVERSED) {
      const { error } = await dev.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) console.warn(`  ⚠️  Could not clear ${table}: ${error.message}`);
      else console.log(`  ✓  ${table} cleared`);
    }

    // Also wipe profiles (FK to auth.users, so clear before deleting users)
    const { error: profErr } = await dev.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (profErr) console.warn(`  ⚠️  Could not clear profiles: ${profErr.message}`);
    else console.log(`  ✓  profiles cleared`);

    console.log('\n🗑️   Deleting dev auth users...');
    const { data: devUsersData } = await dev.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of devUsersData?.users ?? []) {
      const { error } = await dev.auth.admin.deleteUser(u.id);
      if (error) console.warn(`  ⚠️  Could not delete user ${u.email}: ${error.message}`);
      else console.log(`  ✓  ${u.email} deleted`);
    }
    console.log('');
  }

  // ── Step 1: Auth users ──────────────────────────────────────────────────
  console.log('👤  Copying auth users...');
  let prodUsers;
  try {
    prodUsers = await fetchAllProdUsers();
  } catch (err) {
    console.error(`  ❌ ${err.message}`);
    process.exit(1);
  }

  const existingDevUserIds = await fetchAllDevUsers();
  let usersCreated = 0;
  let usersSkipped = 0;

  for (const user of prodUsers) {
    if (existingDevUserIds.has(user.id)) {
      usersSkipped++;
      continue;
    }
    const { error } = await dev.auth.admin.createUser({
      email: user.email,
      password: DEV_PASSWORD,
      email_confirm: true,          // skip email confirmation in dev
      user_metadata: user.user_metadata ?? {},
      app_metadata: user.app_metadata ?? {},
      // Preserve the original user ID so FK references in profiles/tasks work
      id: user.id,
    });
    if (error) {
      console.warn(`  ⚠️  ${user.email}: ${error.message}`);
    } else {
      usersCreated++;
    }
  }
  console.log(`  ✓  ${usersCreated} created, ${usersSkipped} already existed (${prodUsers.length} total)\n`);

  // ── Step 2: profiles (now auth.users exists) ────────────────────────────
  // NOTE: Supabase's on_auth_user_created trigger auto-creates a default profile
  // (role='schedule_administrator') when createUser() is called. We must delete
  // those trigger-created profiles before inserting the real prod values.
  console.log('📦  Copying tables...');
  const summary = [];

  process.stdout.write(`  ${'profiles'.padEnd(28)}`);
  try {
    const profileRows = await fetchAll(prod, 'profiles');
    if (profileRows.length === 0) {
      console.log('— (empty)');
      summary.push({ table: 'profiles', status: 'EMPTY', count: 0 });
    } else {
      // Delete all existing dev profiles for users we're about to seed,
      // then insert fresh from prod. This overwrites trigger-created defaults.
      const ids = profileRows.map(r => r.id);
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const { error: delErr } = await dev.from('profiles').delete().in('id', batch);
        if (delErr) throw new Error(`delete profiles (batch ${i}): ${delErr.message}`);
      }
      for (let i = 0; i < profileRows.length; i += 200) {
        const batch = profileRows.slice(i, i + 200);
        const { error: insErr } = await dev.from('profiles').insert(batch);
        if (insErr) throw new Error(`insert profiles (batch ${i}): ${insErr.message}`);
      }
      console.log(`✓  ${profileRows.length} rows`);
      summary.push({ table: 'profiles', status: 'OK', count: profileRows.length });
    }
  } catch (err) {
    console.log(`❌ ${err.message}`);
    summary.push({ table: 'profiles', status: 'ERROR', count: 0 });
  }

  // ── Step 3: remaining public tables ─────────────────────────────────────
  for (const { table, nullFields } of TABLES) {
    process.stdout.write(`  ${table.padEnd(28)}`);

    let rows;
    try {
      rows = await fetchAll(prod, table);
    } catch (err) {
      console.log(`❌ fetch failed: ${err.message}`);
      summary.push({ table, status: 'ERROR', count: 0 });
      continue;
    }

    if (rows.length === 0) {
      console.log('— (empty)');
      summary.push({ table, status: 'EMPTY', count: 0 });
      continue;
    }

    const prepared = applyNulls(rows, nullFields);

    try {
      await upsertBatch(dev, table, prepared);
      console.log(`✓  ${rows.length} rows`);
      summary.push({ table, status: 'OK', count: rows.length });
    } catch (err) {
      console.log(`❌ insert failed: ${err.message}`);
      summary.push({ table, status: 'ERROR', count: rows.length });
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n📊  Summary:');
  console.log(`  ✅  auth.users                   ${prodUsers.length} users (password: ${DEV_PASSWORD})`);
  for (const { table, status, count } of summary) {
    const icon = status === 'OK' ? '✅' : status === 'EMPTY' ? '➖' : '❌';
    console.log(`  ${icon}  ${table.padEnd(28)} ${count} rows`);
  }

  const errors = summary.filter(s => s.status === 'ERROR');
  if (errors.length) {
    console.log(`\n⚠️  ${errors.length} table(s) had errors. Check output above.\n`);
    process.exit(1);
  } else {
    console.log(`\n✅  Done! Log in at http://localhost:3000 with your email and: ${DEV_PASSWORD}\n`);
  }

  // ── RLS policy check ─────────────────────────────────────────────────────
  const { data: policyCheck } = await dev
    .from('profiles')
    .select('id')
    .limit(1);
  if (policyCheck === null) {
    console.warn(`\n⚠️  WARNING: Dev profiles table returned no data — RLS policies may be missing.`);
    console.warn(`   Run the migration in scripts/setup-dev-rls.sql against the dev project to fix.\n`);
  }
}

main().catch(err => {
  console.error('\n💥  Unexpected error:', err.message);
  process.exit(1);
});
