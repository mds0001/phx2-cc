import crypto from "crypto";

const PROXY_URL = process.env.MERCURY_PROXY_URL; // e.g. https://mercury-proxy.fly.dev
const PROXY_SECRET = process.env.MERCURY_PROXY_SECRET;

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
  if (!PROXY_URL || !PROXY_SECRET) {
    throw new Error("MERCURY_PROXY_URL or MERCURY_PROXY_SECRET not set");
  }
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
