"use client";

import { useState, useMemo, Fragment } from "react";
import {
  Search, CheckCircle2, XCircle, Plus, ChevronDown, ChevronUp,
  Package, Clock, Eye, RotateCcw, Tag, Database, Pencil, Trash2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface QueueItem {
  id: string;
  manufacturer_sku: string;
  status: "pending" | "resolved" | "ignored";
  seen_count: number;
  first_seen_at: string;
  last_seen_at: string;
  customer_id: string | null;
  notes: string | null;
  resolved_at: string | null;
  customers: { name: string } | null;
}

interface TaxonomyEntry {
  id: string;
  manufacturer_sku: string;
  manufacturer: string | null;
  type: string | null;
  subtype: string | null;
  description: string | null;
  model: string | null;
  updated_at: string;
}

interface SkuRunException {
  id: string;
  task_id: string;
  task_name: string;
  customer_id: string | null;
  customer_name: string | null;
  run_at: string;
  exceptions: { sku: string; row: number; targetField: string }[];
  status: "pending" | "resolved";
  rerun_at: string | null;
}

interface Props {
  queue: QueueItem[];
  taxonomy: TaxonomyEntry[];
  runs: SkuRunException[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusBadge({ status }: { status: QueueItem["status"] }) {
  const cfg = {
    pending:  { cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", label: "Pending" },
    resolved: { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "Resolved" },
    ignored:  { cls: "bg-gray-500/15 text-gray-400 border-gray-500/30", label: "Ignored" },
  }[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── Resolve / Add Form ─────────────────────────────────────────────────────

function TaxonomyForm({
  sku,
  initial,
  onSave,
  onCancel,
  saving,
  saveLabel,
}: {
  sku: string;
  initial?: Partial<TaxonomyEntry>;
  onSave: (data: { manufacturer: string; type: string; subtype: string; description: string; model: string }) => void;
  onCancel: () => void;
  saving: boolean;
  saveLabel?: string;
}) {
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [type, setType]                 = useState(initial?.type ?? "");
  const [subtype, setSubtype]           = useState(initial?.subtype ?? "");
  const [description, setDescription]   = useState(initial?.description ?? "");
  const [model, setModel]               = useState(initial?.model ?? "");

  return (
    <div className="bg-gray-900 border border-indigo-500/30 rounded-xl p-4 space-y-3">
      <div className="text-xs font-semibold text-indigo-300 mb-1">
        Taxonomy for <span className="font-mono text-white">{sku}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Manufacturer</label>
          <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}
            placeholder="e.g. Dell, HP, Lenovo"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Model</label>
          <input value={model} onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. Latitude 5540"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Type</label>
          <input value={type} onChange={(e) => setType(e.target.value)}
            placeholder="e.g. Computer"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Subtype</label>
          <input value={subtype} onChange={(e) => setSubtype(e.target.value)}
            placeholder="e.g. Laptop"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Dell Latitude 5540 14-inch Business Laptop"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 text-sm transition-all">
          Cancel
        </button>
        <button
          onClick={() => onSave({ manufacturer, type, subtype, description, model })}
          disabled={saving || !type}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all disabled:opacity-50">
          {saving ? "Saving…" : (saveLabel ?? "Save & Resolve")}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function SkuResearchClient({ queue: initialQueue, taxonomy: initialTaxonomy, runs: initialRuns }: Props) {
  const [queue,    setQueue]    = useState<QueueItem[]>(initialQueue);
  const [taxonomy, setTaxonomy] = useState<TaxonomyEntry[]>(initialTaxonomy);
  const [runs,     setRuns]     = useState<SkuRunException[]>(initialRuns);
  const [tab,      setTab]      = useState<"queue" | "runs" | "taxonomy">("queue");
  const [expandedRunIds,     setExpandedRunIds]     = useState<Set<string>>(new Set());
  const [classifyingSkuKey,  setClassifyingSkuKey]  = useState<string | null>(null); // "<runId>:<sku>"
  const [runClassifySaving,  setRunClassifySaving]  = useState(false);
  const [search,   setSearch]   = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved" | "ignored">("pending");
  const [expandedId,   setExpandedId]   = useState<string | null>(null);
  const [savingId,     setSavingId]     = useState<string | null>(null);
  const [showAddForm,  setShowAddForm]  = useState(false);
  const [addSaving,    setAddSaving]    = useState(false);
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [editSaving,   setEditSaving]   = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  function showToast(msg: string, type: "ok" | "err" = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Filtered queue ─────────────────────────────────────────────────────
  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (search && !item.manufacturer_sku.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [queue, statusFilter, search]);

  const filteredTaxonomy = useMemo(() => {
    if (!search) return taxonomy;
    return taxonomy.filter((t) =>
      t.manufacturer_sku.toLowerCase().includes(search.toLowerCase()) ||
      (t.manufacturer ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (t.type ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (t.model ?? "").toLowerCase().includes(search.toLowerCase())
    );
  }, [taxonomy, search]);

  const pendingCount = queue.filter((q) => q.status === "pending").length;

  // ── Resolve: upsert taxonomy + mark resolved ───────────────────────────
  async function handleResolve(item: QueueItem, data: { manufacturer: string; type: string; subtype: string; description: string; model: string }) {
    setSavingId(item.id);
    try {
      // Upsert taxonomy
      const txRes = await fetch("/api/sku-taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturer_sku: item.manufacturer_sku, ...data }),
      });
      if (!txRes.ok) throw new Error(await txRes.text());

      // Mark queue item resolved
      const qRes = await fetch(`/api/sku-research-queue/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });
      if (!qRes.ok) throw new Error(await qRes.text());

      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: "resolved", resolved_at: new Date().toISOString() } : q));
      setExpandedId(null);
      showToast(`SKU ${item.manufacturer_sku} resolved`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setSavingId(null);
    }
  }

  // ── Ignore ─────────────────────────────────────────────────────────────
  async function handleIgnore(item: QueueItem) {
    setSavingId(item.id);
    try {
      const res = await fetch(`/api/sku-research-queue/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ignored" }),
      });
      if (!res.ok) throw new Error(await res.text());
      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: "ignored" } : q));
      showToast(`SKU ${item.manufacturer_sku} ignored`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setSavingId(null);
    }
  }

  // ── Re-open ignored ────────────────────────────────────────────────────
  async function handleReopen(item: QueueItem) {
    setSavingId(item.id);
    try {
      const res = await fetch(`/api/sku-research-queue/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      });
      if (!res.ok) throw new Error(await res.text());
      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: "pending" } : q));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setSavingId(null);
    }
  }

  // ── Add manual taxonomy entry ──────────────────────────────────────────
  const [addSku, setAddSku] = useState("");
  async function handleAddTaxonomy(data: { manufacturer: string; type: string; subtype: string; description: string; model: string }) {
    if (!addSku.trim()) return;
    setAddSaving(true);
    try {
      const res = await fetch("/api/sku-taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturer_sku: addSku.trim().toUpperCase(), ...data }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { data: TaxonomyEntry };
      setTaxonomy((prev) => {
        const filtered = prev.filter((t) => t.manufacturer_sku !== json.data.manufacturer_sku);
        return [...filtered, json.data].sort((a, b) => a.manufacturer_sku.localeCompare(b.manufacturer_sku));
      });
      setAddSku("");
      setShowAddForm(false);
      showToast(`SKU ${json.data.manufacturer_sku} added to taxonomy`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setAddSaving(false);
    }
  }

  // -- Edit existing taxonomy entry --
  async function handleUpdateTaxonomy(entry: TaxonomyEntry, data: { manufacturer: string; type: string; subtype: string; description: string; model: string }) {
    setEditSaving(true);
    try {
      const res = await fetch("/api/sku-taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturer_sku: entry.manufacturer_sku, ...data }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { data: TaxonomyEntry };
      setTaxonomy((prev) => {
        const filtered = prev.filter((t) => t.manufacturer_sku !== entry.manufacturer_sku);
        return [...filtered, json.data].sort((a, b) => a.manufacturer_sku.localeCompare(b.manufacturer_sku));
      });
      setEditingId(null);
      showToast(`SKU ${entry.manufacturer_sku} updated`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setEditSaving(false);
    }
  }

  // -- Classify a SKU from the Exception Runs view --
  async function handleRunClassify(sku: string, data: { manufacturer: string; type: string; subtype: string; description: string; model: string }) {
    setRunClassifySaving(true);
    try {
      const res = await fetch("/api/sku-taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturer_sku: sku.trim().toUpperCase(), ...data }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { data: TaxonomyEntry };
      setTaxonomy((prev) => {
        const filtered = prev.filter((t) => t.manufacturer_sku !== json.data.manufacturer_sku);
        return [...filtered, json.data].sort((a, b) => a.manufacturer_sku.localeCompare(b.manufacturer_sku));
      });
      // Also resolve the queue item if it exists
      await fetch("/api/sku-taxonomy/resolve-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturer_sku: sku.trim().toUpperCase() }),
      }).catch(() => null);
      setClassifyingSkuKey(null);
      showToast(`SKU ${sku} classified`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setRunClassifySaving(false);
    }
  }

  // -- Mark a run as resolved and navigate to scheduler for rerun --
  async function handleRerunJob(run: SkuRunException) {
    try {
      const res = await fetch(`/api/sku-run-exceptions/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved", rerun_at: new Date().toISOString() }),
      });
      if (res.ok) {
        setRuns((prev) => prev.map((r) => r.id === run.id ? { ...r, status: "resolved", rerun_at: new Date().toISOString() } : r));
      }
    } catch { /* best effort */ }
    window.open(`/scheduler?rerun=${run.id}`, "_blank");
  }

  // -- Delete taxonomy entry --
  async function handleDeleteTaxonomy(entry: TaxonomyEntry) {
    try {
      const res = await fetch(`/api/sku-taxonomy?sku=${encodeURIComponent(entry.manufacturer_sku)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      setTaxonomy((prev) => prev.filter((t) => t.manufacturer_sku !== entry.manufacturer_sku));
      setDeletingId(null);
      showToast(`SKU ${entry.manufacturer_sku} deleted`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl text-sm font-medium shadow-xl border transition-all ${
          toast.type === "ok"
            ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
            : "bg-red-500/15 border-red-500/30 text-red-300"
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="border-b border-gray-800 px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white flex items-center gap-2.5">
              <Tag className="w-5 h-5 text-indigo-400" />
              SKU Research
              {pendingCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-yellow-500/15 border border-yellow-500/30 text-yellow-400">
                  {pendingCount} pending
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Classify unrecognized manufacturer SKUs to unblock import runs
            </p>
          </div>
          <button
            onClick={() => { setShowAddForm(true); setTab("taxonomy"); }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all"
          >
            <Plus className="w-4 h-4" />
            Add SKU
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5">
          {(["queue", "runs", "taxonomy"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? "bg-gray-800 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "queue" ? `Research Queue (${queue.filter(q => q.status === "pending").length})`
               : t === "runs" ? `Exception Runs (${runs.filter(r => r.status === "pending").length})`
               : `Taxonomy (${taxonomy.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="px-8 py-4 flex items-center gap-3 border-b border-gray-800/60">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU…"
            className="w-full pl-9 pr-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        {tab === "queue" && (
          <div className="flex gap-1">
            {(["all", "pending", "resolved", "ignored"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                  statusFilter === s
                    ? "bg-gray-700 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-8 py-6">

        {/* ── Queue Tab ── */}
        {tab === "queue" && (
          <div className="space-y-2">
            {filteredQueue.length === 0 && (
              <div className="text-center py-16 text-gray-600">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">{statusFilter === "pending" ? "No pending SKUs — great!" : "No items match your filter."}</p>
              </div>
            )}
            {filteredQueue.map((item) => {
              const isExpanded = expandedId === item.id;
              const isSaving   = savingId === item.id;

              return (
                <div key={item.id} className={`bg-gray-900 border rounded-xl transition-all ${
                  item.status === "pending" ? "border-yellow-500/20" : "border-gray-800"
                }`}>
                  {/* Row */}
                  <div className="flex items-center gap-4 px-4 py-3">
                    {/* SKU */}
                    <div className="font-mono text-sm text-white font-semibold min-w-[180px]">
                      {item.manufacturer_sku}
                    </div>

                    {/* Status */}
                    <StatusBadge status={item.status} />

                    {/* Seen */}
                    <div className="flex items-center gap-1 text-xs text-gray-500 min-w-[80px]">
                      <Eye className="w-3 h-3" />
                      {item.seen_count}× seen
                    </div>

                    {/* Last seen */}
                    <div className="flex items-center gap-1 text-xs text-gray-500 min-w-[100px]">
                      <Clock className="w-3 h-3" />
                      {timeAgo(item.last_seen_at)}
                    </div>

                    {/* Customer */}
                    {item.customers?.name && (
                      <div className="text-xs text-gray-500 truncate">{item.customers.name}</div>
                    )}

                    {/* Actions */}
                    <div className="ml-auto flex items-center gap-2">
                      {item.status === "pending" && (
                        <>
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : item.id)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-300 text-xs font-medium transition-all border border-indigo-500/20"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Resolve
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                          <button
                            onClick={() => handleIgnore(item)}
                            disabled={isSaving}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 text-xs font-medium transition-all disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Ignore
                          </button>
                        </>
                      )}
                      {item.status === "ignored" && (
                        <button
                          onClick={() => handleReopen(item)}
                          disabled={isSaving}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-gray-500 hover:text-yellow-400 hover:bg-gray-800 text-xs font-medium transition-all disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Re-open
                        </button>
                      )}
                      {item.status === "resolved" && (
                        <span className="text-xs text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {item.resolved_at ? timeAgo(item.resolved_at) : "Resolved"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Resolve form */}
                  {isExpanded && (
                    <div className="border-t border-gray-800 p-4">
                      <TaxonomyForm
                        sku={item.manufacturer_sku}
                        saving={isSaving}
                        onCancel={() => setExpandedId(null)}
                        onSave={(data) => handleResolve(item, data)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Taxonomy Tab ── */}
        {/* -- Exception Runs Tab -- */}
        {tab === "runs" && (
          <div className="space-y-6">
            {runs.length === 0 ? (
              <div className="text-center py-16 text-gray-600">No exception runs recorded yet.</div>
            ) : (() => {
              const byCustomer = new Map<string, SkuRunException[]>();
              for (const r of runs) {
                const key = r.customer_name ?? "Unknown Customer";
                if (!byCustomer.has(key)) byCustomer.set(key, []);
                byCustomer.get(key)!.push(r);
              }
              return [...byCustomer.entries()].map(([customer, customerRuns]) => (
                <div key={customer}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">{customer}</span>
                    <div className="flex-1 h-px bg-gray-800" />
                  </div>
                  <div className="space-y-3">
                    {customerRuns.map((run) => {
                      const uniqueSkus = [...new Set(run.exceptions.map((e) => e.sku))];
                      const classifiedSkus = uniqueSkus.filter((s) => taxonomy.some((t) => t.manufacturer_sku === s));
                      const allClassified = classifiedSkus.length === uniqueSkus.length;
                      const isExpanded = expandedRunIds.has(run.id);
                      return (
                        <div key={run.id} className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
                          <div className="flex items-center gap-3 px-4 py-3">
                            <button
                              onClick={() => setExpandedRunIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(run.id)) next.delete(run.id); else next.add(run.id);
                                return next;
                              })}
                              className="text-gray-500 hover:text-gray-300 transition-colors"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-white truncate">{run.task_name}</span>
                                <span className="text-xs text-gray-500">{timeAgo(run.run_at)}</span>
                                {run.status === "resolved"
                                  ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Resolved</span>
                                  : allClassified
                                    ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">Ready to Rerun</span>
                                    : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">Pending ({classifiedSkus.length}/{uniqueSkus.length})</span>
                                }
                              </div>
                            </div>
                            {run.status !== "resolved" && (
                              <button
                                onClick={() => handleRerunJob(run)}
                                disabled={!allClassified}
                                title={allClassified ? "Rerun exception rows in scheduler" : "Classify all SKUs first"}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                  allClassified
                                    ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                                    : "bg-gray-800 text-gray-600 cursor-not-allowed"
                                }`}
                              >
                                <RotateCcw className="w-3 h-3" />
                                Rerun Job
                              </button>
                            )}
                          </div>
                          {isExpanded && (
                            <div className="border-t border-gray-800 divide-y divide-gray-800/60">
                              {uniqueSkus.map((sku) => {
                                const isClassified = taxonomy.some((t) => t.manufacturer_sku === sku);
                                const skuKey = `${run.id}:${sku}`;
                                const isClassifying = classifyingSkuKey === skuKey;
                                return (
                                  <div key={sku} className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                      {isClassified
                                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                        : <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
                                      }
                                      <span className="font-mono text-sm text-white">{sku}</span>
                                      <span className="text-xs text-gray-600">
                                        {run.exceptions.filter((e) => e.sku === sku).map((e) => `row ${e.row}`).join(", ")}
                                      </span>
                                      {!isClassified && !isClassifying && (
                                        <button
                                          onClick={() => setClassifyingSkuKey(skuKey)}
                                          className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                                        >
                                          Classify
                                        </button>
                                      )}
                                      {isClassified && (
                                        <span className="ml-auto text-xs text-emerald-500">Classified</span>
                                      )}
                                    </div>
                                    {isClassifying && (
                                      <div className="mt-3 pl-7">
                                        <TaxonomyForm
                                          sku={sku}
                                          saving={runClassifySaving}
                                          saveLabel="Classify"
                                          onCancel={() => setClassifyingSkuKey(null)}
                                          onSave={(data) => handleRunClassify(sku, data)}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>
        )}

        {tab === "taxonomy" && (
          <div className="space-y-4">
            {/* Add form */}
            {showAddForm && (
              <div className="mb-4">
                <div className="mb-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Manufacturer SKU</label>
                  <input
                    value={addSku}
                    onChange={(e) => setAddSku(e.target.value.toUpperCase())}
                    placeholder="e.g. DELL-LAT-5540-I7"
                    className="w-full max-w-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <TaxonomyForm
                  sku={addSku || "NEW SKU"}
                  saving={addSaving}
                  onCancel={() => { setShowAddForm(false); setAddSku(""); }}
                  onSave={handleAddTaxonomy}
                />
              </div>
            )}

            {/* Table */}
            {filteredTaxonomy.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No taxonomy entries yet. Resolve SKUs from the queue to populate this.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-600 uppercase tracking-wider border-b border-gray-800">
                      <th className="pb-2 pr-4 font-semibold">SKU</th>
                      <th className="pb-2 pr-4 font-semibold">Manufacturer</th>
                      <th className="pb-2 pr-4 font-semibold">Type</th>
                      <th className="pb-2 pr-4 font-semibold">Subtype</th>
                      <th className="pb-2 pr-4 font-semibold">Model</th>
                      <th className="pb-2 pr-4 font-semibold">Description</th>
                      <th className="pb-2 font-semibold">Updated</th>
                      <th className="pb-2 font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {filteredTaxonomy.map((t) => (
                      <Fragment key={t.manufacturer_sku}>
                        <tr className={`transition-colors ${editingId === t.manufacturer_sku ? "bg-indigo-950/30" : "hover:bg-gray-900/50"}`}>
                          <td className="py-2.5 pr-4 font-mono text-white font-medium">{t.manufacturer_sku}</td>
                          <td className="py-2.5 pr-4 text-gray-300">{t.manufacturer ?? <span className="text-gray-700">—</span>}</td>
                          <td className="py-2.5 pr-4 text-gray-300">{t.type ?? <span className="text-gray-700">—</span>}</td>
                          <td className="py-2.5 pr-4 text-gray-300">{t.subtype ?? <span className="text-gray-700">—</span>}</td>
                          <td className="py-2.5 pr-4 text-gray-300">{t.model ?? <span className="text-gray-700">—</span>}</td>
                          <td className="py-2.5 pr-4 text-gray-400 max-w-[220px] truncate">{t.description ?? <span className="text-gray-700">—</span>}</td>
                          <td className="py-2.5 text-xs text-gray-600">{timeAgo(t.updated_at)}</td>
                          <td className="py-2.5">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => { setEditingId(editingId === t.manufacturer_sku ? null : t.manufacturer_sku); setDeletingId(null); }}
                                title="Edit"
                                className={`p-1.5 rounded-lg transition-all ${
                                  editingId === t.manufacturer_sku
                                    ? "bg-indigo-600/30 text-indigo-300"
                                    : "text-gray-600 hover:text-indigo-400 hover:bg-gray-800"
                                }`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {deletingId === t.manufacturer_sku ? (
                                <span className="flex items-center gap-1 ml-1">
                                  <button
                                    onClick={() => handleDeleteTaxonomy(t)}
                                    className="px-2 py-0.5 rounded text-[11px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30"
                                  >Delete</button>
                                  <button
                                    onClick={() => setDeletingId(null)}
                                    className="px-2 py-0.5 rounded text-[11px] text-gray-500 hover:text-gray-300"
                                  >Cancel</button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => { setDeletingId(t.manufacturer_sku); setEditingId(null); }}
                                  title="Delete"
                                  className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-all"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {editingId === t.manufacturer_sku && (
                          <tr>
                            <td colSpan={8} className="p-4 bg-gray-900/40 border-b border-gray-800">
                              <TaxonomyForm
                                sku={t.manufacturer_sku}
                                initial={t}
                                saving={editSaving}
                                saveLabel="Save"
                                onCancel={() => setEditingId(null)}
                                onSave={(data) => handleUpdateTaxonomy(t, data)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
