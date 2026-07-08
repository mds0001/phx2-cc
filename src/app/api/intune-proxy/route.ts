import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { DEMO_DEVICES, DEMO_TENANT } from "@/lib/intuneDemoFleet";

/**
 * Intune proxy — reads managed devices (and optionally their detected apps)
 * from Microsoft Graph server-side so client credentials never reach the
 * browser and CORS is a non-issue.
 *
 * PUT = source read (mirrors ivanti-proxy / ivanti-neurons-proxy): returns
 * { rows } where each row is one managed device flattened to Excel-like
 * headers for the mapping editor. When includeSoftware is on, each device's
 * detected apps are matched against ACTIVE software_signatures:
 *   - product / component_of -> the catalog product lands in LicensableSoftware
 *   - noise                  -> suppressed (runtimes, redistributables, updaters)
 *   - no signature           -> bumped into software_research_queue for research
 */

export const maxDuration = 300;

const GRAPH = "https://graph.microsoft.com/v1.0";

interface GraphDevice {
  id?: string;
  deviceName?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  operatingSystem?: string;
  osVersion?: string;
  userPrincipalName?: string;
  userDisplayName?: string;
  emailAddress?: string;
  complianceState?: string;
  managedDeviceOwnerType?: string;
  enrolledDateTime?: string;
  lastSyncDateTime?: string;
  totalStorageSpaceInBytes?: number;
  freeStorageSpaceInBytes?: number;
  wiFiMacAddress?: string;
  ethernetMacAddress?: string;
  azureADDeviceId?: string;
}

interface DetectedApp {
  displayName?: string;
  version?: string;
  publisher?: string;
}

interface CatalogRow {
  id: string;
  manufacturer: string;
  title: string;
  version: string | null;
  edition: string | null;
  licensable: boolean;
}

interface SignatureRow {
  id: string;
  publisher: string | null;
  name_pattern: string;
  version_pattern: string | null;
  verdict: "product" | "component_of" | "noise";
  catalog_id: string | null;
}

async function getGraphToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Graph token request failed (HTTP ${res.status}): ${txt.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Graph token endpoint returned no access_token");
  return data.access_token;
}

/** GET with 429/503 retry honouring Retry-After (Graph throttles per-app-per-tenant). */
async function graphGet(url: string, token: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 || res.status === 503) {
      if (attempt >= 5) throw new Error(`Graph throttled repeatedly (HTTP ${res.status}) at ${url}`);
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "", 10);
      const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 30_000)));
      continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Graph request failed (HTTP ${res.status}): ${txt.slice(0, 300)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

/** Follow @odata.nextLink until exhausted or cap (0 = no cap) is reached. */
async function graphGetAll(url: string, token: string, cap: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next: string | null = url;
  while (next) {
    const page = await graphGet(next, token);
    const value = Array.isArray(page.value) ? (page.value as Record<string, unknown>[]) : [];
    out.push(...value);
    if (cap > 0 && out.length >= cap) return out.slice(0, cap);
    next = typeof page["@odata.nextLink"] === "string" ? (page["@odata.nextLink"] as string) : null;
  }
  return out;
}

const norm = (s: unknown): string => (typeof s === "string" ? s.trim().toLowerCase() : "");

/** Convert a SQL LIKE pattern (%, _) to an anchored case-insensitive RegExp. */
function likeToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

interface CompiledSignature {
  sig: SignatureRow;
  nameRe: RegExp;
  versionRe: RegExp | null;
}

function compileSignatures(sigs: SignatureRow[]): CompiledSignature[] {
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

function matchSignature(
  compiled: CompiledSignature[],
  publisher: string,
  name: string,
  version: string
): SignatureRow | null {
  for (const c of compiled) {
    if (c.sig.publisher && norm(c.sig.publisher) !== norm(publisher)) continue;
    if (!c.nameRe.test(name)) continue;
    if (c.versionRe && !c.versionRe.test(version)) continue;
    return c.sig;
  }
  return null;
}

function catalogFullName(c: CatalogRow): string {
  // Skip the manufacturer when the title already leads with it
  // ("Zoom" + "Zoom Workplace" -> "Zoom Workplace", not "Zoom Zoom Workplace").
  const mfrFirst = (c.manufacturer ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const titleFirst = (c.title ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const parts = mfrFirst && mfrFirst === titleFirst
    ? [c.title, c.version, c.edition]
    : [c.manufacturer, c.title, c.version, c.edition];
  return parts.filter(Boolean).join(" ");
}

const bytesToGB = (b: unknown): number | null =>
  typeof b === "number" && b > 0 ? Math.round(b / 1024 ** 3) : null;

/** Track a raw app string no signature matched, for the research queue. */
interface UnknownApp {
  publisher: string;
  name: string;
  sample_version: string;
  seen_count: number;
  devices: Set<string>;
  co_installed_sample: string[];
}

// ── PUT: source read — one row per managed device ─────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      tenantId?: string;
      clientId?: string;
      clientSecret?: string;
      maxDevices?: number;
      includeSoftware?: boolean;
      customerId?: string | null;
    };
    const { tenantId, clientId, clientSecret, customerId } = body;
    const maxDevices = typeof body.maxDevices === "number" && body.maxDevices > 0 ? body.maxDevices : 0;
    const includeSoftware = body.includeSoftware !== false;

    const isDemo = norm(tenantId) === DEMO_TENANT;
    if (!tenantId || (!isDemo && (!clientId || !clientSecret))) {
      return NextResponse.json({ error: "tenantId, clientId and clientSecret are required" }, { status: 400 });
    }

    // Demo tenant: built-in simulated fleet — no Graph calls at all.
    const token = isDemo ? "" : await getGraphToken(tenantId, clientId!, clientSecret!);

    const select = [
      "id", "deviceName", "serialNumber", "manufacturer", "model",
      "operatingSystem", "osVersion", "userPrincipalName", "userDisplayName",
      "emailAddress", "complianceState", "managedDeviceOwnerType",
      "enrolledDateTime", "lastSyncDateTime", "totalStorageSpaceInBytes",
      "freeStorageSpaceInBytes", "wiFiMacAddress", "ethernetMacAddress",
      "azureADDeviceId",
    ].join(",");
    const devices: GraphDevice[] = isDemo
      ? (maxDevices > 0 ? DEMO_DEVICES.slice(0, maxDevices) : DEMO_DEVICES).map((d) => d.device)
      : ((await graphGetAll(
          `${GRAPH}/deviceManagement/managedDevices?$select=${select}&$top=1000`,
          token,
          maxDevices
        )) as GraphDevice[]);

    // Knowledge layer: active signatures + the catalog rows they point at.
    let compiled: CompiledSignature[] = [];
    const catalogById = new Map<string, CatalogRow>();
    const admin = createAdminClient();
    if (includeSoftware) {
      const [sigRes, catRes] = await Promise.all([
        admin.from("software_signatures")
          .select("id, publisher, name_pattern, version_pattern, verdict, catalog_id")
          .eq("status", "active"),
        admin.from("software_catalog")
          .select("id, manufacturer, title, version, edition, licensable"),
      ]);
      compiled = compileSignatures((sigRes.data ?? []) as SignatureRow[]);
      for (const c of (catRes.data ?? []) as CatalogRow[]) catalogById.set(c.id, c);
    }

    const unknowns = new Map<string, UnknownApp>();

    // Fetch detected apps per device with a small worker pool (Graph rejects
    // $expand=detectedApps on the collection; only the single-device GET works).
    const appsByDevice = new Map<string, DetectedApp[]>();
    if (includeSoftware && isDemo) {
      for (const d of DEMO_DEVICES) appsByDevice.set(d.device.id, d.apps);
    } else if (includeSoftware) {
      const queue = [...devices];
      const workers = Array.from({ length: 4 }, async () => {
        for (;;) {
          const device = queue.shift();
          if (!device?.id) {
            if (device === undefined) return;
            continue;
          }
          const detail = await graphGet(
            `${GRAPH}/deviceManagement/managedDevices/${device.id}?$select=id&$expand=detectedApps($select=displayName,version,publisher)`,
            token
          );
          const apps = Array.isArray(detail.detectedApps) ? (detail.detectedApps as DetectedApp[]) : [];
          appsByDevice.set(device.id, apps);
        }
      });
      await Promise.all(workers);
    }

    const rows: Record<string, unknown>[] = devices.map((d) => {
      const row: Record<string, unknown> = {
        IntuneDeviceId:    d.id ?? null,
        DeviceName:        d.deviceName ?? null,
        SerialNumber:      d.serialNumber ?? null,
        Manufacturer:      d.manufacturer ?? null,
        Model:             d.model ?? null,
        OperatingSystem:   d.operatingSystem ?? null,
        OSVersion:         d.osVersion ?? null,
        UserPrincipalName: d.userPrincipalName ?? null,
        UserDisplayName:   d.userDisplayName ?? null,
        EmailAddress:      d.emailAddress ?? null,
        ComplianceState:   d.complianceState ?? null,
        OwnerType:         d.managedDeviceOwnerType ?? null,
        EnrolledDateTime:  d.enrolledDateTime ?? null,
        LastSyncDateTime:  d.lastSyncDateTime ?? null,
        TotalStorageGB:    bytesToGB(d.totalStorageSpaceInBytes),
        FreeStorageGB:     bytesToGB(d.freeStorageSpaceInBytes),
        WiFiMacAddress:    d.wiFiMacAddress ?? null,
        EthernetMacAddress: d.ethernetMacAddress ?? null,
        AzureADDeviceId:   d.azureADDeviceId ?? null,
      };
      if (!includeSoftware) return row;

      const apps = d.id ? appsByDevice.get(d.id) ?? [] : [];
      const appNames = apps.map((a) => a.displayName ?? "").filter(Boolean);
      // catalog product -> first-seen raw installed version (from a direct product match)
      const products = new Map<string, { cat: CatalogRow; rawVersion: string }>();

      for (const app of apps) {
        const name = (app.displayName ?? "").trim();
        if (!name) continue;
        const publisher = (app.publisher ?? "").trim();
        const version = (app.version ?? "").trim();
        const sig = matchSignature(compiled, publisher, name, version);

        if (sig) {
          if (sig.verdict === "noise" || !sig.catalog_id) continue;
          const cat = catalogById.get(sig.catalog_id);
          if (cat) {
            const existing = products.get(cat.id);
            if (!existing) products.set(cat.id, { cat, rawVersion: sig.verdict === "product" ? version : "" });
            else if (!existing.rawVersion && sig.verdict === "product") existing.rawVersion = version;
          }
          continue;
        }

        // Unmatched — collect for the research queue.
        const rawKey = `${norm(publisher)}||${norm(name)}`;
        let u = unknowns.get(rawKey);
        if (!u) {
          u = {
            publisher,
            name,
            sample_version: version,
            seen_count: 0,
            devices: new Set(),
            // Co-installed apps from the first device that surfaced this string —
            // fingerprint context for later AI research (components travel in packs).
            co_installed_sample: appNames.filter((n) => n !== name).slice(0, 10),
          };
          unknowns.set(rawKey, u);
        }
        u.seen_count++;
        if (d.id) u.devices.add(d.id);
      }

      const entries = [...products.values()];
      const licNames = entries.filter((e) => e.cat.licensable).map((e) => catalogFullName(e.cat)).sort();
      row.LicensableSoftware = licNames.join("; ");
      row.LicensableSoftwareCount = licNames.length;
      row.DetectedAppCount = apps.length;
      // Raw evidence + resolved products for the hydration step / audit.
      row._detected_apps = apps.map((a) => ({
        name: a.displayName ?? "",
        publisher: a.publisher ?? "",
        version: a.version ?? "",
      }));
      // All resolved products (free ones included) — Installed Software hydration.
      row._installed_products = entries.map((e) => ({
        manufacturer: e.cat.manufacturer,
        title: e.cat.title,
        version: e.cat.version,
        edition: e.cat.edition,
        full_name: catalogFullName(e.cat),
        licensable: e.cat.licensable,
        raw_version: e.rawVersion,
      }));
      // Licensable subset — software product CI creation + Licensable Software tab.
      row._licensable_products = entries.filter((e) => e.cat.licensable).map((e) => ({
        manufacturer: e.cat.manufacturer,
        title: e.cat.title,
        version: e.cat.version,
        edition: e.cat.edition,
        full_name: catalogFullName(e.cat),
        licensable: true,
        raw_version: e.rawVersion,
      }));
      return row;
    });

    // Record unmatched strings in the research queue (never fail the read over it).
    let queued = 0;
    if (includeSoftware && unknowns.size > 0) {
      const items = [...unknowns.entries()].map(([raw_key, u]) => ({
        raw_key,
        publisher: u.publisher,
        name: u.name,
        sample_version: u.sample_version,
        seen_count: u.seen_count,
        device_count: u.devices.size,
        customer_id: customerId ?? "",
        context: { co_installed_sample: u.co_installed_sample },
      }));
      const { error: bumpErr } = await admin.rpc("software_queue_bump", { items });
      if (bumpErr) console.error("[intune-proxy] queue bump failed:", bumpErr.message);
      else queued = items.length;
    }

    return NextResponse.json({
      rows,
      meta: {
        devices: devices.length,
        software_scanned: includeSoftware,
        demo: isDemo,
        unmatched_strings_queued: queued,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[intune-proxy] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
