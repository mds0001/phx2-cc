import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared software-normalization engine — used by every inventory source
 * (/api/intune-proxy, /api/ivanti-neurons-proxy) so all sources feed the same
 * knowledge layer (software_catalog / software_signatures /
 * software_research_queue) and emit the same row fields the runner's
 * hydration step consumes (_installed_products / _licensable_products).
 */

export interface CatalogRow {
  id: string;
  manufacturer: string;
  title: string;
  version: string | null;
  edition: string | null;
  licensable: boolean;
}

export interface SignatureRow {
  id: string;
  publisher: string | null;
  name_pattern: string;
  version_pattern: string | null;
  verdict: "product" | "component_of" | "noise";
  catalog_id: string | null;
}

export interface CompiledSignature {
  sig: SignatureRow;
  nameRe: RegExp;
  versionRe: RegExp | null;
}

/** One raw inventory entry from any source (ARP string, Neurons software row…). */
export interface RawApp {
  name: string;
  publisher: string;
  version: string;
  lastUsed?: string | null;
  launchCount?: number | null;
  minutesUsed?: number | null;
}

/** One resolved product on a device — the shape hydration consumes. */
export interface ResolvedProduct {
  manufacturer: string | null;
  title: string | null;
  version: string | null;
  edition: string | null;
  full_name: string;
  licensable: boolean;
  raw_version: string;
  last_used: string | null;
  launch_count: number | null;
  minutes_used: number | null;
}

export const norm = (s: unknown): string => (typeof s === "string" ? s.trim().toLowerCase() : "");

/** Publisher comparison ignores legal-suffix noise — real inventories report
 *  "Microsoft" / "Adobe" / "Google" where catalogs say "Microsoft Corporation"
 *  / "Adobe Inc." / "Google LLC". */
const LEGAL_SUFFIXES = /\b(corporation|corp|incorporated|inc|llc|ltd|limited|gmbh|co)\b\.?/g;
export function normPublisher(s: unknown): string {
  return norm(s).replace(/[.,]/g, " ").replace(LEGAL_SUFFIXES, " ").replace(/\s+/g, " ").trim();
}

/** Convert a SQL LIKE pattern (%, _) to an anchored case-insensitive RegExp. */
export function likeToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function compileSignatures(sigs: SignatureRow[]): CompiledSignature[] {
  const compiled: CompiledSignature[] = [];
  for (const sig of sigs) {
    try {
      compiled.push({
        sig,
        nameRe: likeToRegex(sig.name_pattern),
        versionRe: sig.version_pattern ? likeToRegex(sig.version_pattern) : null,
      });
    } catch {
      // A malformed pattern must never break a read — skip it.
    }
  }
  // Specific publisher before any-publisher, longer (more specific) name patterns first.
  compiled.sort((a, b) => {
    const pubA = a.sig.publisher ? 0 : 1;
    const pubB = b.sig.publisher ? 0 : 1;
    if (pubA !== pubB) return pubA - pubB;
    return b.sig.name_pattern.length - a.sig.name_pattern.length;
  });
  return compiled;
}

export function matchSignature(
  compiled: CompiledSignature[],
  publisher: string,
  name: string,
  version: string
): SignatureRow | null {
  for (const c of compiled) {
    if (c.sig.publisher && normPublisher(c.sig.publisher) !== normPublisher(publisher)) continue;
    if (!c.nameRe.test(name)) continue;
    if (c.versionRe && !c.versionRe.test(version)) continue;
    return c.sig;
  }
  return null;
}

export function catalogFullName(c: CatalogRow): string {
  // Skip the manufacturer when the title already leads with it
  // ("Zoom" + "Zoom Workplace" -> "Zoom Workplace", not "Zoom Zoom Workplace").
  const mfrFirst = (c.manufacturer ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const titleFirst = (c.title ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const parts = mfrFirst && mfrFirst === titleFirst
    ? [c.title, c.version, c.edition]
    : [c.manufacturer, c.title, c.version, c.edition];
  return parts.filter(Boolean).join(" ");
}

export interface Knowledge {
  compiled: CompiledSignature[];
  catalogById: Map<string, CatalogRow>;
}

/** Load ACTIVE signatures + the catalog once per request. */
export async function loadKnowledge(admin: SupabaseClient): Promise<Knowledge> {
  const [sigRes, catRes] = await Promise.all([
    admin.from("software_signatures")
      .select("id, publisher, name_pattern, version_pattern, verdict, catalog_id")
      .eq("status", "active"),
    admin.from("software_catalog")
      .select("id, manufacturer, title, version, edition, licensable"),
  ]);
  const catalogById = new Map<string, CatalogRow>();
  for (const c of (catRes.data ?? []) as CatalogRow[]) catalogById.set(c.id, c);
  return { compiled: compileSignatures((sigRes.data ?? []) as SignatureRow[]), catalogById };
}

/** Resolve one device's raw apps into deduped products. Unmatched apps are
 *  reported to the collector for the research queue. */
export function resolveDeviceApps(
  apps: RawApp[],
  knowledge: Knowledge,
  unknowns: UnknownCollector,
  deviceId: string
): ResolvedProduct[] {
  const appNames = apps.map((a) => a.name).filter(Boolean);
  const products = new Map<string, ResolvedProduct>();

  for (const app of apps) {
    const name = (app.name ?? "").trim();
    if (!name) continue;
    const publisher = (app.publisher ?? "").trim();
    const version = (app.version ?? "").trim();
    const sig = matchSignature(knowledge.compiled, publisher, name, version);

    if (!sig) {
      unknowns.add({ ...app, name, publisher, version }, deviceId, appNames);
      continue;
    }
    if (sig.verdict === "noise" || !sig.catalog_id) continue;
    const cat = knowledge.catalogById.get(sig.catalog_id);
    if (!cat) continue;

    const existing = products.get(cat.id);
    const isDirect = sig.verdict === "product";
    if (!existing) {
      products.set(cat.id, {
        manufacturer: cat.manufacturer,
        title: cat.title,
        version: cat.version,
        edition: cat.edition,
        full_name: catalogFullName(cat),
        licensable: cat.licensable,
        raw_version: isDirect ? version : "",
        last_used: isDirect ? app.lastUsed ?? null : null,
        launch_count: isDirect ? app.launchCount ?? null : null,
        minutes_used: isDirect ? app.minutesUsed ?? null : null,
      });
    } else if (isDirect) {
      // A direct product match beats data inherited from a component match.
      if (!existing.raw_version) existing.raw_version = version;
      if (existing.last_used == null) existing.last_used = app.lastUsed ?? null;
      if (existing.launch_count == null) existing.launch_count = app.launchCount ?? null;
      if (existing.minutes_used == null) existing.minutes_used = app.minutesUsed ?? null;
    }
  }

  return [...products.values()];
}

interface UnknownEntry {
  publisher: string;
  name: string;
  sample_version: string;
  seen_count: number;
  devices: Set<string>;
  co_installed_sample: string[];
}

/** Accumulates unmatched raw strings across a whole read, then bumps the
 *  research queue once. */
export class UnknownCollector {
  private map = new Map<string, UnknownEntry>();

  add(app: RawApp, deviceId: string, coInstalled: string[]): void {
    const rawKey = `${norm(app.publisher)}||${norm(app.name)}`;
    let u = this.map.get(rawKey);
    if (!u) {
      u = {
        publisher: app.publisher,
        name: app.name,
        sample_version: app.version,
        seen_count: 0,
        devices: new Set(),
        co_installed_sample: coInstalled.filter((n) => n !== app.name).slice(0, 10),
      };
      this.map.set(rawKey, u);
    }
    u.seen_count++;
    if (deviceId) u.devices.add(deviceId);
  }

  get size(): number {
    return this.map.size;
  }

  /** Upsert-with-increment into software_research_queue. Never throws. */
  async bump(admin: SupabaseClient, customerId: string | null): Promise<number> {
    if (this.map.size === 0) return 0;
    const items = [...this.map.entries()].map(([raw_key, u]) => ({
      raw_key,
      publisher: u.publisher,
      name: u.name,
      sample_version: u.sample_version,
      seen_count: u.seen_count,
      device_count: u.devices.size,
      customer_id: customerId ?? "",
      context: { co_installed_sample: u.co_installed_sample },
    }));
    const { error } = await admin.rpc("software_queue_bump", { items });
    if (error) {
      console.error("[softwareNormalization] queue bump failed:", error.message);
      return 0;
    }
    return items.length;
  }
}

/** Attach the standard software fields to a device row (any source). */
export function attachSoftwareFields(
  row: Record<string, unknown>,
  resolved: ResolvedProduct[],
  detectedAppCount: number
): void {
  const licNames = resolved.filter((p) => p.licensable).map((p) => p.full_name).sort();
  row.LicensableSoftware = licNames.join("; ");
  row.LicensableSoftwareCount = licNames.length;
  row.DetectedAppCount = detectedAppCount;
  row._installed_products = resolved;
  row._licensable_products = resolved.filter((p) => p.licensable);
}
