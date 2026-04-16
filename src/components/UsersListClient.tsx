"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Plus,
  Search,
  Trash2,
  Edit2,
  Shield,
  CalendarClock,
  User,
} from "lucide-react";
import type { Profile, UserRole } from "@/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

function resolveAvatarUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const clean = raw.startsWith("/") ? raw.slice(1) : raw;
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${clean}`;
}

interface Props {
  users: Profile[];
  currentUserId: string;
}

const ROLE_META: Record<UserRole, { label: string; color: string; bg: string; border: string }> = {
  administrator: {
    label: "Administrator",
    color: "text-indigo-400",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/20",
  },
  schedule_administrator: {
    label: "Schedule Admin",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
  },
};

export default function UsersListClient({ users, currentUserId }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      !q ||
      u.first_name?.toLowerCase().includes(q) ||
      u.last_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      ROLE_META[u.role ?? "schedule_administrator"].label.toLowerCase().includes(q)
    );
  });

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove ${name} from the system? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
    }
  }

  const admins = filtered.filter((u) => u.role === "administrator");
  const schedAdmins = filtered.filter((u) => u.role === "schedule_administrator");

  function UserCard({ user }: { user: Profile }) {
    const meta = ROLE_META[user.role ?? "schedule_administrator"];
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "no name";
    const initials =
      [user.first_name?.[0], user.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "?";
    const isMe = user.id === currentUserId;
    const isDel = deleting === user.id;
    const avatarUrl = resolveAvatarUrl(user.avatar_url);

    return (
      <div className="relative bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-5 flex items-start gap-4 transition-all group">
        <div className="w-12 h-12 rounded-full shrink-0 overflow-hidden border-2 border-gray-700 bg-indigo-600/20">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={fullName}
              width={48}
              height={48}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-indigo-300 font-bold text-sm">
              {initials}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white">{fullName}</span>
            {isMe && (
              <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">You</span>
            )}
          </div>
          <p className="text-sm text-gray-400 truncate mt-0.5">{user.email ?? "no email"}</p>
          <div className="mt-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${meta.bg} ${meta.border} border ${meta.color}`}>
              <Shield className="w-3 h-3" />
              {meta.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => router.push(`/users/${user.id}`)}
            className="w-8 h-8 rounded-xl bg-gray-800 hover:bg-indigo-500/20 border border-gray-700 hover:border-indigo-500/40 flex items-center justify-center text-gray-400 hover:text-indigo-400 transition-all"
            title="Edit user"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          {!isMe && (
            <button
              onClick={() => handleDelete(user.id, fullName)}
              disabled={isDel}
              className="w-8 h-8 rounded-xl bg-gray-800 hover:bg-red-500/20 border border-gray-700 hover:border-red-500/40 flex items-center justify-center text-gray-400 hover:text-red-400 transition-all disabled:opacity-40"
              title="Remove user"
            >
              {isDel ? (
                <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05)_0%,_transparent_50%)] pointer-events-none" />

      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Dashboard
            </button>
            <span className="text-gray-700">|</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-semibold text-white">User Management</span>
          </div>

          <button
            onClick={() => router.push("/users/new")}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold text-white transition-all shadow-lg shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" />
            Invite User
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or role"
            className="w-full bg-gray-900 border border-gray-800 rounded-2xl pl-11 pr-4 py-3.5 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Total Users", value: users.length, icon: User, color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
            { label: "Administrators", value: users.filter(u => u.role === "administrator").length, icon: Shield, color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
            { label: "Schedule Admins", value: users.filter(u => u.role === "schedule_administrator").length, icon: CalendarClock, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className={`${s.bg} border ${s.border} rounded-2xl p-4`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${s.color}`}>{s.label}</span>
                  <Icon className={`w-4 h-4 ${s.color}`} />
                </div>
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            );
          })}
        </div>

        {admins.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              {"Administrators (" + admins.length + ")"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {admins.map((u) => <UserCard key={u.id} user={u} />)}
            </div>
          </section>
        )}

        {schedAdmins.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest flex items-center gap-2">
              <CalendarClock className="w-3.5 h-3.5 text-cyan-400" />
              {"Schedule Administrators (" + schedAdmins.length + ")"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {schedAdmins.map((u) => <UserCard key={u.id} user={u} />)}
            </div>
          </section>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-600">
            <User className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No users found</p>
            <p className="text-sm mt-1">{search ? "Try a different search term" : "Invite someone to get started"}</p>
          </div>
        )}
      </main>
    </div>
  );
}
