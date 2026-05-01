/**
 * reset-dev.mjs
 *
 * Wipes the dev Supabase project completely and creates a single admin user.
 * Use this for a clean-slate devops reset — no prod data, just one login.
 *
 * Usage:
 *   node scripts/reset-dev.mjs
 *
 * Admin credentials after reset:
 *   Email:    admin@dev.local
 *   Password: DEV_SEED_PASSWORD (from .env.seed)
 *
 * Config: create .env.seed in the project root (gitignored):
 *   DEV_SUPABASE_URL=https://<dev-ref>.supabase.co
 *   DEV_SUPABASE_SERVICE_ROLE_KEY=<dev-service-role-key>
 *   DEV_SEED_PASSWORD=<shared password>
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

const DEV_URL      = env.DEV_SUPABASE_URL;
const DEV_KEY      = env.DEV_SUPABASE_SERVICE_ROLE_KEY;
const DEV_PASSWORD = env.DEV_SEED_PASSWORD;

if (!DEV_URL || !DEV_KEY || !DEV_PASSWORD) {
  console.error(`
❌  Missing environment variables. Ensure .env.seed contains:

  DEV_SUPABASE_URL=https://<dev-ref>.supabase.co
  DEV_SUPABASE_SERVICE_ROLE_KEY=<dev-service-role-key>
  DEV_SEED_PASSWORD=<password for the dev admin user>
`);
  process.exit(1);
}

const dev = createClient(DEV_URL, DEV_KEY, { auth: { persistSession: false } });

const ADMIN_EMAIL = 'admin@dev.local';

// Tables in reverse FK order (children before parents) for safe deletion
const TABLES_REVERSED = [
  'task_logs',
  'logs',
  'scheduled_tasks',
  'rule_types',
  'mapping_profiles',
  'endpoint_connections',
  'customer_licenses',
  'license_types',
  'customers',
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n🔄  PHX2 Dev Reset`);
  console.log(`   Target : ${DEV_URL}`);
  console.log(`   Admin  : ${ADMIN_EMAIL}\n`);

  // ── Step 1: Wipe public tables ───────────────────────────────────────────
  console.log('🗑️   Clearing dev tables...');
  for (const table of TABLES_REVERSED) {
    const { error } = await dev.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) console.warn(`  ⚠️  Could not clear ${table}: ${error.message}`);
    else console.log(`  ✓  ${table}`);
  }

  // ── Step 2: Wipe profiles ────────────────────────────────────────────────
  const { error: profErr } = await dev.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (profErr) console.warn(`  ⚠️  Could not clear profiles: ${profErr.message}`);
  else console.log(`  ✓  profiles`);

  // ── Step 3: Delete all auth users ────────────────────────────────────────
  console.log('\n🗑️   Deleting dev auth users...');
  let page = 1;
  while (true) {
    const { data, error } = await dev.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.warn(`  ⚠️  Could not list users: ${error.message}`); break; }
    if (!data.users || data.users.length === 0) break;
    for (const u of data.users) {
      const { error: delErr } = await dev.auth.admin.deleteUser(u.id);
      if (delErr) console.warn(`  ⚠️  Could not delete ${u.email}: ${delErr.message}`);
      else console.log(`  ✓  ${u.email} deleted`);
    }
    if (data.users.length < 1000) break;
    page++;
  }

  // ── Step 4: Create admin user ─────────────────────────────────────────────
  console.log(`\n👤  Creating admin user (${ADMIN_EMAIL})...`);
  const { data: created, error: createErr } = await dev.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: 'Dev', last_name: 'Admin' },
  });
  if (createErr) {
    console.error(`  ❌ ${createErr.message}`);
    process.exit(1);
  }
  console.log(`  ✓  Auth user created (id: ${created.user.id})`);

  // ── Step 5: Create admin profile + role assignment ───────────────────────
  // Delete any trigger-created profile first, then insert with correct user_type
  await dev.from('profiles').delete().eq('id', created.user.id);

  const { error: profileErr } = await dev.from('profiles').insert({
    id: created.user.id,
    email: ADMIN_EMAIL,
    first_name: 'Dev',
    last_name: 'Admin',
    user_type: 'admin',
  });
  if (profileErr) {
    console.error(`  ❌ Could not create profile: ${profileErr.message}`);
    process.exit(1);
  }

  // Insert primary administrator role assignment
  const { error: roleErr } = await dev.from('user_roles').insert({
    user_id: created.user.id,
    role: 'administrator',
    customer_id: null,
    is_primary: true,
  });
  if (roleErr) {
    console.error(`  ❌ Could not create role assignment: ${roleErr.message}`);
    process.exit(1);
  }
  console.log(`  ✓  Profile + administrator role created`);

  // ── Step 6: Seed dev customers ───────────────────────────────────────────
  console.log('\n🏢  Creating dev customers...');
  const devCustomers = [
    {
      name: 'Acme IT Services',
      company: 'Acme Corp',
      email: 'it@acme.dev',
      payment_status: 'active',
      alert_days_before: 30,
      created_by: created.user.id,
    },
    {
      name: 'Globex Infrastructure',
      company: 'Globex Industries',
      email: 'ops@globex.dev',
      payment_status: 'active',
      alert_days_before: 30,
      created_by: created.user.id,
    },
    {
      name: 'Initech Technology',
      company: 'Initech LLC',
      email: 'tech@initech.dev',
      payment_status: 'active',
      alert_days_before: 30,
      created_by: created.user.id,
    },
  ];

  const { error: custErr } = await dev.from('customers').insert(devCustomers);
  if (custErr) console.warn(`  ⚠️  Could not create customers: ${custErr.message}`);
  else console.log(`  ✓  ${devCustomers.length} dev customers created`);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log(`
✅  Dev reset complete!

   Email    : ${ADMIN_EMAIL}
   Password : ${DEV_PASSWORD}

   Log in at http://localhost:3000
`);
}

main().catch(err => {
  console.error('\n💥  Unexpected error:', err.message);
  process.exit(1);
});
