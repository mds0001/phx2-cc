import { NextRequest, NextResponse } from "next/server";
import * as net from "net";

// ── Helpers ───────────────────────────────────────────────────
function result(success: boolean, message: string) {
  return NextResponse.json({ success, message });
}

function tcpTest(host: string, port: number): Promise<NextResponse> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(6000);

    socket.on("connect", () => {
      socket.destroy();
      resolve(result(true, `TCP connection to ${host}:${port} succeeded`));
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(result(false, `Timed out connecting to ${host}:${port}`));
    });
    socket.on("error", (err) => {
      resolve(result(false, `Connection refused on ${host}:${port} — ${err.message}`));
    });

    socket.connect(port, host);
  });
}

// ── Route handler ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const { type, config } = (await request.json()) as {
      type: string;
      config: Record<string, string>;
    };

    switch (type) {

      // ── File ─────────────────────────────────────────────────
      case "file": {
        const filePath = config.file_path;
        if (!filePath) return result(false, "No file configured");

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anonKey    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        const url = `${supabaseUrl}/storage/v1/object/task_files/${filePath}`;

        const res = await fetch(url, {
          method: "HEAD",
          headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey ?? "" },
          signal: AbortSignal.timeout(8000),
        });

        return res.ok
          ? result(true,  `File found: ${config.file_name || filePath.split("/").pop()}`)
          : result(false, `File not found in storage (HTTP ${res.status})`);
      }

      // ── Cloud ─────────────────────────────────────────────────
      case "cloud": {
        const { url } = config;
        if (!url) return result(false, "No URL configured");
        try {
          const res = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(8000),
          });
          return result(true, `Reachable — HTTP ${res.status} ${res.statusText}`);
        } catch (e) {
          return result(false, `Unreachable: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // ── SMTP ─────────────────────────────────────────────────
      case "smtp": {
        const { server, port } = config;
        if (!server) return result(false, "No server configured");
        return tcpTest(server, parseInt(port || "587", 10));
      }

      // ── ODBC ─────────────────────────────────────────────────
      case "odbc": {
        const { server_name, port } = config;
        if (!server_name) return result(false, "No server name configured");
        return tcpTest(server_name, parseInt(port || "1433", 10));
      }

      // ── Portal ───────────────────────────────────────────────
      case "portal": {
        const { url } = config;
        if (!url) return result(false, "No URL configured");
        try {
          const res = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(8000),
          });
          return result(true, `Reachable — HTTP ${res.status} ${res.statusText}`);
        } catch (e) {
          return result(false, `Unreachable: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // ── Ivanti ───────────────────────────────────────────────
      case "ivanti": {
        const { url, api_key, business_object, tenant_id } = config;
        if (!url)     return result(false, "No URL configured");
        if (!api_key) return result(false, "No API key configured");

        const obj      = business_object || "CI__Computers";
        const endpoint = `${url.replace(/\/$/, "")}/api/odata/businessobject/${obj}?$top=1`;

        const headers: Record<string, string> = {
          Authorization: `rest_api_key=${api_key}`,
          Accept: "application/json",
        };
        if (tenant_id) headers["X-Tenant-Id"] = tenant_id;

        try {
          const res = await fetch(endpoint, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10000),
          });

          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const count = Array.isArray(data?.value) ? data.value.length : "?";
            return result(true, `Connected — ${count} record(s) returned from ${obj}`);
          }

          const body = await res.text().catch(() => "");
          return result(false, `HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}`);
        } catch (e) {
          return result(false, `Unreachable: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      default:
        return result(false, `Unknown connection type: ${type}`);
    }
  } catch (e) {
    return result(false, `Server error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
