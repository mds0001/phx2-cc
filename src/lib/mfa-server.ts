/**
 * Server-only MFA utilities — do not import from client components.
 *
 * Uses Node.js crypto (not available in Edge Runtime).
 * The middleware uses Web Crypto API separately to verify the cookie.
 */
import { createHmac, createHash, randomInt } from "crypto";
import { createAdminClient } from "@/lib/supabase-admin";

// ── OTP generation & hashing ────────────────────────────────────────────────

/** Generate a 6-digit numeric OTP. */
export function generateOtp(): string {
  return String(randomInt(100_000, 999_999));
}

/** Hash an OTP with the user's ID as a salt (SHA-256). */
export function hashOtp(otp: string, userId: string): string {
  return createHash("sha256").update(`${userId}:${otp}`).digest("hex");
}

/** Constant-time comparison of two hex strings to prevent timing attacks. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Challenge management ─────────────────────────────────────────────────────

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Create a new MFA challenge for a user.
 * Returns the plaintext OTP (to be emailed) and the challenge ID.
 */
export async function createMfaChallenge(
  userId: string
): Promise<{ otp: string; challengeId: string }> {
  const otp = generateOtp();
  const otpHash = hashOtp(otp, userId);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mfa_challenges")
    .insert({ user_id: userId, otp_hash: otpHash, expires_at: expiresAt })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create MFA challenge: ${error?.message}`);
  }

  return { otp, challengeId: data.id as string };
}

/**
 * Verify an OTP against the most recent unused challenge for a user.
 * Returns true and marks the challenge as used on success.
 * Returns false on any failure (wrong OTP, expired, already used).
 */
export async function verifyMfaChallenge(
  userId: string,
  otp: string
): Promise<boolean> {
  const supabase = createAdminClient();

  // Get the most recent unexpired, unused challenge for this user
  const { data: challenges } = await supabase
    .from("mfa_challenges")
    .select("id, otp_hash, expires_at, used_at")
    .eq("user_id", userId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  const challenge = challenges?.[0];
  if (!challenge) return false;

  const expectedHash = hashOtp(otp, userId);
  const isValid = safeEqual(expectedHash, challenge.otp_hash);

  if (isValid) {
    // Mark as used
    await supabase
      .from("mfa_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("id", challenge.id);
  }

  return isValid;
}

// ── MFA verified cookie ──────────────────────────────────────────────────────

const MFA_COOKIE_NAME = "mfa_verified";
const MFA_COOKIE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours (matches typical session length)

/** Sign a value with HMAC-SHA256 using the MFA_SECRET env var. */
function signValue(value: string): string {
  const secret = process.env.MFA_SECRET ?? "fallback-change-me";
  return createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Build the value for the mfa_verified cookie.
 * Format: {userId}.{expiry_unix_ms}.{hmac}
 */
export function buildMfaCookieValue(userId: string): string {
  const exp = Date.now() + MFA_COOKIE_TTL_MS;
  const payload = `${userId}.${exp}`;
  const sig = signValue(payload);
  return `${payload}.${sig}`;
}

/**
 * Verify an mfa_verified cookie value (Node.js version for API routes).
 * Returns true if the cookie is valid and not expired.
 */
export function verifyMfaCookieNode(cookieValue: string, userId: string): boolean {
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [uid, expStr, sig] = parts;
  if (uid !== userId) return false;
  const exp = parseInt(expStr, 10);
  if (isNaN(exp) || Date.now() > exp) return false;
  const expected = signValue(`${uid}.${expStr}`);
  return safeEqual(expected, sig);
}

export { MFA_COOKIE_NAME, MFA_COOKIE_TTL_MS };

// ── Email sending ────────────────────────────────────────────────────────────

interface EmailOptions {
  to: string;
  otp: string;
  firstName?: string | null;
}

/**
 * Send the OTP email via Resend API or SMTP.
 * Mirrors the approach used in /api/users/notify-signup.
 */
export async function sendOtpEmail(opts: EmailOptions): Promise<void> {
  const { to, otp, firstName } = opts;

  // ── Dev shortcut: log OTP to console when no email service is configured ──
  if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
    console.log(`\n🔐 [MFA DEV] OTP for ${to}: ${otp}\n`);
    return;
  }
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const subject = "Your Threads verification code";
  const text = [
    greeting,
    "",
    `Your one-time verification code is: ${otp}`,
    "",
    "This code expires in 10 minutes. If you did not request this, you can ignore this email.",
    "",
    "— Threads by Cloud Weaver",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1e293b;background:#f8fafc;margin:0;padding:32px">
  <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:32px">
    <div style="font-size:20px;font-weight:700;color:#6366f1;margin-bottom:16px">Threads by Cloud Weaver</div>
    <p style="margin:0 0 12px;font-size:14px;color:#475569">${greeting}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#475569">Your one-time verification code is:</p>
    <div style="font-size:36px;font-weight:800;letter-spacing:0.15em;color:#0f172a;background:#f1f5f9;border-radius:8px;padding:16px 24px;text-align:center;margin-bottom:20px">
      ${otp}
    </div>
    <p style="margin:0;font-size:12px;color:#94a3b8">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>
  </div>
</body>
</html>`;

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Threads by Cloud Weaver <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      throw new Error(`Resend error ${res.status}: ${body}`);
    }
    return;
  }

  // Fall back to SMTP via nodemailer
  const { sendSmtpEmail } = await import("@/lib/smtp");
  const { createAdminClient: admin } = await import("@/lib/supabase-admin");
  const supabase = admin();
  const { data: smtpConnections } = await supabase
    .from("endpoint_connections")
    .select("config")
    .eq("type", "smtp")
    .limit(1);

  const smtpConfig = smtpConnections?.[0]?.config as {
    server?: string;
    port?: string;
    login_name?: string;
    password?: string;
    from_address?: string;
  } | null;

  if (!smtpConfig?.server) {
    throw new Error("No email service configured (set RESEND_API_KEY or add an SMTP connection)");
  }

  await sendSmtpEmail({
    server: smtpConfig.server,
    port: parseInt(smtpConfig.port ?? "587", 10),
    login_name: smtpConfig.login_name ?? "",
    password: smtpConfig.password ?? "",
    from: smtpConfig.from_address ?? smtpConfig.login_name ?? "noreply@cloudweavr.com",
    to: [to],
    subject,
    text,
    html,
  });
}
