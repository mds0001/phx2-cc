import crypto from "crypto";

const PROXY_URL = process.env.MERCURY_PROXY_URL; // e.g. https://mercury-proxy.fly.dev
const PROXY_SECRET = process.env.MERCURY_PROXY_SECRET;
const API_KEY = process.env.MERCURY_API_KEY; // local-dev fallback: call Mercury directly

async function sign(path: string): Promise<Record<string, string>> {
  const pathOnly = path.split("?")[0]; // strip query string - proxy verifies pathname only
  const ts = Date.now().toString();
  const sig = crypto
    .createHmac("sha256", PROXY_SECRET!)
    .update(`${ts}:${pathOnly}`)
    .digest("hex");
  return { "x-proxy-ts": ts, "x-proxy-sig": sig };
}

export async function mercuryFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  if (PROXY_URL && PROXY_SECRET) {
    const proxyPath = `/mercury${path}`;
    const headers = await sign(proxyPath);
    return fetch(`${PROXY_URL}${proxyPath}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    });
  }
  if (API_KEY) {
    // No proxy configured (local dev) — hit the Mercury API directly.
    // The token must allow the caller's IP.
    return fetch(`https://api.mercury.com/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
    });
  }
  throw new Error("Mercury not configured: set MERCURY_PROXY_URL + MERCURY_PROXY_SECRET, or MERCURY_API_KEY");
}
