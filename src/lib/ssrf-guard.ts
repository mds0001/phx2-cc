import * as dns from "dns/promises";

/**
 * Shared SSRF guard. Originally lived only in test-connection/route.ts (which
 * requires login before calling it); the destination proxies (ivanti-proxy,
 * dell-proxy, cdw-proxy, ...) take a URL from the request body and fetch it
 * server-side, so they need the same check even though the caller is
 * authenticated — an authenticated user still shouldn't be able to make the
 * server fetch/POST to internal hosts or cloud metadata endpoints.
 */

// Block loopback, link-local, RFC-1918, and APIPA ranges.
function isPrivateIp(ip: string): boolean {
  return (
    /^127\./.test(ip) ||
    /^::1$/.test(ip) ||
    /^10\./.test(ip) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^fc[0-9a-f]{2}:/i.test(ip) ||
    /^fd[0-9a-f]{2}:/i.test(ip)
  );
}

export async function isSsrfTarget(urlOrHost: string): Promise<boolean> {
  try {
    // If it looks like a URL, extract the hostname
    let host = urlOrHost;
    if (urlOrHost.startsWith("http://") || urlOrHost.startsWith("https://")) {
      host = new URL(urlOrHost).hostname;
    }
    // Block bare IP addresses directly
    if (isPrivateIp(host)) return true;
    // Resolve hostnames and block if any resolved IP is private
    const addrs = await dns.resolve(host).catch(() => [] as string[]);
    return addrs.some(isPrivateIp);
  } catch {
    return false;
  }
}

/** Convenience wrapper for a route handler: returns the value to short-circuit
 *  return (a 400 JSON body) when the URL is an SSRF target, or null when clear. */
export async function ssrfDenied(url: string | undefined | null, label = "URL"): Promise<{ error: string } | null> {
  if (!url) return null;
  if (await isSsrfTarget(url)) return { error: `${label} resolves to a private/internal address` };
  return null;
}
