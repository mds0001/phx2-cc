"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import {
  Bot, Plus, Trash2, Copy, Check, RefreshCw,
  Wifi, WifiOff, AlertTriangle, Clock, Terminal, Download, PowerOff,
} from "lucide-react";

const AGENT_DOWNLOAD_URL = "https://ogolfqzuqnfslyjivntm.supabase.co/storage/v1/object/public/agent-releases/threads-agent.exe";

interface Agent {
  id:          string;
  name:        string;
  status:      "online" | "offline" | "error" | "retired";
  pending_uninstall: boolean;
  last_seen:   string | null;
  version:     string | null;
  platform:    string;
  customer_id: string;
  created_at:  string;
  customers:   { name: string } | null;
}

interface Customer {
  id:   string;
  name: string;
}

interface Props {
  agents:    Agent[];
  customers: Customer[];
}

// ── Helpers ───────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * If the agent DB status is "online" but last_seen is stale (>30s),
 * treat it as "offline" — the agent has likely stopped without a clean exit.
 * 30s = 3× the default 10s poll interval.
 */
function effectiveStatus(agent: Agent): Agent["status"] {
  if (agent.status !== "online") return agent.status;
  if (!agent.last_seen) return "offline";
  const staleMs = 30_000;
  return Date.now() - new Date(agent.last_seen).getTime() > staleMs ? "offline" : "online";
}

function StatusBadge({ status }: { status: Agent["status"] }) {
  const meta = {
    online:  { icon: <Wifi       className="w-3 h-3" />, label: "Online",  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
    offline: { icon: <WifiOff    className="w-3 h-3" />, label: "Offline", color: "text-gray-500",    bg: "bg-gray-500/10 border-gray-600/25"       },
    error:   { icon: <AlertTriangle className="w-3 h-3" />, label: "Error",   color: "text-red-400",    bg: "bg-red-500/10 border-red-500/25"          },
    retired: { icon: <PowerOff      className="w-3 h-3" />, label: "Retired", color: "text-gray-600",    bg: "bg-gray-700/20 border-gray-700/30"        },
  }[status] ?? { icon: <WifiOff className="w-3 h-3" />, label: status, color: "text-gray-500", bg: "bg-gray-500/10 border-gray-600/25" };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${meta.color} ${meta.bg}`}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

// ── Token Modal ───────────────────────────────────────────────

function TokenModal({
  customers,
  onClose,
}: {
  customers: Customer[];
  onClose: () => void;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [loading,    setLoading]    = useState(false);
  const [token,      setToken]      = useState<string | null>(null);
  const [expiresAt,  setExpiresAt]  = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);
  const [timeLeft,   setTimeLeft]   = useState("");

  useEffect(() => {
    if (!expiresAt) return;
    const iv = setInterval(() => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft("Expired"); clearInterval(iv); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${m}:${s.toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(iv);
  }, [expiresAt]);

  async function generate() {
    setLoading(true);
    try {
      const res  = await fetch("/api/agent/generate-token", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ customer_id: customerId }),
      });
      const json = await res.json() as { token?: string; expires_at?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setToken(json.token!);
      setExpiresAt(json.expires_at!);
    } catch (e) {
      alert("Failed to generate token: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <div className="font-semibold text-white">New Agent Token</div>
            <div className="text-xs text-gray-500">One-time use · expires in 1 hour</div>
          </div>
        </div>

        {!token ? (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Customer</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 text-sm transition-all"
              >
                Cancel
              </button>
              <button
                onClick={generate}
                disabled={loading || !customerId}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all disabled:opacity-50"
              >
                {loading ? "Generating…" : "Generate Token"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-400">Registration Token</div>
              <div className="relative">
                <div className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-3 font-mono text-sm text-indigo-300 break-all pr-10">
                  {token}
                </div>
                <button
                  onClick={copy}
                  className="absolute right-2 top-2.5 p-1.5 rounded-md hover:bg-gray-800 text-gray-400 hover:text-white transition-all"
                  title="Copy token"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                <span>Expires in <span className="text-yellow-400 font-mono">{timeLeft}</span></span>
              </div>
            </div>

            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 space-y-1.5">
              <div className="text-xs font-medium text-gray-300">Installation steps</div>
              <ol className="text-xs text-gray-500 space-y-2 list-decimal list-inside">
                <li>
                  <a
                    href={AGENT_DOWNLOAD_URL}
                    download
                    className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    Download threads-agent.exe
                  </a>
                  {" "}to the target machine
                  <div className="mt-1.5 ml-0 bg-yellow-500/10 border border-yellow-500/20 rounded-md p-2 space-y-1">
                    <div className="text-yellow-400 font-medium">⚠ Browser security warning</div>
                    <div className="text-gray-400">Your browser will flag this file as uncommon. To keep the download:</div>
                    <div className="space-y-0.5">
                      <div><span className="text-gray-300 font-medium">Chrome:</span> Open Downloads (⌘J / Ctrl+J) → click the warning → <span className="text-gray-300">Keep anyway</span></div>
                      <div><span className="text-gray-300 font-medium">Edge:</span> Open Downloads → click <span className="text-gray-300">···</span> next to the file → <span className="text-gray-300">Keep</span> → <span className="text-gray-300">Show more</span> → <span className="text-gray-300">Keep anyway</span></div>
                    </div>
                  </div>
                </li>
                <li>Run <span className="font-mono text-gray-300">threads-agent.exe --register</span></li>
                <li>Paste the token above when prompted</li>
                <li>Run <span className="font-mono text-gray-300">threads-agent.exe --install</span> to start as a Windows Service</li>
              </ol>
            </div>

            <button
              onClick={onClose}
              className="w-full px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 text-sm transition-all"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

export default function AgentsClient({ agents: initial, customers }: Props) {
  const supabase = createClient();
  const [agents,       setAgents]       = useState<Agent[]>(initial);
  const [showModal,    setShowModal]     = useState(false);
  const [deleting,     setDeleting]      = useState<string | null>(null);
  const [refreshing,   setRefreshing]    = useState(false);

  const fetchAgents = useCallback(async () => {
    const { data } = await supabase
      .from("agents")
      .select("*, customers(name)")
      .order("created_at", { ascending: false });
    if (data) setAgents(data as Agent[]);
  }, [supabase]);

  // Auto-refresh every 15s to keep status current
  useEffect(() => {
    const iv = setInterval(fetchAgents, 15_000);
    return () => clearInterval(iv);
  }, [fetchAgents]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchAgents();
    setRefreshing(false);
  }

  const [uninstalling, setUninstalling] = useState<string | null>(null);

  async function handleUninstall(id: string, name: string) {
    if (!confirm(`Send uninstall command to agent "${name}"?\n\nThe agent will remove itself from Windows Services on its next heartbeat and cannot be re-used without re-registering.`)) return;
    setUninstalling(id);
    try {
      const res = await fetch("/api/agent/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: id }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Optimistically mark as pending uninstall in UI
      setAgents((prev) => prev.map((a) => a.id === id ? { ...a, pending_uninstall: true } : a));
    } catch (e) {
      alert("Uninstall failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setUninstalling(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove agent "${name}"? It will stop receiving jobs and need to be re-registered.`)) return;
    setDeleting(id);
    await supabase.from("agents").delete().eq("id", id);
    setAgents((p) => p.filter((a) => a.id !== id));
    setDeleting(null);
  }

  const online  = agents.filter((a) => effectiveStatus(a) === "online").length;
  const offline = agents.filter((a) => effectiveStatus(a) === "offline").length;
  const error   = agents.filter((a) => effectiveStatus(a) === "error").length;

  return (
    <div className="ml-[220px] mb-[44px] min-h-screen bg-gray-950 text-white">

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-white text-lg">Remote Agents</span>
            {agents.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-400 font-medium">
                {agents.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 transition-all disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              New Agent
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Summary row */}
        {agents.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Online",  value: online,  color: "text-emerald-400", bg: "bg-emerald-500/5 border-emerald-500/20"  },
              { label: "Offline", value: offline, color: "text-gray-400",    bg: "bg-gray-500/5 border-gray-700/50"         },
              { label: "Error",   value: error,   color: "text-red-400",     bg: "bg-red-500/5 border-red-500/20"           },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl border p-4 ${s.bg}`}>
                <div className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Agent list */}
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-800/80 border border-gray-700 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-gray-600" />
            </div>
            <div className="text-gray-400 font-medium mb-1">No agents registered</div>
            <div className="text-gray-600 text-sm mb-6">Generate a token to install the first agent</div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              New Agent
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4"
              >
                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  effectiveStatus(agent) === "online"   ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" :
                  effectiveStatus(agent) === "error"    ? "bg-red-400" :
                  effectiveStatus(agent) === "retired"  ? "bg-gray-700" :
                  "bg-gray-600"
                }`} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-medium text-white">{agent.name}</span>
                    <StatusBadge status={effectiveStatus(agent)} />
                    {agent.customers?.name && (
                      <span className="text-xs text-gray-500 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5">
                        {agent.customers.name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    {agent.version  && <span>v{agent.version}</span>}
                    {agent.platform && <span className="capitalize">{agent.platform}</span>}
                    <span>Last seen: {timeAgo(agent.last_seen)}</span>
                    <span className="font-mono text-gray-700">{agent.id.slice(0, 8)}…</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {effectiveStatus(agent) !== "retired" && (
                    <button
                      onClick={() => handleUninstall(agent.id, agent.name)}
                      disabled={uninstalling === agent.id || agent.pending_uninstall}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-gray-600 hover:text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-50 text-xs font-medium"
                      title={agent.pending_uninstall ? "Uninstall pending next heartbeat" : "Send uninstall command"}
                    >
                      <PowerOff className="w-3.5 h-3.5" />
                      {agent.pending_uninstall ? "Pending…" : "Uninstall"}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(agent.id, agent.name)}
                    disabled={deleting === agent.id}
                    className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                    title="Remove agent record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <TokenModal
          customers={customers}
          onClose={() => { setShowModal(false); fetchAgents(); }}
        />
      )}
    </div>
  );
}
