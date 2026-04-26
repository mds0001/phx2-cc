import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ── MFA cookie verification (Web Crypto API — Edge Runtime compatible) ───────

const MFA_COOKIE_NAME = "mfa_verified";

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function isValidMfaCookie(
  cookieValue: string | undefined,
  userId: string | undefined
): Promise<boolean> {
  if (!cookieValue || !userId) return false;

  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [uid, expStr, sig] = parts;

  if (uid !== userId) return false;
  const exp = parseInt(expStr, 10);
  if (isNaN(exp) || Date.now() > exp) return false;

  try {
    const secret = process.env.MFA_SECRET ?? "fallback-change-me";
    const key = await importHmacKey(secret);
    const message = new TextEncoder().encode(`${uid}.${expStr}`);
    const sigBytes = hexToUint8Array(sig);
    return crypto.subtle.verify("HMAC", key, sigBytes, message);
  } catch {
    return false;
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: object }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // ── Unauthenticated visitors ─────────────────────────────────────────────
  if (pathname === "/login") {
    if (user) {
      return NextResponse.redirect(new URL("/scheduler", request.url));
    }
    return supabaseResponse;
  }

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // ── MFA gate (for users with 2FA enabled) ────────────────────────────────
  const mfaEnabled = user.app_metadata?.mfa_enabled === true;

  if (mfaEnabled) {
    // These paths remain accessible while the MFA challenge is in progress
    const isMfaExempt =
      pathname === "/login" ||
      pathname.startsWith("/api/auth/mfa/") ||
      pathname.startsWith("/_next/") ||
      pathname === "/favicon.ico";

    if (!isMfaExempt) {
      const mfaCookie = request.cookies.get(MFA_COOKIE_NAME)?.value;
      const verified = await isValidMfaCookie(mfaCookie, user.id);

      if (!verified) {
        return NextResponse.redirect(new URL("/login?mfa=required", request.url));
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?\!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
