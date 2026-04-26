"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { Eye, EyeOff, Zap, ShieldCheck } from "lucide-react";

type Mode = "login" | "signup" | "otp";

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // If middleware bounced here with ?mfa=required, jump straight to OTP step
  useEffect(() => {
    if (searchParams.get("mfa") === "required") {
      setMode("otp");
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;

        // Check if this user requires 2FA
        const mfaRes = await fetch("/api/auth/mfa/send", { method: "POST" });
        const mfaData = await mfaRes.json() as { mfa_required?: boolean; error?: string };

        if (mfaData.mfa_required) {
          setMode("otp");
          setMessage("A 6-digit verification code has been sent to your email.");
        } else {
          router.push("/scheduler");
          router.refresh();
        }

      } else if (mode === "otp") {
        if (!/^\d{6}$/.test(otp.trim())) {
          throw new Error("Please enter the 6-digit code from your email.");
        }
        const res = await fetch("/api/auth/mfa/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ otp: otp.trim() }),
        });
        const data = await res.json() as { success?: boolean; error?: string };
        if (!res.ok || !data.success) throw new Error(data.error ?? "Verification failed");

        router.push("/scheduler");
        router.refresh();

      } else {
        // signup
        const { error: signUpError } = await supabase.auth.signUp({
          email, password,
          options: { data: { first_name: firstName, last_name: lastName } },
        });
        if (signUpError) throw signUpError;
        fetch("/api/users/notify-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, first_name: firstName || undefined, last_name: lastName || undefined }),
        }).catch(() => {});
        setMessage("Account created! Check your email to confirm before signing in. An administrator will review your access.");
        setMode("login");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function resendOtp() {
    setError(null);
    setLoading(true);
    try {
      await fetch("/api/auth/mfa/send", { method: "POST" });
      setMessage("A new verification code has been sent.");
    } catch {
      setError("Could not resend code. Please try signing in again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4 overflow-hidden">
      {/* Background glows */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[radial-gradient(ellipse,rgba(0,245,255,0.07)_0%,transparent_70%)]" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-[radial-gradient(ellipse,rgba(123,97,255,0.08)_0%,transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0)_0%,rgba(15,23,42,0.8)_100%)]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo + wordmark */}
        <div className="text-center mb-8">
          <a href="https://www.cloudweavr.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg lg-glow-cyan hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg, #00F5FF 0%, #7B61FF 100%)" }}>
            {mode === "otp" ? <ShieldCheck className="w-8 h-8 text-white" strokeWidth={2.5} /> : <Zap className="w-8 h-8 text-white" strokeWidth={2.5} />}
          </a>
          <a href="https://www.cloudweavr.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
            <h1 className="text-3xl font-bold text-white tracking-tight lg-gradient-text">Threads by Cloud Weaver</h1>
          </a>
          <p className="text-slate-400 mt-1.5 text-sm">
            {mode === "otp" ? "Two-factor verification" : "Weaves your cloud data."}
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#1E2937] rounded-3xl border border-slate-700/60 p-8 shadow-2xl">

          {/* Tab switcher — hidden on OTP step */}
          {mode !== "otp" && (
            <div className="flex bg-slate-800/80 rounded-2xl p-1 mb-8">
              {(["login", "signup"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(null); setMessage(null); }}
                  className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all duration-200 ${
                    mode === m
                      ? "text-white shadow-md"
                      : "text-slate-400 hover:text-white"
                  }`}
                  style={mode === m ? { background: "linear-gradient(135deg, #00c8ff 0%, #7B61FF 100%)" } : {}}
                >
                  {m === "login" ? "Sign In" : "Sign Up"}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
          {message && (
            <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl">
              <p className="text-emerald-400 text-sm">{message}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* ── OTP step ─────────────────────────────────────── */}
            {mode === "otp" && (
              <>
                <p className="text-slate-400 text-sm text-center mb-2">
                  Enter the 6-digit code sent to your email address.
                </p>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Verification Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    required
                    placeholder="000000"
                    autoFocus
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 focus:border-transparent transition-all text-center text-2xl tracking-[0.4em] font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="w-full text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 shadow-lg mt-2 disabled:opacity-60 disabled:cursor-not-allowed lg-glow-cyan"
                  style={{ background: loading ? "#374151" : "linear-gradient(135deg, #00c8ff 0%, #7B61FF 100%)" }}
                >
                  {loading ? "Verifying…" : "Verify Code"}
                </button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={resendOtp}
                    disabled={loading}
                    className="text-slate-400 hover:text-slate-200 text-sm transition-colors"
                  >
                    Resend code
                  </button>
                  <span className="text-slate-600 mx-2">·</span>
                  <button
                    type="button"
                    onClick={() => { setMode("login"); setOtp(""); setError(null); setMessage(null); supabase.auth.signOut(); }}
                    className="text-slate-400 hover:text-slate-200 text-sm transition-colors"
                  >
                    Back to sign in
                  </button>
                </div>
              </>
            )}

            {/* ── Login / Signup fields ─────────────────────────── */}
            {mode !== "otp" && (
              <>
                {mode === "signup" && (
                  <div className="grid grid-cols-2 gap-4">
                    {[["First Name", firstName, setFirstName, "John"], ["Last Name", lastName, setLastName, "Doe"]].map(([label, val, setter, ph]) => (
                      <div key={label as string}>
                        <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">{label as string}</label>
                        <input
                          type="text" value={val as string}
                          onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                          required placeholder={ph as string}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 focus:border-transparent transition-all"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Email Address</label>
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    required placeholder="you@example.com"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required minLength={8} placeholder="········"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 focus:border-transparent transition-all pr-12"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit" disabled={loading}
                  className="w-full text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 shadow-lg mt-2 disabled:opacity-60 disabled:cursor-not-allowed lg-glow-cyan"
                  style={{ background: loading ? "#374151" : "linear-gradient(135deg, #00c8ff 0%, #7B61FF 100%)" }}
                >
                  {loading
                    ? (mode === "login" ? "Signing in…" : "Creating account…")
                    : (mode === "login" ? "Sign In" : "Create Account")}
                </button>
              </>
            )}
          </form>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          <a href="https://www.cloudweavr.com" target="_blank" rel="noopener noreferrer" className="hover:text-slate-400 transition-colors">Threads by Cloud Weaver</a> &copy; {new Date().getFullYear()} — Weaves your cloud data.
        </p>
      </div>
    </div>
  );
}

import { Suspense } from "react";
export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
