"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Plug, Trash2, Edit2, File, Cloud, Mail, Database, Globe,
  ArrowLeft, Zap, ShoppingCart, Package, Building2, Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { EndpointConnection, ConnectionType } from "@/lib/types";

const TYPE_META: Record<ConnectionType, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  file:           { label: "File",            icon: <File         className="w-4 h-4" />, color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/25"     },
  cloud:          { label: "Cloud",           icon: <Cloud        className="w-4 h-4" />, color: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/25"         },
  smtp:           { label: "SMTP",            icon: <Mail         className="w-4 h-4" />, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
  odbc:           { label: "ODBC",            icon: <Database     className="w-4 h-4" />, color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/25"   },
  portal:         { label: "Portal",          icon: <Globe        className="w-4 h-4" />, color: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/25"       },
  ivanti:         { label: "Ivanti ITSM",     icon: <Zap          className="w-4 h-4" />, color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/25"   },
  ivanti_neurons: { label: "Ivanti Neurons",  icon: <Search       className="w-4 h-4" />, color: "text-indigo-400",  bg: "bg-indigo-500/10 border-indigo-500/25"   },
  dell:           { label: "Dell",            icon: <ShoppingCart className="w-4 h-4" />, color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/25"       },
  cdw:            { label: "CDW",             icon: <Package      className="w-4 h-4" />, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/25"         },
  azure:          { label: "Azure",           icon: <Building2    className="w-4 h-4" />, color: "text-cyan-400",    bg: "bg-cyan-500/10 border-cyan-500/25"       },
};

// Display order for type groups
const TYPE_ORDER: ConnectionType[] = [
  "file", "cloud", "ivanti", "ivanti_neurons", "dell", "cdw",
  "azure", "smtp", "odbc", "portal",
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
    default:               return "";
  }
}

export default function ConnectionsListClient({ connections: initial }: { connections: EndpointConnection[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [connections, setConnections] = useState(initial);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Delete this connection?")) return;
    setDeleting(id);
    await supabase.from("endpoint_connections").delete().eq("id", id);
    setConnections((p) => p.filter((c) => c.id !== id));
    setDeleting(null);
  }

  // Group by type, preserving TYPE_ORDER
  const grouped: { type: ConnectionType; items: EndpointConnection[] }[] = TYPE_ORDER
    .map((t) => ({ type: t, items: connections.filter((c) => c.type === t) }))
    .filter((g) => g.items.length > 0);

  // Any types not in TYPE_ORDER (future-proof)
  const knownTypes = new Set(TYPE_ORDER);
  const extras = connections.filter((c) => !knownTypes.has(c.type));
  if (extras.length > 0) {
    const extraGroups = Array.from(new Set(extras.map((c) => c.type))).map((t) => ({
      type: t,
      items: extras.filter((c) => c.type === t),
    }));
    grouped.push(...extraGroups);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,245,255,0.03)_0%,_rgba(123,97,255,0.03)_60%,_transparent_100%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
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
              <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center">
                <Plug className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">Endpoint Connections</span>
              {connections.length > 0 && (
                <span className="ml-1 px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-400 font-medium">
                  {connections.length}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => router.push("/connections/new")}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-cyan-500/20"
          >
            <Plus className="w-4 h-4" />
            New Connection
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        {connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center">
              <Plug className="w-7 h-7 text-gray-600" />
            </div>
            <p className="text-gray-400 text-lg font-medium">No connections yet</p>
            <p className="text-gray-600 text-sm">Create your first endpoint connection to get started.</p>
            <button
              onClick={() => router.push("/connections/new")}
              className="mt-2 flex items-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl text-sm font-semibold transition-all"
            >
              <Plus className="w-4 h-4" />
              New Connection
            </button>
          </div>
        ) : (
          grouped.map(({ type, items }) => {
            const meta = TYPE_META[type] ?? {
              label: type, icon: <Plug className="w-4 h-4" />, color: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/25",
            };
            return (
              <section key={type}>
                {/* Group header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${meta.bg} ${meta.color}`}>
                    {meta.icon}
                  </div>
                  <h2 className={`text-sm font-semibold uppercase tracking-widest ${meta.color}`}>
                    {meta.label}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-500 font-medium">
                    {items.length}
                  </span>
                  <div className="flex-1 h-px bg-gray-800" />
                </div>

                {/* Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {items.map((conn) => (
                    <div
                      key={conn.id}
                      className={`bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col gap-4 hover:border-opacity-60 transition-colors`}
                      style={{ borderColor: "rgb(31 41 55)" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = ""; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgb(31 41 55)"; }}
                    >
                      {/* Top row */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${meta.bg} ${meta.color} shrink-0`}>
                            {meta.icon}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-white truncate">{conn.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{configSummary(conn)}</p>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-1 border-t border-gray-800">
                        <button
                          onClick={() => router.push(`/connections/${conn.id}`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-all"
                        >
                          <Edit2 className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(conn.id)}
                          disabled={deleting === conn.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                        <span className="ml-auto text-xs text-gray-600">
                          {new Date(conn.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
