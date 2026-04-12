"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Check,
  User,
  Shield,
  Mail,
  Send,
  AlertCircle,
} from "lucide-react";
import type { Profile, UserRole } from "@/lib/types";

interface Props {
  user: Profile | null;
  isNew: boolean;
  currentUserId: string;
}

const ROLES: { value: UserRole; label: string; desc: string }[] = [
  {
    value: "administrator",
    label: "Administrator",
    desc: "Full access to all features including Back of House, User Management, and all scheduler functions.",
  },
  {
    value: "schedule_administrator",
    label: "Schedule Administrator",
    desc: "Access to Scheduler, Field Mappings, and Endpoint Connections. No access to Back of House.",
  },
];

export default function UserEditorClient({ user, isNew, currentUserId }: Props) {
  const router = useRouter();

  // Invite-mode fields
  const [email, setEmail] = useState(user?.email ?? "");
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [role, setRole] = useState<UserRole>(user?.role ?? "schedule_administrator");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMe = !isNew && user?.id === currentUserId;
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ") || (isNew ? "New User" : "User");

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      let res: Response;
      if (isNew) {
        if (!email.trim()) throw new Error("Email is required.");
        res = await fetch("/api/users/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            first_name: firstName.trim() || undefined,
            last_name: lastName.trim() || undefined,
            role,
          }),
        });
      } else {
        res = await fetch(`/api/users/${user!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            role,
          }),
        });
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");

      setSaved(true);
      setTimeout(() => {
        router.push("/users");
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/users")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Users
            </button>
            <span className="text-gray-700">|</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-semibold text-white">
              {isNew ? "Invite User" : `Edit ${fullName}`}
            </span>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg ${
              saved
                ? "bg-emerald-600 text-white shadow-emerald-600/20"
                : "bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white shadow-indigo-600/20"
            }`}
          >
            {saved ? (
              <><Check className="w-4 h-4" />{isNew ? "Invited!" : "Saved!"}</>
            ) : saving ? (
              <><Save className="w-4 h-4 animate-pulse" />{isNew ? "Sending…" : "Saving…"}</>
            ) : (
              <>{isNew ? <Send className="w-4 h-4" /> : <Save className="w-4 h-4" />}{isNew ? "Send Invite" : "Save Changes"}</>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-4 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Personal Info */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Personal Info</h3>
          </div>

          {/* Email (editable only for new users) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Mail className="w-3 h-3" />
              Email Address {isNew && <span className="text-red-400">*</span>}
            </label>
            {isNew ? (
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@company.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-600"
              />
            ) : (
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl">
                <span className="text-white text-sm">{user?.email ?? "—"}</span>
                <span className="text-xs text-gray-600 ml-auto">Cannot change email here</span>
              </div>
            )}
          </div>

          {/* Name row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-600"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-600"
              />
            </div>
          </div>
        </div>

        {/* Role */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Role & Permissions</h3>
            {isMe && (
              <span className="ml-auto text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                Editing your own role
              </span>
            )}
          </div>

          <div className="space-y-3">
            {ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRole(r.value)}
                className={`w-full text-left rounded-2xl border p-4 transition-all ${
                  role === r.value
                    ? "border-indigo-500/60 bg-indigo-500/10 ring-1 ring-indigo-500/30"
                    : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                    role === r.value ? "border-indigo-400" : "border-gray-600"
                  }`}>
                    {role === r.value && (
                      <div className="w-2 h-2 rounded-full bg-indigo-400" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{r.label}</p>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{r.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Permission matrix */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Access Summary</h3>
          <div className="space-y-2">
            {[
              { feature: "Scheduler",             admin: true,  sched: true  },
              { feature: "Field Mappings",         admin: true,  sched: true  },
              { feature: "Endpoint Connections",   admin: true,  sched: true  },
              { feature: "Back of House",          admin: true,  sched: false },
              { feature: "User Management",        admin: true,  sched: false },
            ].map((row) => {
              const hasAccess = role === "administrator" ? row.admin : row.sched;
              return (
                <div
                  key={row.feature}
                  className={`flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors ${
                    hasAccess ? "bg-emerald-500/5 border border-emerald-500/10" : "bg-gray-800/30 border border-gray-700/30"
                  }`}
                >
                  <span className={`text-sm ${hasAccess ? "text-white" : "text-gray-500"}`}>
                    {row.feature}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    hasAccess
                      ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                      : "text-gray-600 bg-gray-700/30 border border-gray-700/30"
                  }`}>
                    {hasAccess ? "✓ Allowed" : "✗ Denied"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {isNew && (
          <p className="text-xs text-gray-600 text-center pb-4">
            An invitation email will be sent to the provided address. The user will set their own password on first login.
          </p>
        )}
      </main>
    </div>
  );
}
