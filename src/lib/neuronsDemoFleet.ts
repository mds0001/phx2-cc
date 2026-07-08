import { DEMO_DEVICES } from "./intuneDemoFleet";

/**
 * Neurons-shaped demo inventory — served by /api/ivanti-neurons-proxy when the
 * connection's Auth URL (or Base URL) is the literal string "demo".
 *
 * Derives from the shared simulated fleet so Intune-demo and Neurons-demo
 * describe the SAME machines, but adds the usage metering Neurons discovery
 * reports (LastUsedDate / TimesLaunched / MinutesUsed) — that's what feeds
 * the Licensable Software tab's Last Used / Launch Count / Minutes Used
 * columns in ITAM.
 */

const LAST_USED_DATES = [
  "2026-07-06T14:22:00Z", "2026-07-07T09:05:00Z", "2026-06-28T16:41:00Z",
  "2026-07-01T11:18:00Z", "2026-05-19T08:53:00Z", "2026-07-05T19:30:00Z",
];

/** Deterministic pseudo-usage so demo runs are reproducible. */
function usageFor(deviceIdx: number, appName: string) {
  const seed = appName.split("").reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 9973, deviceIdx + 7);
  return {
    LastUsedDate: LAST_USED_DATES[seed % LAST_USED_DATES.length],
    TimesLaunched: (seed % 180) + 3,
    MinutesUsed: ((seed % 180) + 3) * ((seed % 23) + 4),
  };
}

export function neuronsDemoRows(): Record<string, unknown>[] {
  return DEMO_DEVICES.map((d, di) => ({
    DiscoveryId: d.device.id.replace("demo-", "nrn-"),
    DeviceName: d.device.deviceName,
    SerialNumber: d.device.serialNumber,
    Manufacturer: d.device.manufacturer,
    Model: d.device.model,
    OSName: d.device.operatingSystem,
    OSVersion: d.device.osVersion,
    LastLoggedOnUser: d.device.userPrincipalName,
    UserDisplayName: d.device.userDisplayName,
    LastCheckIn: d.device.lastSyncDateTime,
    ComplianceState: d.device.complianceState,
    Software: {
      MonitoredSoftware: d.apps.map((a) => ({
        Name: a.displayName,
        Publisher: a.publisher,
        Version: a.version,
        ...usageFor(di, a.displayName),
      })),
    },
  }));
}
