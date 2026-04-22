"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import {
  Plus, GitMerge, Trash2, Edit2, Copy,
  Lock, Shield, ShieldOff, Building2, Search, ChevronRight,
} from "lucide-react";
import type { MappingProfile } from "@/lib/types";
import CustomerSwitcher, { type CustomerOption } from "@/components/CustomerSwitcher";

interface Props {
  profiles: MappingProfile[];
  isReadOnly?: boolean;
  isAdmin?: boolean;
  customers?: CustomerOption[];
  activeCustomerId?: string | null;
}

export default function MappingsListClient({
  profiles: initial,
  isReadOnly = false,
  isAdmin = false,
  customers = [],
  activeCustomerId = null,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [profiles, setProfiles] = useState(initial);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [search, setSearch] = useState("");

  const visibleProfiles = useMemo(() => {
    const base = showSystem ? profiles : profiles.filter((p) => !p.is_system);
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.target_business_object ?? "").toLowerCase().includes(q)
    );
  }, [profiles, showSystem, search]);

  async function handleDuplicate(p: MappingProfile, isTemplate = false) {
    const defaultName = isTemplate ? p.name : `${p.name} (copy)`;
    const newName = prompt(
      isTemplate ? "Name for your new profile:" : "Name for the duplicate profile:",
      defaultName
    );
    if (!newName?.trim()) return;
    setDuplicating(p.id);
    try {
      const { data, error } = await supabase
        .from("mapping_profiles")
        .insert({
          name: newName.trim(),
          description: p.description,
          source_fields: p.source_fields,
          target_fields: p.target_fields,
          mappings: p.mappings,
          source_connection_id: p.source_connection_id,
          target_connection_id: p.target_connection_id,
          filter_expression: p.filter_expression,
          is_system: false,
        })
        .select("*")
        .single();
      if (error) throw error;
      setProfiles((prev) => [data as MappingProfile, ...prev]);
      router.push(`/mappings/${data.id}`);
    } catch (err) {
      alert("Failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDuplicating(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete mapping profile "${name}"?`)) return;
    await supabase.from("mapping_profiles").delete().eq("id", id);
    setProfiles((p) => p.filter((x) => x.id !== id));
  }

  async function handlePromote(id: string) {
    if (!confirm("Make this a system template? It will be visible to all users and locked for non-admins.")) return;
    setPromoting(id);
    await supabase.from("mapping_profiles").update({ is_system: true, customer_id: null }).eq("id", id);
    setProfiles((p) => p.map((x) => x.id === id ? { ...x, is_system: true, customer_id: null } : x));
    setPromoting(null);
  }

  async function handleDemote(id: string) {
    if (!confirm("Remove this from system templates? It will become a regular mapping profile.")) return;
    setPromoting(id);
    await supabase.from("mapping_profiles").update({ is_system: false }).eq("id", id);
    setProfiles((p) => p.map((x) => x.id === id ? { ...x, is_system: false } : x));
    setPromoting(null);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(99,102,241,0.06)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
                <GitMerge className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">Field Mappings</span>
              {profiles.length > 0 && (
                <span className="ml-1 px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-400 font-medium">
                  {visibleProfiles.length}{visibleProfiles.length !== profiles.length ? ` / ${profiles.length}` : ""}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {customers.length > 0 && (
              <CustomerSwitcher customers={customers} activeCustomerId={activeCustomerId} />
            )}
            {!isReadOnly && (
              <button
                onClick={() => setShowSystem((s) => !s)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                  showSystem
                    ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-400"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300"
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                Show Templates
              </button>
            )}
            {!isReadOnly && (
              <button
                onClick={() => router.push("/mappings/new")}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-600/20"
              >
                <Plus className="w-4 h-4" />
                New Profile
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {profiles.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
              <GitMerge className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">No mapping profiles yet</h3>
            <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
              Create a profile to visually map source fields (Excel / API) to your target destination fields.
            </p>
            {!isReadOnly && (
              <button
                onClick={() => router.push("/mappings/new")}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              >
                <Plus className="w-4 h-4" />
                Create First Profile
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, description, or business object…"
                className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-11 pr-10 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Table */}
            {visibleProfiles.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-12">
                No profiles match &quot;{search}&quot;
              </p>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="py-3 pl-4 pr-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="py-3 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell w-32">
                        Mappings
                      </th>
                      <th className="py-3 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell w-40">
                        Business Object
                      </th>
                      <th className="py-3 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell w-24">
                        Updated
                      </th>
                      <th className="py-3 pl-3 pr-4 w-44" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProfiles.map((p) => {
                      const mapCount = p.mappings?.length ?? 0;
                      const srcCount = p.source_fields?.length ?? 0;
                      const custName = !p.is_system && p.customer_id
                        ? customers.find((c) => c.id === p.customer_id)?.company ||
                          customers.find((c) => c.id === p.customer_id)?.name
                        : null;

                      return (
                        <tr
                          key={p.id}
                          className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors group"
                        >
                          {/* Name */}
                          <td className="py-3 pl-4 pr-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => router.push(`/mappings/${p.id}`)}
                                className="text-sm text-white font-medium hover:text-indigo-400 transition-colors text-left"
                              >
                                {p.name}
                              </button>
                              {p.is_system && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-[10px] font-medium shrink-0">
                                  <Lock className="w-2.5 h-2.5" />
                                  System
                                </span>
                              )}
                              {custName && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-medium shrink-0">
                                  <Building2 className="w-2.5 h-2.5" />
                                  {custName}
                                </span>
                              )}
                              {p.description && (
                                <span className="text-xs text-gray-600 hidden xl:block truncate max-w-xs">
                                  {p.description}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Mappings count */}
                          <td className="py-3 px-3 hidden md:table-cell">
                            <div className="flex items-center gap-1.5">
                              <GitMerge className="w-3 h-3 text-indigo-400 shrink-0" />
                              <span className="text-xs text-gray-400">
                                {mapCount} mappings
                              </span>
                            </div>
                            <div className="text-xs text-gray-600 mt-0.5">
                              {srcCount} source fields
                            </div>
                          </td>

                          {/* Business object */}
                          <td className="py-3 px-3 hidden lg:table-cell">
                            {p.target_business_object ? (
                              <span className="text-xs text-gray-400 font-mono">{p.target_business_object}</span>
                            ) : (
                              <span className="text-xs text-gray-700">—</span>
                            )}
                          </td>

                          {/* Updated */}
                          <td className="py-3 px-3 hidden lg:table-cell">
                            <span className="text-xs text-gray-600">
                              {new Date(p.updated_at).toLocaleDateString()}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3 pl-3 pr-4">
                            <div className="flex items-center gap-1 justify-end">
                              {p.is_system ? (
                                <>
                                  <button
                                    onClick={() => handleDuplicate(p, true)}
                                    disabled={duplicating === p.id}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 text-cyan-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50 whitespace-nowrap"
                                    title="Use as Template"
                                  >
                                    <Copy className="w-3 h-3" />
                                    Use as Template
                                  </button>
                                  {isAdmin && (
                                    <>
                                      <button
                                        onClick={() => router.push(`/mappings/${p.id}`)}
                                        className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800"
                                        title="Edit"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleDemote(p.id)}
                                        disabled={promoting === p.id}
                                        className="p-1.5 text-gray-600 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800 disabled:opacity-40"
                                        title="Remove from system templates"
                                      >
                                        <ShieldOff className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  )}
                                </>
                              ) : (
                                !isReadOnly && (
                                  <>
                                    <button
                                      onClick={() => router.push(`/mappings/${p.id}`)}
                                      className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800"
                                      title="Edit"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDuplicate(p)}
                                      disabled={duplicating === p.id}
                                      className="p-1.5 text-gray-500 hover:text-indigo-400 transition-colors rounded-lg hover:bg-gray-800 disabled:opacity-40"
                                      title="Duplicate"
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                    {isAdmin && (
                                      <button
                                        onClick={() => handlePromote(p.id)}
                                        disabled={promoting === p.id}
                                        className="p-1.5 text-gray-600 hover:text-cyan-400 transition-colors rounded-lg hover:bg-gray-800 disabled:opacity-40"
                                        title="Make system template"
                                      >
                                        <Shield className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleDelete(p.id, p.name)}
                                      className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-800"
                                      title="Delete"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )
                              )}
                              <button
                                onClick={() => router.push(`/mappings/${p.id}`)}
                                className="p-1.5 text-gray-700 hover:text-gray-400 transition-colors rounded-lg hover:bg-gray-800"
                                title="Open"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
