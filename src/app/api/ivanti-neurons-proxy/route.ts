import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { neuronsDemoRows } from "@/lib/neuronsDemoFleet";
import {
  loadKnowledge, resolveDeviceApps, attachSoftwareFields, UnknownCollector,
  type Knowledge, type RawApp,
} from "@/lib/softwareNormalization";

export const maxDuration = 300;

// ── Token cache (in-process, per serverless instance) ─────────
interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}
const tokenCache = new Map<string, TokenCache>();

async function getToken(authUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const cacheKey = `${authUrl}::${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(authUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
    signal:  AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token request failed — HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("No access_token in token response");

  const expiresIn = data.expires_in ?? 3600;
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 });
  return data.access_token;
}

/** Ivanti Neurons Data Services auth (documented flow): GET
 *  {landscape}/api/apigatewaydataservices/v1/token with X-ClientId /
 *  X-ClientSecret / X-TenantId headers. Both values are derivable from the
 *  OIDC connect/token URL users copy from their App Registration:
 *  https://{landscape}/{tenantId}/connect/token */
async function tryDataServicesAuth(
  authUrl: string,
  clientId: string,
  clientSecret: string
): Promise<{ token: string; apiBase: string } | null> {
  try {
    const u = new URL(authUrl);
    const tenantId = u.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!tenantId) return null;
    const apiBase = `${u.origin}/api/apigatewaydataservices/v1`;
    const res = await fetch(`${apiBase}/token`, {
      headers: {
        "X-ClientId": clientId,
        "X-ClientSecret": clientSecret,
        "X-TenantId": tenantId,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const raw = (await res.text()).trim().replace(/^"|"$/g, "");
    if (!raw || raw.startsWith("<")) return null;
    // Some landscapes return the raw token, others JSON { access_token }.
    if (raw.startsWith("{")) {
      const j = JSON.parse(raw) as { access_token?: string };
      return j.access_token ? { token: j.access_token, apiBase } : null;
    }
    return { token: raw, apiBase };
  } catch {
    return null;
  }
}

/** Flatten the useful identity fields of a Neurons device document so mapping
 *  profiles can reference flat names (SerialNumber, Manufacturer, OSName, ...). */
function flattenNeuronsDevice(row: Record<string, unknown>): Record<string, unknown> {
  const sys = (row.System ?? {}) as Record<string, unknown>;
  const bios = (row.BIOS ?? {}) as Record<string, unknown>;
  const os = (row.OS ?? {}) as Record<string, unknown>;
  const net = (row.Network ?? {}) as Record<string, unknown>;
  const tcpip = (net.TCPIP ?? {}) as Record<string, unknown>;
  return {
    ...row,
    SerialNumber: row.SerialNumber ?? sys.SerialNumber ?? bios.SerialNumber ?? null,
    Manufacturer: row.Manufacturer ?? sys.ManufacturerName ?? null,
    Model: row.Model ?? sys.Model ?? null,
    ChassisType: row.ChassisType ?? sys.ChassisType ?? null,
    OSName: row.OSName ?? os.Name ?? null,
    OSVersion: row.OSVersion ?? os.Version ?? null,
    IPAddress: row.IPAddress ?? tcpip.Address ?? null,
    MACAddress: row.MACAddress ?? net.NICAddress ?? null,
  };
}

const isDemoValue = (v: unknown): boolean =>
  typeof v === "string" && v.trim().toLowerCase() === "demo";

// ── Software extraction ────────────────────────────────────────
// A Neurons device document carries up to three software collections; the
// console's views are built from them, so we mine the union:
//   Software.AddorRemovePrograms.Program — ARP entries (name/publisher/version)
//   Software.Product                     — MSI product registrations
//   Software.Package                     — executable scan ("Installed
//                                          Applications" view; has LastStarted)
// Entries are deduped per device by normalized name (ARP identity wins).
function toRawApp(r: Record<string, unknown>): RawApp {
  const launches = Number(r.TimesLaunched ?? r.LaunchCount ?? NaN);
  const minutes  = Number(r.MinutesUsed ?? r.UsageMinutes ?? NaN);
  const lastUsedRaw = r.LastUsedDate ?? r.LastUsed ?? r.LastStarted;
  return {
    name: String(r.TitleWithoutVersion ?? r.Name ?? r.DisplayName ?? r.ProductName ?? r.Title ?? "").trim(),
    publisher: String(r.Publisher ?? r.Vendor ?? r.ManufacturerName ?? r.Manufacturer ?? "").trim(),
    version: String(r.Version ?? r.DisplayVersion ?? "").trim(),
    lastUsed: typeof lastUsedRaw === "string" && lastUsedRaw ? lastUsedRaw : null,
    launchCount: Number.isFinite(launches) ? launches : null,
    minutesUsed: Number.isFinite(minutes) ? minutes : null,
  };
}

const NEURONS_SOFTWARE_PATHS: string[][] = [
  ["Software", "AddorRemovePrograms", "Program"],
  ["Software", "Product"],
  ["Software", "Package"],
  // Older / other agent layouts
  ["Software", "MonitoredSoftware"],
  ["Software", "InstalledSoftware"],
  ["MonitoredSoftware"],
  ["InstalledSoftware"],
  ["SoftwareInfo"],
  ["DiscoveredApps"],
];

function extractNeuronsApps(device: Record<string, unknown>): RawApp[] {
  const byName = new Map<string, RawApp>();
  for (const path of NEURONS_SOFTWARE_PATHS) {
    let cur: unknown = device;
    for (const seg of path) cur = (cur as Record<string, unknown> | null | undefined)?.[seg];
    if (!Array.isArray(cur) || cur.length === 0) continue;
    for (const raw of cur as Record<string, unknown>[]) {
      const app = toRawApp(raw);
      if (!app.name) continue;
      const key = app.name.toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, app);
      } else {
        // Merge: earlier (more authoritative) identity wins, later sources
        // fill gaps — e.g. Package contributes LastStarted usage to an ARP entry.
        if (!existing.publisher && app.publisher) existing.publisher = app.publisher;
        if (!existing.version && app.version) existing.version = app.version;
        if (existing.lastUsed == null && app.lastUsed != null) existing.lastUsed = app.lastUsed;
        if (existing.launchCount == null && app.launchCount != null) existing.launchCount = app.launchCount;
        if (existing.minutesUsed == null && app.minutesUsed != null) existing.minutesUsed = app.minutesUsed;
      }
    }
  }
  return [...byName.values()];
}

function deviceIdOf(device: Record<string, unknown>, idx: number): string {
  return String(
    device.DiscoveryId ?? device.DeviceId ?? device.Id ?? device.id ??
    device.DeviceName ?? device.SerialNumber ?? `row-${idx}`
  );
}

// ── PUT: fetch all records (paginated via @odata.nextLink) ─────
// Body: { authUrl, clientId, clientSecret, baseUrl, dataset, top?, skip?,
//         includeSoftware?, customerId? }
// Returns: { rows: [...], count: N }
// With includeSoftware (devices dataset), each row also carries the standard
// software fields (_installed_products / _licensable_products /
// LicensableSoftware / _detected_apps) via the shared normalization engine,
// and unmatched strings land in software_research_queue.
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as {
      authUrl: string;
      clientId: string;
      clientSecret: string;
      baseUrl: string;
      dataset?: string;
      top?: number;
      skip?: number;
      includeSoftware?: boolean;
      customerId?: string | null;
    };

    const { authUrl, clientId, clientSecret, baseUrl, dataset = "devices", top, skip, customerId } = body;
    const includeSoftware = body.includeSoftware === true && dataset === "devices";
    const isDemo = isDemoValue(authUrl) || isDemoValue(baseUrl);

    if (!isDemo && (!authUrl || !clientId || !clientSecret || !baseUrl)) {
      return NextResponse.json({ error: "Missing required fields: authUrl, clientId, clientSecret, baseUrl" }, { status: 400 });
    }

    let allRows: Record<string, unknown>[] = [];
    let pageCount = 0;
    let diagnosticUrl = "demo://neurons";

    if (isDemo) {
      // Demo tenant: built-in simulated fleet (Neurons-shaped, with usage metering).
      allRows = neuronsDemoRows();
      if (top && top > 0) allRows = allRows.slice(0, top);
      pageCount = 1;
    } else {
      // Preferred: documented Data Services auth on the landscape host — the
      // OIDC connect/token bearer is rejected (401) by the data services
      // gateway. Falls back to the legacy flow when the pattern doesn't match.
      const ds = await tryDataServicesAuth(authUrl, clientId, clientSecret);
      const token = ds ? ds.token : await getToken(authUrl, clientId, clientSecret);

      const params = new URLSearchParams();
      if (top)  params.set("$top",  String(top));
      if (skip) params.set("$skip", String(skip));
      // Default projections are slim summaries — select the sections mapping
      // profiles and software normalization actually need (devices only).
      if (dataset === "devices") {
        params.set("$select", "DeviceName,DisplayName,DiscoveryId,System,BIOS,OS,Network" + (includeSoftware ? ",Software" : ""));
      }
      const qs = params.toString();

      // Landscape base from the DS auth, else normalise the configured base URL.
      const apiBase = baseUrl.replace(/\/$/, "");
      const API_PATH = "/api/apigatewaydataservices/v1";
      const normalised = ds ? ds.apiBase : (apiBase.includes(API_PATH) ? apiBase : apiBase + API_PATH);
      const firstUrl = `${normalised}/${dataset}` + (qs ? `?${qs}` : "");

      console.log("[ivanti-neurons-proxy] PUT fetching:", firstUrl);
      diagnosticUrl = firstUrl;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };

      let nextUrl: string | null = firstUrl;

      while (nextUrl) {
        const res = await fetch(nextUrl, { method: "GET", headers, signal: AbortSignal.timeout(30_000) });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          return NextResponse.json(
            { error: `Neurons API returned ${res.status}: ${errBody.slice(0, 300)}` },
            { status: res.status }
          );
        }

        const invCt = res.headers.get("content-type") ?? "";
        if (!invCt.includes("application/json")) {
          const raw = await res.text().catch(() => "");
          return NextResponse.json(
            { error: `Neurons ${dataset} endpoint non-JSON (${invCt || "no content-type"}) at [${nextUrl}] response: ${raw.slice(0, 150)}` },
            { status: 502 }
          );
        }
        const json = await res.json() as { value?: unknown[]; "@odata.nextLink"?: string };
        const rows: Record<string, unknown>[] = Array.isArray(json.value)
          ? (json.value as Record<string, unknown>[])
          : [];

        allRows.push(...rows);
        pageCount++;

        // Neurons uses @odata.nextLink with a $scrollID — honour it
        nextUrl = json["@odata.nextLink"] ?? null;
        if (pageCount >= 500) break; // safety cap
      }
    }

    if (dataset === "devices") {
      allRows = allRows.map(flattenNeuronsDevice);
    }

    // ── Software normalization (shared engine) ─────────────────
    let queued = 0;
    if (includeSoftware) {
      const admin = createAdminClient();
      const knowledge: Knowledge = await loadKnowledge(admin);
      const unknowns = new UnknownCollector();

      allRows = allRows.map((row, idx) => {
        const rawApps = extractNeuronsApps(row);
        const out = { ...row };
        const resolved = resolveDeviceApps(rawApps, knowledge, unknowns, deviceIdOf(row, idx));
        attachSoftwareFields(out, resolved, rawApps.length);
        out._detected_apps = rawApps;
        return out;
      });

      queued = await unknowns.bump(admin, customerId ?? null);
    }

    console.log(`[ivanti-neurons-proxy] Fetched ${allRows.length} record(s) across ${pageCount} page(s) from ${dataset}${includeSoftware ? `, ${queued} unmatched string(s) queued` : ""}`);
    return NextResponse.json({
      rows: allRows,
      count: allRows.length,
      _url: diagnosticUrl,
      meta: { demo: isDemo, software_scanned: includeSoftware, unmatched_strings_queued: queued },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    console.error("[ivanti-neurons-proxy] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── POST: write a single record to the Neurons dataset ─────────
// Body: { authUrl, clientId, clientSecret, baseUrl, dataset, data }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      authUrl: string;
      clientId: string;
      clientSecret: string;
      baseUrl: string;
      dataset?: string;
      data: Record<string, unknown>;
    };

    const { authUrl, clientId, clientSecret, baseUrl, dataset = "devices", data } = body;

    if (!authUrl || !clientId || !clientSecret || !baseUrl || !data) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const token = await getToken(authUrl, clientId, clientSecret);
    const endpoint = `${baseUrl.replace(/\/$/, "")}/${dataset}`;

    console.log("[ivanti-neurons-proxy] POST to:", endpoint);

    const res = await fetch(endpoint, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body:   JSON.stringify(data),
      signal: AbortSignal.timeout(15_000),
    });

    const ct = res.headers.get("content-type") ?? "";
    const responseBody = ct.includes("application/json") ? await res.json() : await res.text();

    console.log("[ivanti-neurons-proxy] POST response:", res.status);
    return NextResponse.json(
      { status: res.status, statusText: res.statusText, body: responseBody },
      { status: res.ok ? 200 : res.status }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    console.error("[ivanti-neurons-proxy] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
