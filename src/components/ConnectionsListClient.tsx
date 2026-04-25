"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Plug, Trash2, Edit2, File, Cloud, Mail, Database, Globe,
  Zap, ShoppingCart, Package, Building2, Search,
  Lock, Copy, Shield, ShieldOff, Loader2, CheckCircle2, XCircle, Bot, Link2,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { EndpointConnection, ConnectionType } from "@/lib/types";

const TYPE_META: Record<ConnectionType, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  file:           { label: "File",           icon: <File         className="w-3.5 h-3.5" />, color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/25"     },
  cloud:          { label: "Cloud",          icon: <Cloud        className="w-3.5 h-3.5" />, color: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/25"         },
  smtp:           { label: "SMTP",           icon: <Mail         className="w-3.5 h-3.5" />, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
  odbc:           { label: "ODBC",           icon: <Database     className="w-3.5 h-3.5" />, color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/25"   },
  portal:         { label: "Portal",         icon: <Globe        className="w-3.5 h-3.5" />, color: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/25"       },
  ivanti:         { label: "Ivanti ITSM",    icon: <Zap          className="w-3.5 h-3.5" />, color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/25"   },
  ivanti_neurons: { label: "Ivanti Neurons", icon: <Search       className="w-3.5 h-3.5" />, color: "text-indigo-400",  bg: "bg-indigo-500/10 border-indigo-500/25"   },
  dell:           { label: "Dell",           icon: <ShoppingCart className="w-3.5 h-3.5" />, color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/25"       },
  cdw:            { label: "CDW",            icon: <Package      className="w-3.5 h-3.5" />, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/25"         },
  azure:          { label: "Azure",          icon: <Building2    className="w-3.5 h-3.5" />, color: "text-cyan-400",    bg: "bg-cyan-500/10 border-cyan-500/25"       },
  insight:        { label: "Insight",        icon: <Link2        className="w-3.5 h-3.5" />, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
};

const TYPE_ORDER: ConnectionType[] = [
  "file", "cloud", "ivanti", "ivanti_neurons", "dell", "cdw",
  "azure", "insight", "smtp", "odbc", "portal",
];

function configSummary(conn: EndpointConnection): string {
  const c = conn.config as unknown as Record<string, string>;
  switch (conn.type) {
    case "file":           return c.file_name || c.file_path?.split("/").pop() || "No file selected";
    case "cloud":          return c.url      || "No URL";
    case "smtp":           return c.server   ? `${c.server}:${c.port || "587"}` : "No server";
    case "odbc":           return c.server_name ? `${c.server_name}:${c.port || "1433"}` : "No server";
    case "portal":         return c.url      || "No URL";
    case "ivanti":         return c.url      || "No URL";
    case "ivanti_neurons": return c.base_url || "No URL";
    case "dell":           return c.base_url || "No URL";
    case "cdw":            return c.base_url || "No URL";
    case "azure":          return c.base_url || "No URL";
    case "insight":        return c.url || "No URL";
    default:               return "";
  }
}

import CustomerSwitcher, { type CustomerOption } from "@/components/CustomerSwitcher";

export default function ConnectionsListClient({
  connections: initial,
  isReadOnly = false,
  isAdmin = false,
  customers = [],
  activeCustomerId = null,
}: {
  connections: EndpointConnection[];
  isReadOnly?: boolean;
  isAdmin?: boolean;
  customers?: CustomerOption[];
  activeCustomerId?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [connections, setConnections] = useState(initial);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [search, setSearch] = useState("");

  type TestStatus = { status: "testing" | "ok" | "fail"; message: string };
  const [testResults, setTestResults] = useState<Record<string, TestStatus>>({});

  async function runTest(conn: EndpointConnection) {
    setTestResults((p) => ({ ...p, [conn.id]: { status: "testing", message: "Testing\u2026" } }));
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: conn.type, config: conn.config }),
      });
      const data = (await res.json()) as { success: boolean; message: string };
      setTestResults((p) => ({
        ...p,
        [conn.id]: { status: data.success ? "ok" : "fail", message: data.message },
      }));
    } catch (e) {
      setTestResults((p) => ({
        ...p,
        [conn.id]: { status: "fail", message: e instanceof Error ? e.message : "Unknown error" },
      }));
    }
  }

  const visibleConnections = useMemo(() => {
    const base = showSystem ? connections : connections.filter((c) => !c.is_system);
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        configSummary(c).toLowerCase().includes(q) ||
        (TYPE_META[c.type]?.label ?? c.type).toLowerCase().includes(q)
    );
  }, [connections, showSystem, search]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this connection?")) return;
    setDeleting(id);
    await supabase.from("endpoint_connections").delete().eq("id", id);
    setConnections((p) => p.filter((c) => c.id !== id));
    setDeleting(null);
  }

  async function handlePromote(id: string) {
    if (!confirm("Make this a system template? It will be visible to all users and locked for editing by non-admins.")) return;
    setPromoting(id);
    await supabase.from("endpoint_connections").update({ is_system: true, customer_id: null }).eq("id", id);
    setConnections((p) => p.map((c) => c.id === id ? { ...c, is_system: true, customer_id: null } : c));
    setPromoting(null);
  }

  async function handleDemote(id: string) {
    if (!confirm("Remove this from system templates? It will become a regular connection.")) return;
    setPromoting(id);
    await supabase.from("endpoint_connections").update({ is_system: false }).eq("id", id);
    setConnections((p) => p.map((c) => c.id === id ? { ...c, is_system: false } : c));
    setPromoting(null);
  }

  function handleUseAsTemplate(id: string) {
    router.push(`/connections/new?from=${id}`);
  }

  const isSearching = search.trim().length > 0;

  const grouped = useMemo<{ type: ConnectionType; items: EndpointConnection[] }[]>(() => {
    if (isSearching) return [];
    const knownTypes = new Set(TYPE_ORDER);
    const result = TYPE_ORDER
      .map((t) => ({ type: t, items: visibleConnections.filter((c) => c.type === t) }))
      .filter((g) => g.items.length > 0);
    const extras = visibleConnections.filter((c) => !knownTypes.has(c.type));
    if (extras.length > 0) {
      Array.from(new Set(extras.map((c) => c.type))).forEach((t) => {
        result.push({ type: t, items: extras.filter((c) => c.type === t) });
      });
    }
    return result;
  }, [visibleConnections, isSearching]);

  function RowActions({ conn }: { conn: EndpointConnection }) {
    return (
      <div className="flex items-center gap-1.5 justify-end">
        {conn.is_system ? (
          <>
            <button
              onClick={() => handleUseAsTemplate(conn.id)}
              className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 text-cyan-400 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
            >
              <Copy className="w-3 h-3" />
              Use as Template
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => router.push(`/connections/${conn.id}`)}
                  className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800"
                  title="Edit"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDemote(conn.id)}
                  disabled={promoting === conn.id}
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
                onClick={() => router.push(`/connections/${conn.id}`)}
                className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800"
                title="Edit"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              {isAdmin && (
                <button
                  onClick={() => handlePromote(conn.id)}
                  disabled={promoting === conn.id}
                  className="p-1.5 text-gray-600 hover:text-cyan-400 transition-colors rounded-lg hover:bg-gray-800 disabled:opacity-40"
                  title="Make system template"
                >
                  <Shield className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => handleDelete(conn.id)}
                disabled={deleting === conn.id}
                className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-800 disabled:opacity-40"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )
        )}
      </div>
    );
  }

  function ConnectionRow({ conn }: { conn: EndpointConnection }) {
    const meta = TYPE_META[conn.type] ?? {
      label: conn.type, icon: <Plug className="w-3.5 h-3.5" />, color: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/25",
    };
    const custName = !conn.is_system && conn.customer_id
      ? customers.find((c) => c.id === conn.customer_id)?.company || customers.find((c) => c.id === conn.customer_id)?.name
      : null;

    const test = testResults[conn.id];
    const badgeColor =
      !test                     ? `${meta.bg} ${meta.color}` :
      test.status === "testing"  ? "bg-gray-500/10 border-gray-500/25 text-gray-400" :
      test.status === "ok"       ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" :
                                   "bg-red-500/10 border-red-500/25 text-red-400";
    const badgeIcon =
      !test                     ? meta.icon :
      test.status === "testing"  ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
      test.status === "ok"       ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                                   <XCircle className="w-3.5 h-3.5" />;

    return (
      <tr className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors group">
        {/* Type badge — click to test connection */}
        <td className="py-3 pl-4 pr-3 w-28">
          <button
            onClick={() => runTest(conn)}
            disabled={test?.status === "testing"}
            title={test ? test.message : `Test ${meta.label} connection`}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium transition-all hover:brightness-125 active:scale-95 disabled:cursor-wait cursor-pointer ${badgeColor}`}
          >
            {badgeIcon}
            {meta.label}
          </button>
        </td>

        {/* Name */}
        <td className="py-3 px-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-white font-medium truncate max-w-[340px]">{conn.name}</span>
            {conn.is_system && (
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
            {conn.agent_id && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-medium shrink-0">
                <Bot className="w-2.5 h-2.5" />
                Agent
              </span>
            )}
          </div>
        </td>

        {/* Config summary */}
        <td className="py-3 px-3 w-44 hidden md:table-cell">
          <span className="text-xs text-gray-500 truncate block max-w-[160px]">{configSummary(conn)}</span>
        </td>

        {/* Updated */}
        <td className="py-3 px-3 w-20 hidden lg:table-cell">
          <span className="text-xs text-gray-600">
            {new Date(conn.updated_at).toLocaleDateString()}
          </span>
        </td>

        {/* Actions */}
        <td className="py-3 pl-3 pr-4 w-36">
          <RowActions conn={conn} />
        </td>
      </tr>
    );
  }

  function ConnectionTable({ items }: { items: EndpointConnection[] }) {
    return (
      <table className="w-full">
        <tbody>
          {items.map((conn) => (
            <ConnectionRow key={conn.id} conn={conn} />
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,245,255,0.03)_0%,_rgba(123,97,255,0.03)_60%,_transparent_100%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center">
                <Plug className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">Endpoint Connections</span>
              {connections.length > 0 && (
                <span className="ml-1 px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-400 font-medium">
                  {visibleConnections.length}{visibleConnections.length !== connections.length ? ` / ${connections.length}` : ""}
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
                onClick={() => router.push("/connections/new")}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-cyan-500/20"
              >
                <Plus className="w-4 h-4" />
                New Connection
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center">
              <Plug className="w-7 h-7 text-gray-600" />
            </div>
            <p className="text-gray-400 text-lg font-medium">No connections yet</p>
            <p className="text-gray-600 text-sm">Create your first endpoint connection to get started.</p>
            {!isReadOnly && (
              <button
                onClick={() => router.push("/connections/new")}
                className="mt-2 flex items-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl text-sm font-semibold transition-all"
              >
                <Plus className="w-4 h-4" />
                New Connection
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, type, or URL\u2026"
                className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors"
                >
                  \u2715
                </button>
              )}
            </div>

            {/* Results */}
            {isSearching ? (
              visibleConnections.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-12">No connections match &quot;{search}&quot;</p>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <ConnectionTable items={visibleConnections} />
                </div>
              )
            ) : (
              grouped.map(({ type, items }) => {
                const meta = TYPE_META[type] ?? {
                  label: type, icon: <Plug className="w-3.5 h-3.5" />, color: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/25",
                };
                return (
                  <section key={type}>
                    {/* Group header */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center border ${meta.bg} ${meta.color}`}>
                        {meta.icon}
                      </div>
                      <h2 className={`text-xs font-semibold uppercase tracking-widest ${meta.color}`}>
                        {meta.label}
                      </h2>
                      <span className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-500 font-medium">
                        {items.length}
                      </span>
                      <div className="flex-1 h-px bg-gray-800" />
                    </div>

                    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                      <ConnectionTable items={items} />
                    </div>
                  </section>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}
