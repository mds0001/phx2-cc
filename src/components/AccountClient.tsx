"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff, Mail, User, CheckCircle2, AlertCircle } from "lucide-react";

interface Props {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  mfaEnabled: boolean;
}

export default function AccountClient({ email, firstName, lastName, mfaEnabled: initialMfa }: Props) {
  const [mfaEnabled, setMfaEnabled] = useState(initialMfa);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const displayName = [firstName, lastName].filter(Boolean).join(" ") || email;

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  async function toggleMfa() {
    setLoading(true);
    try {
      const endpoint = mfaEnabled ? "/api/auth/mfa/disable" : "/api/auth/mfa/enable";
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json() as { success?: boolean; error?: string; mfa_enabled?: boolean };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed");

      setMfaEnabled(data.mfa_enabled ?? !mfaEnabled);
      showToast(
        "success",
        data.mfa_enabled
          ? "Two-factor authentication enabled. You'll be asked for a code on next sign-in."
          : "Two-factor authentication disabled."
      );
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-white mb-1">Security</h1>
      <p className="text-slate-400 text-sm mb-8">Manage your account security settings.</p>

      {/* Profile summary */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 mb-6 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg, #00c8ff 0%, #7B61FF 100%)" }}>
          <User className="w-6 h-6 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold truncate">{displayName}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <p className="text-slate-400 text-sm truncate">{email}</p>
          </div>
        </div>
      </div>

      {/* 2FA toggle */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
              mfaEnabled ? "bg-emerald-500/20" : "bg-slate-700/60"
            }`}>
              {mfaEnabled
                ? <ShieldCheck className="w-5 h-5 text-emerald-400" />
                : <ShieldOff className="w-5 h-5 text-slate-400" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-white font-semibold text-sm">Two-Factor Authentication</p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  mfaEnabled
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-slate-700 text-slate-400"
                }`}>
                  {mfaEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="text-slate-400 text-sm mt-1 leading-relaxed">
                {mfaEnabled
                  ? "A 6-digit code will be emailed to you on each sign-in. Codes expire in 10 minutes."
                  : "Add an extra layer of security. After entering your password, you'll be asked for a one-time code sent to your email."}
              </p>
            </div>
          </div>

          {/* Toggle switch */}
          <button
            onClick={toggleMfa}
            disabled={loading}
            aria-label={mfaEnabled ? "Disable 2FA" : "Enable 2FA"}
            className={`relative shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50 ${
              mfaEnabled ? "bg-emerald-500" : "bg-slate-600"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
              mfaEnabled ? "translate-x-6" : "translate-x-0"
            }`} />
          </button>
        </div>

        {/* Inline info when enabled */}
        {mfaEnabled && (
          <div className="mt-4 pt-4 border-t border-slate-700/50">
            <p className="text-xs text-slate-500">
              To disable 2FA, toggle the switch above. You will no longer be required to enter a verification code when signing in.
            </p>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium z-50 transition-all ${
          toast.type === "success"
            ? "bg-emerald-950 border-emerald-700 text-emerald-300"
            : "bg-red-950 border-red-700 text-red-300"
        }`}>
          {toast.type === "success"
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
