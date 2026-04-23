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
    const { type, config, agent_id } = (await request.json()) as {
      type: string;
      config: Record<string, string>;
      agent_id?: string | null;
    };

    switch (type) {

      // ── File ─────────────────────────────────────────────────
      case "file": {
        const filePath = config.file_path;
        if (!filePath) return result(false, "No file configured");

        // Local (agent) mode -- verify the bound agent is online
        if (config.file_mode === "local") {
          const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
          if (!agent_id) return result(false, "No agent assigned to this endpoint");
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
          const agentRes = await fetch(
            `${supabaseUrl}/rest/v1/agents?id=eq.${agent_id}&select=name,status,last_seen`,
            { headers: { apikey: serviceKey ?? "", Authorization: `Bearer ${serviceKey}`, Accept: "application/json" } }
          );
          const [agent] = await agentRes.json().catch(() => []);
          if (!agent) return result(false, "Agent not found");
          const lastSeen = agent.last_seen ? new Date(agent.last_seen).getTime() : 0;
          const stale = Date.now() - lastSeen > 60_000; // offline if no heartbeat in 60s
          if (agent.status !== "online" || stale) {
            const ago = lastSeen ? `last seen ${Math.round((Date.now() - lastSeen) / 1000)}s ago` : "never seen";
            return result(false, `Agent "${agent.name}" is offline (${ago})`);
          }
          return result(true, `Agent "${agent.name}" is online -- will read ${fileName} at runtime`);
        }

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
        const { url, api_key, business_object, tenant_id, login_username, login_password } = config;
        if (!url)     return result(false, "No URL configured");
        if (!api_key) return result(false, "No API key configured");

        const base = url.replace(/\/$/, "");
        const obj  = business_object || "CI__Computers";
        const odataEndpoint = `${base}/api/odata/businessobject/${obj}?$top=1`;

        const headers: Record<string, string> = {
          Authorization: `rest_api_key=${api_key}`,
          Accept: "application/json",
        };
        if (tenant_id) headers["X-Tenant-Id"] = tenant_id;

        // Step 1: verify REST API key via OData
        let apiMessage = "";
        try {
          const res = await fetch(odataEndpoint, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10000),
          });

          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const count = Array.isArray(data?.value) ? data.value.length : "?";
            apiMessage = `API key OK — ${count} record(s) from ${obj}`;
          } else {
            const body = await res.text().catch(() => "");
            return result(false, `API key check failed — HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}`);
          }
        } catch (e) {
          return result(false, `Unreachable: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Step 2: if web UI credentials are configured, verify them via form login.
        // Ivanti SaaS (saasit.com) uses ASP.NET WebForms at Default.aspx.
        if (login_username && login_password) {
          try {
            // Use the known SaaS login URL directly; fall back to root for on-prem.
            const logonUrl = `${base}/Default.aspx?NoDefaultProvider=True`;

            // Collect cookies across requests (merge by name).
            const cookies: string[] = [];
            const captureCookies = (h: string | null) => {
              if (!h) return;
              for (const pair of h.split(/,(?=[^;]+=[^;]+)/)) {
                const nv = pair.split(";")[0].trim();
                if (!nv) continue;
                const name = nv.split("=")[0];
                const idx = cookies.findIndex(c => c.split("=")[0] === name);
                if (idx >= 0) cookies[idx] = nv; else cookies.push(nv);
              }
            };

            // GET login page — extract ASP.NET WebForms hidden fields and input names.
            const pageRes = await fetch(logonUrl, {
              method: "GET",
              headers: { Accept: "text/html,application/xhtml+xml,*/*", "User-Agent": "Mozilla/5.0" },
              redirect: "follow",
              signal: AbortSignal.timeout(8000),
            });
            captureCookies(pageRes.headers.get("set-cookie"));
            const html = await pageRes.text().catch(() => "");

            // ASP.NET WebForms hidden fields.
            const viewState          = (html.match(/(?:id|name)="__VIEWSTATE"[^>]+value="([^"]*)"/)          ?? html.match(/value="([^"]*)"[^>]*(?:id|name)="__VIEWSTATE"/))?.[1]          ?? "";
            const eventValidation    = (html.match(/(?:id|name)="__EVENTVALIDATION"[^>]+value="([^"]*)"/)    ?? html.match(/value="([^"]*)"[^>]*(?:id|name)="__EVENTVALIDATION"/))?.[1]    ?? "";
            const viewStateGenerator = (html.match(/(?:id|name)="__VIEWSTATEGENERATOR"[^>]+value="([^"]*)"/) ?? html.match(/value="([^"]*)"[^>]*(?:id|name)="__VIEWSTATEGENERATOR"/))?.[1] ?? "";

            // Dynamically find username / password / submit field names.
            const userField = (html.match(/<input[^>]+type=["']?text["']?[^>]+name="([^"]+)"/i)      ?? html.match(/<input[^>]+name="([^"]+)"[^>]+type=["']?text["']?/i))?.[1]     ?? "UserName";
            const passField = (html.match(/<input[^>]+type=["']?password["']?[^>]+name="([^"]+)"/i)  ?? html.match(/<input[^>]+name="([^"]+)"[^>]+type=["']?password["']?/i))?.[1] ?? "Password";
            const btnField  = (html.match(/<input[^>]+type=["']?submit["']?[^>]+name="([^"]+)"/i)    ?? html.match(/<input[^>]+name="([^"]+)"[^>]+type=["']?submit["']?/i))?.[1];
            const btnValue  = btnField ? ((html.match(new RegExp(`name="${btnField}"[^>]+value="([^"]+)"`)) ?? html.match(new RegExp(`value="([^"]+)"[^>]*name="${btnField}"`)  ))?.[1] ?? "Login") : undefined;

            // Build form POST body.
            const loginParams = new URLSearchParams();
            if (viewState)          loginParams.set("__VIEWSTATE",          viewState);
            if (eventValidation)    loginParams.set("__EVENTVALIDATION",    eventValidation);
            if (viewStateGenerator) loginParams.set("__VIEWSTATEGENERATOR", viewStateGenerator);
            loginParams.set(userField, login_username);
            loginParams.set(passField, login_password);
            if (btnField && btnValue) loginParams.set(btnField, btnValue);
            if (tenant_id) loginParams.set("TenantId", tenant_id);

            const loginRes = await fetch(logonUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0",
                Accept: "text/html,application/xhtml+xml,*/*",
                ...(cookies.length > 0 ? { Cookie: cookies.join("; ") } : {}),
              },
              body: loginParams.toString(),
              redirect: "manual",
              signal: AbortSignal.timeout(10000),
            });
            captureCookies(loginRes.headers.get("set-cookie"));

            const location = loginRes.headers.get("location") ?? "";
            const hasSid   = cookies.some(c => c.startsWith("SID="));

            // Success: redirect after POST (login accepted) or SID cookie returned.
            if (loginRes.status === 302 || loginRes.status === 301) {
              if (hasSid) {
                return result(true, `${apiMessage}; web login OK — SID cookie received, redirect to ${location || "(app)"}`);
              }
              // Redirect without SID — may be SSO handoff; flag as partial.
              return result(false, `${apiMessage}; web login redirected (HTTP ${loginRes.status}) but no SID cookie — instance may use SSO/SAML. Location: ${location || "(none)"}`);
            }
            if (hasSid) {
              return result(true, `${apiMessage}; web login OK — SID cookie received (HTTP ${loginRes.status})`);
            }
            // HTTP 200 = login page returned again = wrong credentials.
            if (loginRes.status === 200) {
              const hasViewStateInReply = (await loginRes.text().catch(() => "")).includes("__VIEWSTATE");
              return result(false, `${apiMessage}; web login failed — credentials rejected${hasViewStateInReply ? " (login form returned again)" : ""}. Login URL: ${logonUrl}, user field: ${userField}, __VIEWSTATE found: ${!!viewState}`);
            }
            const loginSetCookie = loginRes.headers.get("set-cookie") ?? "";
            return result(false, `${apiMessage}; web login failed — HTTP ${loginRes.status} from ${logonUrl}. Set-Cookie: ${loginSetCookie.slice(0, 80) || "(none)"}`);
          } catch (e) {
            return result(false, `${apiMessage}; web login error — ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        return result(true, apiMessage);
      }

      // ── Dell Premier ─────────────────────────────────────────
      case "dell": {
        const { base_url, client_id, client_secret, forwarded_client_id, scope } = config;
        if (!base_url)    return result(false, "No Base URL configured");
        if (!client_id)   return result(false, "No Client ID configured");
        if (!client_secret) return result(false, "No Client Secret configured");

        const tokenUrl = `${base_url.replace(/\/$/, "")}/auth/oauth/v2/token`;
        const body = new URLSearchParams({
          grant_type:    "client_credentials",
          client_id,
          client_secret,
          scope: scope || "oob",
        });

        try {
          const res = await fetch(tokenUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              ...(forwarded_client_id ? { "X-FORWARDED-CLIENT-ID": forwarded_client_id } : {}),
            },
            body: body.toString(),
            signal: AbortSignal.timeout(10000),
          });

          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const tokenType = data.token_type ?? "Bearer";
            const expiresIn = data.expires_in ? ` (expires in ${data.expires_in}s)` : "";
            if (data.access_token) {
              return result(true, `OAuth token obtained — ${tokenType}${expiresIn}`);
            }
            return result(false, `HTTP ${res.status} but no access_token in response`);
          }

          const body2 = await res.text().catch(() => "");
          return result(false, `Token request failed — HTTP ${res.status}: ${body2.slice(0, 200) || res.statusText}`);
        } catch (e) {
          return result(false, `Unreachable: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // ── CDW ──────────────────────────────────────────────────
      case "cdw": {
        const { base_url, subscription_key } = config;
        if (!base_url)         return result(false, "No Base URL configured");
        if (!subscription_key) return result(false, "No Subscription Key configured");

        // Ping the CDW API Management portal root — a HEAD request is enough
        // to confirm the key is accepted and the gateway is reachable.
        const pingUrl = base_url.replace(/\/$/, "");
        try {
          const res = await fetch(pingUrl, {
            method: "GET",
            headers: {
              "Ocp-Apim-Subscription-Key": subscription_key,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(10_000),
          });

          // 200/201 = connected and authorised
          // 401/403 = gateway reached but key rejected
          // 404     = gateway reached, path unknown (still means connectivity works)
          if (res.status === 401 || res.status === 403) {
            return result(false, `Gateway reachable but subscription key rejected — HTTP ${res.status}`);
          }
          return result(true, `CDW gateway reachable — HTTP ${res.status}`);
        } catch (e) {
          return result(false, `Unreachable: ${e instanceof Error ? e.message : String(e)}`);
        }
      }


      // ── Ivanti Neurons Inventory API ─────────────────────────
      case "ivanti_neurons": {
        const { auth_url, client_id, client_secret, base_url, dataset } = config;
        if (!auth_url)      return result(false, "No Auth URL configured");
        if (!client_id)     return result(false, "No Client ID configured");
        if (!client_secret) return result(false, "No Client Secret configured");
        if (!base_url)      return result(false, "No Base URL configured");

        // Step 1: obtain token
        const tokenBody = new URLSearchParams({
          grant_type:    "client_credentials",
          client_id,
          client_secret,
        });

        let token: string;
        try {
          const tokenRes = await fetch(auth_url, {
            method:  "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body:    tokenBody.toString(),
            signal:  AbortSignal.timeout(12_000),
          });

          if (!tokenRes.ok) {
            const txt = await tokenRes.text().catch(() => "");
            return result(false, `Token request failed — HTTP ${tokenRes.status}: ${txt.slice(0, 200)}`);
          }

          const tokenData = await tokenRes.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
          if (!tokenData.access_token) return result(false, "Token endpoint responded but returned no access_token");
          token = tokenData.access_token;
        } catch (e) {
          return result(false, `Auth URL unreachable: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Step 2: hit the inventory endpoint ($top=1 to keep it cheap)
        const ds = dataset || "devices";
        const inventoryUrl = `${base_url.replace(/\/$/, "")}/${ds}?$top=1`;

        try {
          const invRes = await fetch(inventoryUrl, {
            method:  "GET",
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal:  AbortSignal.timeout(12_000),
          });

          if (invRes.ok) {
            const data = await invRes.json().catch(() => ({})) as { value?: unknown[]; "@odata.count"?: number };
            const count = data["@odata.count"] ?? (Array.isArray(data.value) ? data.value.length : "?");
            return result(true, `Connected — ${count} ${ds} record(s) found`);
          }

          const body2 = await invRes.text().catch(() => "");
          return result(false, `Inventory request failed — HTTP ${invRes.status}: ${body2.slice(0, 200)}`);
        } catch (e) {
          return result(false, `Base URL unreachable: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      default:
        return result(false, `Unknown connection type: ${type}`);
    }
  } catch (e) {
    return result(false, `Server error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
