#!/usr/bin/env node
/**
 * import-xml-templates.mjs
 *
 * Parses an Ivanti ITAM mapping XML config file and creates PHX2 system templates:
 *   • One file endpoint connection per unique Sheet name
 *   • One mapping profile per Configuration block (with full field mappings,
 *     link field resolution, key flags, and filter expressions)
 *
 * Usage:
 *   node scripts/import-xml-templates.mjs <path-to-xml> [--target=dev|prod]
 *
 * Example:
 *   node scripts/import-xml-templates.mjs "MikeCo PHX Config.xml" --target=prod
 *
 * Defaults to --target=prod when flag is omitted.
 * Config: .env.seed in the project root (same keys as seed-system-content.mjs)
 *
 *   PROD_SUPABASE_URL=https://<prod-ref>.supabase.co
 *   PROD_SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
 *   DEV_SUPABASE_URL=https://<dev-ref>.supabase.co
 *   DEV_SUPABASE_SERVICE_ROLE_KEY=<dev-service-role-key>
 */

import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Env ──────────────────────────────────────────────────────────────────────

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const result = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 0) continue;
    result[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

const env = { ...parseEnvFile(resolve(__dirname, '../.env.seed')), ...process.env };

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const targetFlag = args.find(a => a.startsWith('--target='));
const target = targetFlag ? targetFlag.split('=')[1] : 'prod';
const xmlArg = args.find(a => !a.startsWith('--'));

if (!xmlArg) {
  console.error('❌  Usage: node scripts/import-xml-templates.mjs <path-to-xml> [--target=dev|prod]');
  process.exit(1);
}

const xmlPath = resolve(process.cwd(), xmlArg);

if (!['dev', 'prod'].includes(target)) {
  console.error('❌  --target must be "dev" or "prod"');
  process.exit(1);
}

const URL_KEY = target === 'prod' ? 'PROD_SUPABASE_URL' : 'DEV_SUPABASE_URL';
const SRK_KEY = target === 'prod' ? 'PROD_SUPABASE_SERVICE_ROLE_KEY' : 'DEV_SUPABASE_SERVICE_ROLE_KEY';

if (!env[URL_KEY] || !env[SRK_KEY]) {
  console.error(`❌  Missing ${URL_KEY} or ${SRK_KEY} in .env.seed`);
  process.exit(1);
}

const supabase = createClient(env[URL_KEY], env[SRK_KEY], { auth: { persistSession: false } });

// ── XML Parser ───────────────────────────────────────────────────────────────

/** Extract the value of a named attribute from a tag string. */
function attr(tagStr, name) {
  const m = tagStr.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

/** Parse the XML file into an array of Configuration objects. */
function parseXML(xml) {
  const configs = [];

  // Match each <Configuration ...>...</Configuration> block.
  // The attributes live on the opening tag; fields are inside.
  const configRe = /<Configuration\s([\s\S]*?)>([\s\S]*?)<\/Configuration>/g;
  let cm;

  while ((cm = configRe.exec(xml)) !== null) {
    const openTag  = cm[1];
    const inner    = cm[2];

    const sheet        = attr(openTag, 'Sheet')           ?? '';
    const bo           = attr(openTag, 'BusinessObject')  ?? '';
    const filter       = attr(openTag, 'Filter');
    const relationship = attr(openTag, 'Relationship');
    const manyToMany   = attr(openTag, 'ManyToMany') === 'true';
    const distinct     = attr(openTag, 'Distinct')   === 'true';

    const fields = [];
    // Match self-closing <Field ... /> or <Field ...></Field>
    const fieldRe = /<Field\s([^>]*?)\s*\/?>/g;
    let fm;

    while ((fm = fieldRe.exec(inner)) !== null) {
      const ft = fm[1];
      fields.push({
        source:       attr(ft, 'Source')           ?? '',
        destination:  attr(ft, 'Destination')      ?? '',
        isKey:        attr(ft, 'IsKey')             === 'true',
        linkBo:       attr(ft, 'LinkBusinessObject'),
        linkField:    attr(ft, 'LinkField'),
        linkRequired: attr(ft, 'LinkRequired')      === 'true',
        isUrlFile:    attr(ft, 'IsUrlFile')         === 'true',
        isStatic:     attr(ft, 'IsStatic')          === 'true',
      });
    }

    configs.push({ sheet, bo, filter, relationship, manyToMany, distinct, fields });
  }

  return configs;
}

// ── Record Builders ──────────────────────────────────────────────────────────

function buildEndpoint(sheet) {
  return {
    id:   randomUUID(),
    name: `ITAM: ${sheet}`,
    type: 'file',
    config: {
      file_type: 'xlsx',
      file_mode: 'file',
      file_path: '',
      file_name: `${sheet}.xlsx`,
    },
    is_system:   true,
    created_by:  null,
    customer_id: null,
  };
}

function buildMappingProfile(config, sourceConnId, passLabel) {
  const { sheet, bo, filter, fields } = config;

  // ── Source fields: unique by name, skipping the #ALL# sentinel ──────────
  const seenSrc = new Set();
  const sourceFields = [];
  for (const f of fields) {
    if (f.source && f.source !== '#ALL#' && !seenSrc.has(f.source)) {
      sourceFields.push({ id: randomUUID(), name: f.source });
      seenSrc.add(f.source);
    }
  }

  // ── Target fields: unique by name ────────────────────────────────────────
  const seenTgt = new Set();
  const targetFields = [];
  for (const f of fields) {
    if (f.destination && !seenTgt.has(f.destination)) {
      targetFields.push({ id: randomUUID(), name: f.destination });
      seenTgt.add(f.destination);
    }
  }

  // Fast lookup maps
  const srcIdByName = Object.fromEntries(sourceFields.map(f => [f.name, f.id]));
  const tgtIdByName = Object.fromEntries(targetFields.map(f => [f.name, f.id]));

  // ── Mapping rows ──────────────────────────────────────────────────────────
  const mappings = fields.map(f => {
    const row = {
      id:            randomUUID(),
      sourceFieldId: f.source === '#ALL#' ? '__static__' : (srcIdByName[f.source] ?? f.source),
      targetFieldId: tgtIdByName[f.destination] ?? f.destination,
      transform:     'none',
    };

    if (f.isKey)  row.isKey  = true;

    if (f.linkBo) {
      row.isLinkField       = true;
      row.linkFieldBoName   = f.linkBo;
      if (f.linkField) row.linkFieldLookupField = f.linkField;
    }

    return row;
  });

  // ── Profile name ──────────────────────────────────────────────────────────
  const name = passLabel
    ? `ITAM: ${sheet} → ${bo} ${passLabel}`
    : `ITAM: ${sheet} → ${bo}`;

  // Build a human-readable description
  const descParts = [];
  if (filter)              descParts.push(`Filter: ${filter}`);
  if (config.relationship) descParts.push(`Relationship: ${config.relationship}`);
  if (config.manyToMany)   descParts.push('Many-to-many join');
  if (config.distinct)     descParts.push('Distinct rows only');
  const description = descParts.length ? descParts.join(' | ') : null;

  return {
    id:                    randomUUID(),
    name,
    description,
    source_fields:         sourceFields,
    target_fields:         targetFields,
    mappings,
    source_connection_id:  sourceConnId ?? null,
    target_connection_id:  null,
    target_business_object: bo || null,
    filter_expression:     filter ?? null,
    is_system:             true,
    created_by:            null,
    customer_id:           null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧  PHX2 ITAM XML Template Importer`);
  console.log(`   Target : ${target}  (${env[URL_KEY]})`);
  console.log(`   XML    : ${xmlPath}\n`);

  if (!existsSync(xmlPath)) {
    console.error(`❌  XML file not found: ${xmlPath}`);
    process.exit(1);
  }

  const xml     = readFileSync(xmlPath, 'utf8');
  const configs = parseXML(xml);
  console.log(`📄  Parsed ${configs.length} Configuration blocks\n`);

  // ── Fetch existing system record names to enable skip-if-exists ──────────

  const { data: existingConns } = await supabase
    .from('endpoint_connections')
    .select('id, name')
    .eq('is_system', true);
  const connByName = Object.fromEntries((existingConns ?? []).map(r => [r.name, r.id]));

  const { data: existingProfiles } = await supabase
    .from('mapping_profiles')
    .select('name')
    .eq('is_system', true);
  const existingProfileNames = new Set((existingProfiles ?? []).map(r => r.name));

  // ── Step 1: Create file endpoint templates (one per unique sheet) ─────────

  console.log('── Endpoint connections ─────────────────────────────────────');
  const uniqueSheets    = [...new Set(configs.map(c => c.sheet))];
  const sheetToConnId   = {};
  let connCreated = 0, connSkipped = 0, connFailed = 0;

  for (const sheet of uniqueSheets) {
    const connName = `ITAM: ${sheet}`;

    if (connByName[connName]) {
      sheetToConnId[sheet] = connByName[connName];
      process.stdout.write(`  — (exists) ${connName}\n`);
      connSkipped++;
      continue;
    }

    const endpoint = buildEndpoint(sheet);
    sheetToConnId[sheet] = endpoint.id;

    const { error } = await supabase
      .from('endpoint_connections')
      .insert(endpoint);

    if (error) {
      console.error(`  ❌ ${connName}: ${error.message}`);
      connFailed++;
    } else {
      console.log(`  ✓  ${connName}`);
      connCreated++;
    }
  }

  console.log(`\n  → ${connCreated} created, ${connSkipped} skipped, ${connFailed} failed\n`);

  // ── Step 2: Create mapping profiles (one per Configuration block) ─────────

  console.log('── Mapping profiles ─────────────────────────────────────────');

  // Track how many times each (sheet, bo) pair appears so we can label passes.
  const pairTotal = {};
  const pairSeen  = {};
  for (const c of configs) {
    const k = `${c.sheet}|${c.bo}`;
    pairTotal[k] = (pairTotal[k] ?? 0) + 1;
  }

  let profCreated = 0, profSkipped = 0, profFailed = 0;

  // Ordered list of profile IDs for the task template (matches XML dependency order)
  const orderedProfileIds = [];

  for (const config of configs) {
    const key = `${config.sheet}|${config.bo}`;
    pairSeen[key] = (pairSeen[key] ?? 0) + 1;

    const passLabel = pairTotal[key] > 1
      ? `(Pass ${pairSeen[key]})`
      : null;

    const profile = buildMappingProfile(
      config,
      sheetToConnId[config.sheet] ?? null,
      passLabel,
    );

    if (existingProfileNames.has(profile.name)) {
      // Fetch the existing profile's ID so the task slot still references it
      const { data: existing } = await supabase
        .from('mapping_profiles')
        .select('id')
        .eq('name', profile.name)
        .single();
      if (existing?.id) orderedProfileIds.push({ id: existing.id, name: profile.name });
      console.log(`  — (exists) ${profile.name}`);
      profSkipped++;
      continue;
    }

    const { error } = await supabase
      .from('mapping_profiles')
      .insert(profile);

    if (error) {
      console.error(`  ❌ ${profile.name}: ${error.message}`);
      profFailed++;
    } else {
      console.log(`  ✓  ${profile.name}`);
      orderedProfileIds.push({ id: profile.id, name: profile.name });
      profCreated++;
    }
  }

  console.log(`\n  → ${profCreated} created, ${profSkipped} skipped, ${profFailed} failed`);

  // ── Step 3: Create the "MikeCo Import" task template ─────────────────────

  console.log('\n── Scheduled task ───────────────────────────────────────────');
  const TASK_NAME = 'MikeCo Import';

  const { data: existingTask } = await supabase
    .from('scheduled_tasks')
    .select('id')
    .eq('task_name', TASK_NAME)
    .maybeSingle();

  if (existingTask) {
    console.log(`  — (exists) ${TASK_NAME} — skipped`);
  } else {
    const mappingSlots = orderedProfileIds.map(({ id, name }) => ({
      id:                 randomUUID(),
      mapping_profile_id: id,
      label:              name.replace(/^ITAM:\s*/, ''),
    }));

    const task = {
      id:                  randomUUID(),
      task_name:           TASK_NAME,
      start_date_time:     new Date().toISOString(),
      end_date_time:       null,
      recurrence:          'one-time',
      source_file_path:    null,
      ivanti_url:          null,
      status:              'waiting',
      mapping_profile_id:  null,
      source_connection_id: null,
      target_connection_id: null,
      mapping_slots:       mappingSlots,
      write_mode:          'upsert',
      is_system:           true,
      customer_id:         null,
      created_by:          null,
    };

    const { error: taskErr } = await supabase
      .from('scheduled_tasks')
      .insert(task);

    if (taskErr) {
      console.error(`  ❌ ${TASK_NAME}: ${taskErr.message}`);
    } else {
      console.log(`  ✓  ${TASK_NAME}  (${mappingSlots.length} slots)`);
    }
  }

  const anyFailed = connFailed + profFailed > 0;
  console.log(anyFailed
    ? `\n⚠️  Completed with errors — check output above.\n`
    : `\n✅  Done.\n`
  );

  if (anyFailed) process.exit(1);
}

main().catch(err => {
  console.error('\n💥  Unexpected error:', err.message);
  process.exit(1);
});
