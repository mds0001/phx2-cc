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
  Plus,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { Profile, UserRole, UserRoleAssignment } from "@/lib/types";

interface CustomerOption { id: string; name: string; company: string | null; }

interface Props {
  user: Profile | null;
  isNew: boolean;
  currentUserId: string;
  customers?: CustomerOption[];
  userRoles?: UserRoleAssignment[];
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

function resolveAvatarUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const clean = raw.startsWith("/") ? raw.slice(1) : raw;
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${clean}`;
}

const ROLE_META: { value: UserRole; label: string; desc: string; needsCustomer: boolean }[] = [
  {
    value: "administrator",
    label: "Administrator",
    desc: "Full access to all features including Back of House, User Management, and all scheduler functions.",
    needsCustomer: false,
  },
  {
    value: "schedule_administrator",
    label: "Schedule Administrator",
    desc: "Access to Scheduler, Field Mappings, and Endpoint Connections for one customer. No Back of House.",
    needsCustomer: true,
  },
  {
    value: "basic",
    label: "Basic",
    desc: "Read-only access to Scheduler, Field Mappings, and Endpoint Connections.",
    needsCustomer: false,
  },
  {
    value: "schedule_auditor",
    label: "Schedule Auditor",
    desc: "Read-only Scheduler view + email notifications when tasks complete. Scoped to one customer.",
    needsCustomer: true,
  },
];

interface RoleDraft {
  role: UserRole;
  customer_id: string | null;
  is_primary: boolean;
}

function metaFor(r: UserRole) {
  return ROLE_META.find((m) => m.value === r)!;
}

export default function UserEditorClient({ user, isNew, currentUserId, customers = [], userRoles = [] }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState(user?.email ?? "");
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");

  const initialRoles: RoleDraft[] = userRoles.length > 0
    ? userRoles.map((r) => ({ role: r.role, customer_id: r.customer_id, is_primary: r.is_primary }))
    : [{ role: "schedule_administrator", customer_id: null, is_primary: true }];
  const [roles, setRoles] = useState<RoleDraft[]>(initialRoles);

  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    resolveAvatarUrl(user?.avatar_url)
  );
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarDeleting, setAvatarDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMe = !isNew && user?.id === currentUserId;
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ") || (isNew ? "New User" : "User");
  const initials = [user?.first_name?.[0], user?.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  function addRole() {
    setRoles((p) => [...p, { role: "schedule_administrator", customer_id: null, is_primary: p.length === 0 }]);
  }
  function removeRole(idx: number) {
    setRoles((p) => {
      const next = p.filter((_, i) => i !== idx);
      if (next.length > 0 && !next.some((r) => r.is_primary)) next[0].is_primary = true;
      return next;
    });
  }
  function updateRole(idx: number, patch: Partial<RoleDraft>) {
    setRoles((p) => p.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function setPrimary(idx: number) {
    setRoles((p) => p.map((r, i) => ({ ...r, is_primary: i === idx })));
  }

  function rolesValidationError(): string | null {
    if (roles.length === 0) return "Add at least one role.";
    for (const r of roles) {
      if (metaFor(r.role).needsCustomer && !r.customer_id) {
        return metaFor(r.role).label + " requires a customer assignment.";
      }
    }
    if (roles.filter((r) => r.is_primary).length !== 1) {
      return "Exactly one role must be marked primary.";
    }
    const seen = new Set<string>();
    for (const r of roles) {
      const key = r.role + "|" + (r.customer_id ?? "");
      if (seen.has(key)) return "Duplicate role assignment — same role and customer.";
      seen.add(key);
    }
    return null;
  }

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
    if (!confirm("Remove this user's avatar photo?")) return;
    setAvatarDeleting(true);
    try {
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
    const vErr = rolesValidationError();
    if (vErr) { setError(vErr); return; }
    setSaving(true);
    try {
      const rolesPayload = roles.map((r) => ({
        role: r.role,
        customer_id: metaFor(r.role).needsCustomer ? r.customer_id : null,
        is_primary: r.is_primary,
      }));
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
            roles: rolesPayload,
            ...(newPassword.trim() ? { password: newPassword.trim() } : {}),
          }),
        });
      } else {
        res = await fetch(`/api/users/${user!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            roles: rolesPayload,
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

  function highestAccess(roleSet: UserRole[]): { scheduler: string; mappings: string; connections: string; boh: string; users: string } {
    const isAdmin = roleSet.includes("administrator");
    const isSched = roleSet.includes("schedule_administrator");
    if (isAdmin) return { scheduler: "write", mappings: "write", connections: "write", boh: "write", users: "write" };
    if (isSched) return { scheduler: "write", mappings: "write", connections: "write", boh: "none", users: "none" };
    return { scheduler: "read", mappings: "read", connections: "read", boh: "none", users: "none" };
  }
  const access = highestAccess(roles.map((r) => r.role));

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
              <><Save className="w-4 h-4 animate-pulse" />{isNew ? (newPassword.trim() ? "Creating..." : "Sending...") : "Saving..."}</>
            ) : (
              <>{isNew ? <Send className="w-4 h-4" /> : <Save className="w-4 h-4" />}{isNew ? (newPassword.trim() ? "Create User" : "Send Invite") : "Save Changes"}</>
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

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Set Password</h3>
            <span className="ml-auto text-xs text-gray-600">
              {isNew ? "Leave blank to send an invite email instead" : "Leave blank to keep current password"}
            </span>
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

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Roles &amp; Permissions</h3>
            {isMe && (
              <span className="ml-auto text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                Editing your own roles
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Assign one or more roles. Mark one as Primary — that becomes their default on login. They can switch between roles in the left pane.
          </p>

          <div className="space-y-3">
            {roles.map((r, idx) => {
              const meta = metaFor(r.role);
              return (
                <div key={idx} className="border border-gray-700 bg-gray-800/40 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setPrimary(idx)}
                      title={r.is_primary ? "Primary role" : "Set as primary"}
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                        r.is_primary ? "border-indigo-400" : "border-gray-600"
                      }`}
                    >
                      {r.is_primary && <div className="w-2 h-2 rounded-full bg-indigo-400" />}
                    </button>
                    <select
                      value={r.role}
                      onChange={(e) => updateRole(idx, { role: e.target.value as UserRole, customer_id: null })}
                      className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {ROLE_META.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    {r.is_primary && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                        Primary
                      </span>
                    )}
                    {roles.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRole(idx)}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                        title="Remove this role"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 pl-7 leading-relaxed">{meta.desc}</p>
                  {meta.needsCustomer && (
                    <div className="pl-7">
                      <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Assigned Customer</label>
                      <select
                        value={r.customer_id ?? ""}
                        onChange={(e) => updateRole(idx, { customer_id: e.target.value || null })}
                        className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">— Select a customer —</option>
                        {customers.map((cu) => (
                          <option key={cu.id} value={cu.id}>
                            {cu.name}{cu.company ? ` — ${cu.company}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addRole}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-dashed border-gray-700 hover:border-indigo-500/40 rounded-2xl text-sm text-gray-400 hover:text-indigo-300 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add another role
          </button>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Combined Access</h3>
          <p className="text-xs text-gray-500 mb-4">
            With multiple roles, the user has the highest level of access granted by any one of them.
          </p>
          <div className="space-y-2">
            {[
              { feature: "Scheduler",            level: access.scheduler   },
              { feature: "Field Mappings",       level: access.mappings    },
              { feature: "Endpoint Connections", level: access.connections },
              { feature: "Back of House",        level: access.boh         },
              { feature: "User Management",      level: access.users       },
            ].map((row) => (
              <div
                key={row.feature}
                className={`flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors ${
                  row.level === "write" ? "bg-emerald-500/5 border border-emerald-500/10"
                  : row.level === "read" ? "bg-blue-500/5 border border-blue-500/10"
                  : "bg-gray-800/30 border border-gray-700/30"
                }`}
              >
                <span className={`text-sm ${row.level !== "none" ? "text-white" : "text-gray-500"}`}>{row.feature}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  row.level === "write"
                    ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                    : row.level === "read"
                    ? "text-blue-400 bg-blue-500/10 border border-blue-500/20"
                    : "text-gray-600 bg-gray-700/30 border border-gray-700/30"
                }`}>
                  {row.level === "write" ? "Read + Write" : row.level === "read" ? "Read Only" : "No Access"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {isNew && (
          <p className="text-xs text-gray-600 text-center pb-4">
            {newPassword.trim()
              ? "User will be created immediately with the password you set."
              : "No password set -- an invite email will be sent and the user will set their own password on first login."}
          </p>
        )}
      </main>
    </div>
  );
}