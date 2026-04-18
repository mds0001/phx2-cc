"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import {
  ArrowLeft,
  Plus,
  GitMerge,
  Trash2,
  Edit2,
  Copy,
  Zap,
  Calendar,
  Lock,
  Shield,
  ShieldOff,
  Building2,
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

export default function MappingsListClient({ profiles: initial, isReadOnly = false, isAdmin = false, customers = [], activeCustomerId = null }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [profiles, setProfiles] = useState(initial);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);

  const visibleProfiles = showSystem
    ? profiles
    : profiles.filter((p) => !p.is_system);

  async function handleDuplicate(p: MappingProfile, isTemplate = false) {
    const defaultName = isTemplate ? p.name : `${p.name} (copy)`;
    const newName = prompt(isTemplate ? "Name for your new profile:" : "Name for the duplicate profile:", defaultName);
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
          // created_by intentionally omitted — will be set server-side or left null
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
    setProfiles((p: MappingProfile[]) => p.filter((x) => x.id !== id));
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
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </button>
            <span className="text-gray-700">|</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
                <GitMerge className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">Field Mappings</span>
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

      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white">Mapping Profiles</h2>
          <p className="text-gray-400 mt-1">
            Define how source fields map to target fields for your tasks.
          </p>
        </div>

        {visibleProfiles.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
              <GitMerge className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">
              No mapping profiles yet
            </h3>
            <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
              Create a profile to visually map source fields (Excel / API) to
              your target destination fields.
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleProfiles.map((p) => {
              const srcCount = p.source_fields?.length ?? 0;
              const tgtCount = p.target_fields?.length ?? 0;
              const mapCount = p.mappings?.length ?? 0;

              return (
                <div
                  key={p.id}
                  className={`bg-gray-900 border rounded-2xl p-6 shadow-lg transition-all group ${p.is_system ? "border-cyan-500/20 hover:border-cyan-500/40 cursor-default" : "border-gray-800 hover:border-indigo-500/40 cursor-pointer"}`}
                  onClick={() => !p.is_system && router.push(`/mappings/${p.id}`)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center group-hover:bg-indigo-500/20 transition-colors">
                        <GitMerge className="w-5 h-5 text-indigo-400" />
                      </div>
                      {p.is_system && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-xs font-medium">
                          <Lock className="w-3 h-3" />
                          System
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {p.is_system ? (
                        <>
                          <button
                            onClick={() => handleDuplicate(p, true)}
                            disabled={duplicating === p.id}
                            className="w-8 h-8 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 flex items-center justify-center text-cyan-400 transition-all disabled:opacity-50"
                            title="Use as Template"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => router.push(`/mappings/${p.id}`)}
                                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-all"
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDemote(p.id)}
                                disabled={promoting === p.id}
                                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-gray-300 transition-all disabled:opacity-50"
                                title="Remove from System"
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
                              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-all"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDuplicate(p)}
                              disabled={duplicating === p.id}
                              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-indigo-500/20 flex items-center justify-center text-gray-400 hover:text-indigo-400 transition-all disabled:opacity-50"
                              title="Duplicate"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(p.id, p.name)}
                              className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-red-500/20 flex items-center justify-center text-gray-400 hover:text-red-400 transition-all"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => handlePromote(p.id)}
                                disabled={promoting === p.id}
                                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-cyan-500/10 flex items-center justify-center text-gray-400 hover:text-cyan-400 transition-all disabled:opacity-50"
                                title="Make System"
                              >
                                <Shield className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        )
                      )}
                    </div>
                  </div>

                  <h3 className="text-white font-semibold mb-1 truncate">
                    {p.name}
                  </h3>
                  {p.description && (
                    <p className="text-gray-500 text-xs mb-4 line-clamp-2">
                      {p.description}
                    </p>
                  )}

                  {/* Stats */}
                  <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-800">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-yellow-400" />
                      <span className="text-xs text-gray-400">
                        {srcCount} source
                      </span>
                    </div>
                    <span className="text-gray-700">→</span>
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-emerald-400" />
                      <span className="text-xs text-gray-400">
                        {tgtCount} target
                      </span>
                    </div>
                    <div className="ml-auto flex items-center gap-1 text-xs text-indigo-400 font-medium">
                      <GitMerge className="w-3 h-3" />
                      {mapCount} mapped
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <div className="flex items-center gap-1 text-xs text-gray-600">
                      <Calendar className="w-3 h-3" />
                      Updated{" "}
                      {new Date(p.updated_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    {!activeCustomerId && !p.is_system && p.customer_id && (() => {
                      const cust = customers.find((c) => c.id === p.customer_id);
                      return cust ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-medium">
                          <Building2 className="w-2.5 h-2.5" />
                          {cust.company || cust.name}
                        </span>
                      ) : null;
                    })()}
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
