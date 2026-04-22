"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  Save,
  Check,
  User,
  Shield,
  Mail,
  Send,
  AlertCircle,
  Upload,
  Trash2,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { Profile, UserRole } from "@/lib/types";

interface CustomerOption { id: string; name: string; company: string | null; }

interface Props {
  user: Profile | null;
  isNew: boolean;
  currentUserId: string;
  customers?: CustomerOption[];
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

function resolveAvatarUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const clean = raw.startsWith("/") ? raw.slice(1) : raw;
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${clean}`;
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
  {
    value: "basic",
    label: "Basic",
    desc: "Read-only access to Scheduler, Field Mappings, and Endpoint Connections. Cannot create, edit, or delete anything.",
  },
];

export default function UserEditorClient({ user, isNew, currentUserId, customers = [] }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState(user?.email ?? "");
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [role, setRole] = useState<UserRole>(user?.role ?? "schedule_administrator");
  const [scopedCustomerId, setScopedCustomerId] = useState<string | null>(user?.customer_id ?? null);

  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Avatar state (edit mode only)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    resolveAvatarUrl(user?.avatar_url)
  );
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarDeleting, setAvatarDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMe = !isNew && user?.id === currentUserId;
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ") || (isNew ? "New User" : "User");
  const initials = [user?.first_name?.[0], user?.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setAvatarUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id);
      setAvatarUrl(resolveAvatarUrl(publicUrl) + "?t=" + Date.now());
    } catch (err) {
      alert("Avatar upload failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleAvatarDelete() {
    if (!user || !avatarUrl) return;
    if (!confirm("Remove this user\'s avatar photo?")) return;
    setAvatarDeleting(true);
    try {
      // List and remove files under the user\'s avatar folder
      const { data: files } = await supabase.storage.from("avatars").list(user.id);
      if (files && files.length > 0) {
        const paths = files.map((f) => `${user.id}/${f.name}`);
        await supabase.storage.from("avatars").remove(paths);
      }
      await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id);
      setAvatarUrl(null);
    } catch (err) {
      alert("Failed to remove avatar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAvatarDeleting(false);
    }
  }

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
            customer_id: role === "schedule_administrator" ? (scopedCustomerId ?? null) : null,
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
            customer_id: role === "schedule_administrator" ? (scopedCustomerId ?? null) : null,
            ...(newPassword.trim() ? { password: newPassword.trim() } : {}),
          }),
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setSaved(true);
      setTimeout(() => { router.push("/boh/users"); router.refresh(); }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05)_0%,_transparent_50%)] pointer-events-none" />

      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/boh/users")}
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
              <><Save className="w-4 h-4 animate-pulse" />{isNew ? "Sending..." : "Saving..."}</>
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

        {/* Avatar — edit mode only */}
        {!isNew && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Upload className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Profile Photo</h3>
            </div>
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-full shrink-0 overflow-hidden border-2 border-gray-700 bg-indigo-600/20">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={fullName}
                    width={64}
                    height={64}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-indigo-300 font-bold text-lg">
                    {initials}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading || avatarDeleting}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm text-gray-300 font-medium transition-all disabled:opacity-50"
                >
                  {avatarUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {avatarUploading ? "Uploading..." : avatarUrl ? "Change Photo" : "Upload Photo"}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={handleAvatarDelete}
                    disabled={avatarUploading || avatarDeleting}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-red-500/20 border border-gray-700 hover:border-red-500/40 rounded-xl text-sm text-gray-400 hover:text-red-400 font-medium transition-all disabled:opacity-50"
                  >
                    {avatarDeleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    {avatarDeleting ? "Removing..." : "Remove Photo"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Personal Info */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Personal Info</h3>
          </div>

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
                <span className="text-white text-sm">{user?.email ?? "no email"}</span>
                <span className="text-xs text-gray-600 ml-auto">Cannot change email here</span>
              </div>
            )}
          </div>

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

        {/* Password — edit mode only */}
        {!isNew && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Set Password</h3>
              <span className="ml-auto text-xs text-gray-600">Leave blank to keep current password</span>
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 6 characters)"
                autoComplete="new-password"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-11 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Role */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Role &amp; Permissions</h3>
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
                    {role === r.value && <div className="w-2 h-2 rounded-full bg-indigo-400" />}
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
          {/* Customer scope for schedule_administrator */}
          {role === "schedule_administrator" && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Assigned Customer
              </label>
              <select
                value={scopedCustomerId ?? ""}
                onChange={(e) => setScopedCustomerId(e.target.value || null)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— Unassigned (no access) —</option>
                {customers.map((cu) => (
                  <option key={cu.id} value={cu.id}>
                    {cu.name}{cu.company ? ` — ${cu.company}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                Schedule Administrators can only see objects belonging to their assigned customer.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {[
              { feature: "Scheduler",           admin: "write", sched: "write", basic: "read"  },
              { feature: "Field Mappings",       admin: "write", sched: "write", basic: "read"  },
              { feature: "Endpoint Connections", admin: "write", sched: "write", basic: "read"  },
              { feature: "Back of House",        admin: "write", sched: "none",  basic: "none"  },
              { feature: "User Management",      admin: "write", sched: "none",  basic: "none"  },
            ].map((row) => {
              const access = role === "administrator" ? row.admin : role === "schedule_administrator" ? row.sched : row.basic;
              return (
                <div
                  key={row.feature}
                  className={`flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors ${
                    access === "write" ? "bg-emerald-500/5 border border-emerald-500/10"
                    : access === "read" ? "bg-blue-500/5 border border-blue-500/10"
                    : "bg-gray-800/30 border border-gray-700/30"
                  }`}
                >
                  <span className={`text-sm ${access !== "none" ? "text-white" : "text-gray-500"}`}>{row.feature}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    access === "write"
                      ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                      : access === "read"
                      ? "text-blue-400 bg-blue-500/10 border border-blue-500/20"
                      : "text-gray-600 bg-gray-700/30 border border-gray-700/30"
                  }`}>
                    {access === "write" ? "Read + Write" : access === "read" ? "Read Only" : "No Access"}
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
