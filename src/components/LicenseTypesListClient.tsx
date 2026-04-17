"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Key, Plus, Edit2, Trash2, Search,
  Users, Activity, RefreshCw, Zap, Tag, UserCog,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { LicenseType, LicenseTypeKind } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────

const KIND_META: Record<LicenseTypeKind, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  one_time:     { label: "One-Time",     color: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/25",     icon: <Zap className="w-3 h-3" /> },
  subscription: { label: "Subscription", color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/25", icon: <RefreshCw className="w-3 h-3" /> },
  by_endpoint:  { label: "By Endpoint",  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25", icon: <Activity className="w-3 h-3" /> },
};

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// ── Component ─────────────────────────────────────────────────

export default function LicenseTypesListClient({ licenseTypes: initial }: { licenseTypes: LicenseType[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [licenseTypes, setLicenseTypes] = useState(initial);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete license type "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    await supabase.from("license_types").delete().eq("id", id);
    setLicenseTypes((p) => p.filter((lt) => lt.id !== id));
    setDeleting(null);
  }

  const filtered = licenseTypes.filter((lt) => {
    const q = search.toLowerCase();
    return (
      lt.name.toLowerCase().includes(q) ||
      (lt.description ?? "").toLowerCase().includes(q) ||
      lt.type.toLowerCase().includes(q)
    );
  });

  const byKind = (kind: LicenseTypeKind) => licenseTypes.filter((lt) => lt.type === kind).length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </button>
            <span className="text-gray-700">|</span>
            <nav className="flex items-center gap-1">
              <button
                onClick={() => router.push("/boh/customers")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
              >
                <Users className="w-3.5 h-3.5" />
                Customers
              </button>
              <button
                onClick={() => router.push("/boh/health")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
              >
                <Activity className="w-3.5 h-3.5" />
                Health
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
              >
                <Key className="w-3.5 h-3.5" />
                License Types
              </button>
              <button
                onClick={() => router.push("/boh/users")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
              >
                <UserCog className="w-3.5 h-3.5" />
                Users
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative hidden sm:flex">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search license types…"
                className="bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-52"
              />
            </div>
            <button
              onClick={() => router.push("/boh/license-types/new")}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-600/20"
            >
              <Plus className="w-4 h-4" />
              New Type
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-3">
          {(["one_time", "subscription", "by_endpoint"] as LicenseTypeKind[]).map((kind) => {
            const meta = KIND_META[kind];
            return (
              <div key={kind} className={`bg-gray-900 border rounded-xl px-4 py-3 flex items-center gap-3 ${meta.bg}`}>
                <span className={meta.color}>{meta.icon}</span>
                <div>
                  <p className={`text-lg font-bold ${meta.color}`}>{byKind(kind)}</p>
                  <p className="text-xs text-gray-500">{meta.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center">
              <Key className="w-7 h-7 text-gray-600" />
            </div>
            <p className="text-gray-400 text-lg font-medium">
              {search ? "No license types match your search" : "No license types yet"}
            </p>
            {!search && (
              <button
                onClick={() => router.push("/boh/license-types/new")}
                className="mt-2 flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all"
              >
                <Plus className="w-4 h-4" />
                Add First License Type
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((lt) => {
              const meta = KIND_META[lt.type];
              return (
                <div key={lt.id} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-5 flex flex-col gap-3 transition-colors">
                  {/* Top */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{lt.name}</p>
                      {lt.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{lt.description}</p>
                      )}
                    </div>
                    <span className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${meta.bg} ${meta.color}`}>
                      {meta.icon}
                      {meta.label}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1 bg-gray-800 px-2.5 py-1 rounded-lg">
                      <Tag className="w-3 h-3" />
                      {formatPrice(lt.price_cents)}
                    </span>
                    {lt.type === "by_endpoint" && lt.endpoint_type && (
                      <span className="flex items-center gap-1 bg-gray-800 px-2.5 py-1 rounded-lg">
                        <Activity className="w-3 h-3" />
                        {lt.endpoint_type}
                      </span>
                    )}
                    {lt.type === "one_time" && lt.default_executions != null && (
                      <span className="flex items-center gap-1 bg-gray-800 px-2.5 py-1 rounded-lg">
                        <Zap className="w-3 h-3" />
                        {lt.default_executions} executions
                      </span>
                    )}
                    {lt.type === "subscription" && (
                      <span className="flex items-center gap-1 bg-gray-800 px-2.5 py-1 rounded-lg">
                        <RefreshCw className="w-3 h-3" />
                        Notify {lt.renewal_notification_days}d before
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1 border-t border-gray-800">
                    <button
                      onClick={() => router.push(`/boh/license-types/${lt.id}`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-all"
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(lt.id, lt.name)}
                      disabled={deleting === lt.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                    <span className="ml-auto text-xs text-gray-600">
                      {new Date(lt.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
