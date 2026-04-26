"use client";

import { useState, useMemo, Fragment, useEffect } from "react";
import {
  Search, CheckCircle2, XCircle, Plus, ChevronDown, ChevronUp, X,
  Package, Clock, Eye, RotateCcw, Tag, Database, Pencil, Trash2, Sparkles, Loader2,
} from "lucide-react";
import CustomerSwitcher, { type CustomerOption } from "@/components/CustomerSwitcher";

// ── Types ──────────────────────────────────────────────────────────────────

interface QueueItem {
  id: string;
  manufacturer_sku: string;
  status: "pending" | "resolved" | "ignored" | "skipped";
  seen_count: number;
  first_seen_at: string;
  last_seen_at: string;
  customer_id: string | null;
  notes: string | null;
  resolved_at: string | null;
  customers: { name: string } | null;
  context: Record<string, string> | null;
  archived: boolean;
}

interface TaxonomySuggestion {
  manufacturer: string;
  type: string;
  subtype: string;
  description: string;
  model: string;
}

const CI_SUBTYPES: Record<string, string[]> = {
  Computer:           ["All-In-One", "Desktop", "Laptop", "Server", "Thin Client", "Tablet", "Virtual Client", "Virtual Desktop", "Virtual Server"],
  MobileDevice:       ["Audio Device", "Smart Phone", "Tablet", "Wearable"],
  PeripheralDevice:   ["Badge", "CC Reader", "Display", "Dock", "Document Scanner", "Fax", "Hard-Drive", "Monitor", "Monitor 13 Inch", "Monitor 15 Inch", "Printer", "Projector", "Reader", "Scanner", "UPS", "USB", "Web Cam"],
  ivnt_Infrastructure:["Access Point", "Barcode Scanner", "Chassis", "Database", "Firewall", "Generator", "Hub", "Management", "Network MFD", "Network Test", "NIC Module", "Phone", "Printer", "Projector", "Rack", "Router", "SAN", "Scanner", "Security", "Switch", "Telephony", "UPS", "Video Conference"],
  ivnt_GeneralAsset:  ["BatchJob", "Cart", "Certificate", "Cluster", "Document", "ESX", "Headphones", "Middleware", "ProductivityApp", "System", "TV", "VOIP"],
};

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
  archived: boolean;
}

interface Props {
  queue: QueueItem[];
  taxonomy: TaxonomyEntry[];
  runs: SkuRunException[];
  customers?: CustomerOption[];
  activeCustomerId?: string | null;
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
    skipped:  { cls: "bg-blue-500/15 text-blue-400 border-blue-500/30", label: "Skipped" },
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
  aiSuggestion,
  onSave,
  onCancel,
  onSkip,
  onIgnore,
  saving,
  saveLabel,
}: {
  sku: string;
  initial?: Partial<TaxonomyEntry>;
  aiSuggestion?: TaxonomySuggestion | null;
  onSave: (data: { manufacturer: string; type: string; subtype: string; description: string; model: string }) => void;
  onCancel: () => void;
  onSkip?: () => void;
  onIgnore?: () => void;
  saving: boolean;
  saveLabel?: string;
}) {
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? aiSuggestion?.manufacturer ?? "");
  const [type, setType]                 = useState(initial?.type ?? aiSuggestion?.type ?? "");
  const [subtype, setSubtype]           = useState(initial?.subtype ?? aiSuggestion?.subtype ?? "");
  const [description, setDescription]   = useState(initial?.description ?? aiSuggestion?.description ?? "");
  const [model, setModel]               = useState(initial?.model ?? aiSuggestion?.model ?? "");
  const [customSubtype, setCustomSubtype] = useState(false);

  useEffect(() => {
    if (aiSuggestion && (aiSuggestion.manufacturer || aiSuggestion.type || aiSuggestion.subtype || aiSuggestion.model || aiSuggestion.description)) {
      if (aiSuggestion.manufacturer) setManufacturer(aiSuggestion.manufacturer);
      if (aiSuggestion.type)         setType(aiSuggestion.type);
      if (aiSuggestion.subtype)      setSubtype(aiSuggestion.subtype);
      if (aiSuggestion.description)  setDescription(aiSuggestion.description);
      if (aiSuggestion.model)        setModel(aiSuggestion.model);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSuggestion]);

  const aiIsEmpty = aiSuggestion != null &&
    !aiSuggestion.manufacturer && !aiSuggestion.type &&
    !aiSuggestion.subtype && !aiSuggestion.description && !aiSuggestion.model;

  function applyAiSuggestion() {
    if (!aiSuggestion) return;
    if (aiSuggestion.manufacturer) setManufacturer(aiSuggestion.manufacturer);
    if (aiSuggestion.type)         setType(aiSuggestion.type);
    if (aiSuggestion.subtype)      setSubtype(aiSuggestion.subtype);
    if (aiSuggestion.description)  setDescription(aiSuggestion.description);
    if (aiSuggestion.model)        setModel(aiSuggestion.model);
  }

  return (
    <div className="bg-gray-900 border border-indigo-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold text-indigo-300">
          Taxonomy for <span className="font-mono text-white">{sku}</span>
        </div>
        {aiSuggestion && !aiIsEmpty && (
          <button
            type="button"
            onClick={applyAiSuggestion}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-[11px] font-medium transition-all"
          >
            <Sparkles className="w-3 h-3" />
            Apply AI Suggestion
          </button>
        )}
      </div>
      {aiIsEmpty && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2.5 space-y-2">
          <div className="text-[11px] text-yellow-400 font-medium">
            AI couldn&apos;t find a good fit for this SKU. How would you like to proceed?
          </div>
          <div className="flex gap-2">
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-[11px] font-medium transition-all"
              >
                Skip for Now
              </button>
            )}
            {onIgnore && (
              <button
                type="button"
                onClick={onIgnore}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 text-[11px] font-medium transition-all"
              >
                Perm. Ignore
              </button>
            )}
            <button
              type="button"
              onClick={() => { setCustomSubtype(true); }}
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-[11px] font-medium transition-all"
            >
              Add New Subtype
            </button>
          </div>
        </div>
      )}
      {aiSuggestion && !aiIsEmpty && (
        <div className="text-[11px] text-purple-400/70 bg-purple-500/5 border border-purple-500/15 rounded-lg px-3 py-2 font-mono leading-relaxed">
          {[aiSuggestion.manufacturer, aiSuggestion.type, aiSuggestion.subtype, aiSuggestion.model].filter(Boolean).join(" · ")}
          {aiSuggestion.description && <span className="text-gray-500"> — {aiSuggestion.description}</span>}
        </div>
      )}
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
          <select value={type} onChange={(e) => { setType(e.target.value); setSubtype(""); }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="">— select type —</option>
            <option value="Computer">Computer</option>
            <option value="MobileDevice">MobileDevice</option>
            <option value="PeripheralDevice">PeripheralDevice</option>
            <option value="ivnt_Infrastructure">ivnt_Infrastructure</option>
            <option value="ivnt_GeneralAsset">ivnt_GeneralAsset</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">
            Subtype
            {customSubtype && <span className="ml-1.5 text-indigo-400">(new)</span>}
          </label>
          {customSubtype ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <span>CI Type:</span>
                {type ? (
                  <span className="text-indigo-300 font-medium font-mono">{type}</span>
                ) : (
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="bg-gray-800 border border-indigo-500/50 rounded px-2 py-0.5 text-white text-[11px] focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">— select type first —</option>
                    <option value="Computer">Computer</option>
                    <option value="MobileDevice">MobileDevice</option>
                    <option value="PeripheralDevice">PeripheralDevice</option>
                    <option value="ivnt_Infrastructure">ivnt_Infrastructure</option>
                    <option value="ivnt_GeneralAsset">ivnt_GeneralAsset</option>
                  </select>
                )}
                <span className="text-gray-600">→ New Subtype</span>
              </div>
              <div className="flex gap-1.5">
                <input
                  value={subtype}
                  onChange={(e) => setSubtype(e.target.value)}
                  placeholder={type ? `New subtype under ${type}` : "Select CI type first"}
                  disabled={!type}
                  className="flex-1 bg-gray-800 border border-indigo-500/50 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
                  autoFocus={!!type}
                />
                <button
                  type="button"
                  onClick={() => { setCustomSubtype(false); setSubtype(""); }}
                  className="px-2 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-400 text-[11px] transition-all"
                >
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <select value={subtype} onChange={(e) => setSubtype(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                disabled={!type}>
                <option value="">{type ? "— select subtype —" : "— select type first —"}</option>
                {(CI_SUBTYPES[type] ?? []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {type && (
                <button
                  type="button"
                  onClick={() => { setCustomSubtype(true); setSubtype(""); }}
                  title="Add new subtype"
                  className="px-2 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 border border-gray-700 text-gray-400 hover:text-white text-[11px] transition-all"
                >
                  +
                </button>
              )}
            </div>
          )}
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Dell Latitude 5540 14-inch Business Laptop"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1 flex-wrap">
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
        {onSkip && (
          <button type="button" onClick={onSkip}
            className="px-3 py-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-gray-800 text-xs font-medium transition-all border border-gray-700">
            Skip for Now
          </button>
        )}
        {onIgnore && (
          <button type="button" onClick={onIgnore}
            className="px-3 py-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-gray-800 text-xs font-medium transition-all border border-gray-700">
            Perm. Ignore
          </button>
        )}
        <button type="button" onClick={() => setCustomSubtype(true)}
          className="px-3 py-1.5 rounded-lg text-gray-500 hover:text-indigo-400 hover:bg-gray-800 text-xs font-medium transition-all border border-gray-700">
          + New Subtype
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function SkuResearchClient({ queue: initialQueue, taxonomy: initialTaxonomy, runs: initialRuns, customers = [], activeCustomerId = null }: Props) {
  const [queue,    setQueue]    = useState<QueueItem[]>(initialQueue);
  const [taxonomy, setTaxonomy] = useState<TaxonomyEntry[]>(initialTaxonomy);
  const [runs,     setRuns]     = useState<SkuRunException[]>(initialRuns);
  const [tab,      setTab]      = useState<"runs" | "taxonomy">("runs");
  const [expandedRunIds,     setExpandedRunIds]     = useState<Set<string>>(new Set());
  const [classifyingSkuKey,  setClassifyingSkuKey]  = useState<string | null>(null); // "<runId>:<sku>"
  const [runClassifySaving,  setRunClassifySaving]  = useState(false);
  const [search,   setSearch]   = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved" | "ignored" | "skipped">("pending");
  const [expandedId,   setExpandedId]   = useState<string | null>(null);
  const [savingId,     setSavingId]     = useState<string | null>(null);
  const [showAddForm,  setShowAddForm]  = useState(false);
  const [addSaving,    setAddSaving]    = useState(false);
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [editSaving,   setEditSaving]   = useState(false);
  const [suggestingId,  setSuggestingId]  = useState<string | null>(null);
  const [suggestions,   setSuggestions]   = useState<Record<string, TaxonomySuggestion>>({});
  const [batchResearching, setBatchResearching] = useState(false);
  const [batchProgress,    setBatchProgress]    = useState<{ done: number; total: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [runSuggestions, setRunSuggestions] = useState<Record<string, TaxonomySuggestion>>({});
  const [runSuggestingKey, setRunSuggestingKey] = useState<string | null>(null);
  const [suggestAllRunId,  setSuggestAllRunId]  = useState<string | null>(null); // run-level suggest-all in progress
  const [suggestAllReview, setSuggestAllReview] = useState<{ runId: string; items: { key: string; sku: string; suggestion: TaxonomySuggestion; customerId: string | null }[] } | null>(null);
  const [reviewSavingKey,  setReviewSavingKey]  = useState<string | null>(null);
  const [showArchivedQueue, setShowArchivedQueue] = useState(false);
  const [taxSort, setTaxSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "manufacturer_sku", dir: "asc" });
  const [selectedTaxIds, setSelectedTaxIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  function showToast(msg: string, type: "ok" | "err" = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Filtered queue ─────────────────────────────────────────────────────
  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      if (!showArchivedQueue && item.archived) return false;
      if (showArchivedQueue && !item.archived) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (search && !item.manufacturer_sku.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [queue, statusFilter, search, showArchivedQueue]);

  const filteredTaxonomy = useMemo(() => {
    if (!search) return taxonomy;
    return taxonomy.filter((t) =>
      t.manufacturer_sku.toLowerCase().includes(search.toLowerCase()) ||
      (t.manufacturer ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (t.type ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (t.model ?? "").toLowerCase().includes(search.toLowerCase())
    );
  }, [taxonomy, search]);

  const sortedTaxonomy = useMemo(() => {
    const col = taxSort.col as keyof TaxonomyEntry;
    return [...filteredTaxonomy].sort((a, b) => {
      const av = (a[col] ?? "").toString().toLowerCase();
      const bv = (b[col] ?? "").toString().toLowerCase();
      return taxSort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [filteredTaxonomy, taxSort]);

  function toggleTaxSort(col: string) {
    setTaxSort((prev) => prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" });
  }

  const pendingCount = queue.filter((q) => q.status === "pending" && !q.archived).length;
  const archivedQueueCount = queue.filter((q) => q.archived).length;

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

      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: "resolved", resolved_at: new Date().toISOString(), archived: true } : q));
      fetch(`/api/sku-research-queue/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true }) }).catch(() => null);
      // Best-effort: write custom subtype to Ivanti if it's not in the known list
      if (item.customer_id && data.subtype.trim() && !(CI_SUBTYPES[data.type] ?? []).includes(data.subtype.trim())) {
        fetch("/api/ivanti-subtype", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer_id: item.customer_id, parent_type: data.type, subtype: data.subtype.trim() }),
        }).catch(() => null);
      }
      setExpandedId(null);
      showToast(`SKU ${item.manufacturer_sku} resolved`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setSavingId(null);
    }
  }

  // ── Archive / unarchive queue item ──────────────────────
  async function handleArchiveQueueItem(item: QueueItem) {
    try {
      await fetch(`/api/sku-research-queue/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, archived: true } : q));
      showToast(`SKU ${item.manufacturer_sku} archived`);
    } catch { showToast("Failed to archive", "err"); }
  }

  async function handleUnarchiveQueueItem(item: QueueItem) {
    try {
      await fetch(`/api/sku-research-queue/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, archived: false } : q));
      showToast(`SKU ${item.manufacturer_sku} unarchived`);
    } catch { showToast("Failed to unarchive", "err"); }
  }

  // ── Skip (soft — resurfaces next run) ─────────────────────────────────
  async function handleSkip(item: QueueItem) {
    try {
      await fetch(`/api/boh/sku-research-queue/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: "skipped" } : q));
      showToast(`SKU ${item.manufacturer_sku} skipped`);
    } catch { showToast("Failed to skip SKU", true); }
  }

  // ── Ignore (permanent) ────────────────────────────────────────────────────
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


  // ── AI Suggest (single) ────────────────────────────────────────────────
  async function handleAiSuggest(item: QueueItem) {
    setSuggestingId(item.id);
    try {
      const res = await fetch("/api/sku-research-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue_id: item.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { suggestion: TaxonomySuggestion };
      setSuggestions((prev) => ({ ...prev, [item.id]: json.suggestion }));
      setExpandedId(item.id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setSuggestingId(null);
    }
  }

  // ── Research All (batch) ───────────────────────────────────────────────
  async function handleBatchSuggest() {
    const pending = queue.filter((q) => q.status === "pending");
    if (!pending.length) return;
    setBatchResearching(true);
    setBatchProgress({ done: 0, total: pending.length });
    const newSuggestions: Record<string, TaxonomySuggestion> = {};
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      try {
        const res = await fetch("/api/sku-research-suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queue_id: item.id }),
        });
        if (res.ok) {
          const json = await res.json() as { suggestion: TaxonomySuggestion };
          newSuggestions[item.id] = json.suggestion;
        }
      } catch { /* skip failed */ }
      setBatchProgress({ done: i + 1, total: pending.length });
    }
    setSuggestions((prev) => ({ ...prev, ...newSuggestions }));
    setBatchResearching(false);
    setBatchProgress(null);
    showToast(`AI suggestions ready for ${Object.keys(newSuggestions).length} SKUs`);
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
  async function handleRunClassify(sku: string, data: { manufacturer: string; type: string; subtype: string; description: string; model: string }, customer_id?: string | null) {
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
      // Best-effort: write custom subtype to Ivanti if it's not in the known list
      if (customer_id && data.subtype.trim() && !(CI_SUBTYPES[data.type] ?? []).includes(data.subtype.trim())) {
        fetch("/api/ivanti-subtype", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer_id, parent_type: data.type, subtype: data.subtype.trim() }),
        }).catch(() => null);
      }
      setClassifyingSkuKey(null);
      showToast(`SKU ${sku} classified`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setRunClassifySaving(false);
    }
  }

  // -- Skip / ignore a SKU from the exception runs view (updates queue item if exists) --
  async function handleRunSkip(sku: string, customer_id?: string | null) {
    try {
      const queueItem = queue.find((q) => q.manufacturer_sku.trim().toLowerCase() === sku.trim().toLowerCase());
      if (queueItem) {
        await fetch(`/api/sku-research-queue/${queueItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "skipped" }),
        });
        setQueue((prev) => prev.map((q) => q.id === queueItem.id ? { ...q, status: "skipped" } : q));
      } else {
        const res = await fetch("/api/sku-research-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manufacturer_sku: sku, status: "skipped", customer_id: customer_id ?? null }),
        });
        if (res.ok) {
          const json = await res.json() as { data: QueueItem };
          if (json.data) setQueue((prev) => [...prev, json.data]);
        }
      }
      showToast(`SKU ${sku} skipped`);
    } catch { showToast("Failed to skip", "err"); }
  }

  async function handleRunIgnore(sku: string, customer_id?: string | null) {
    try {
      const queueItem = queue.find((q) => q.manufacturer_sku.trim().toLowerCase() === sku.trim().toLowerCase());
      if (queueItem) {
        await fetch(`/api/sku-research-queue/${queueItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "ignored" }),
        });
        setQueue((prev) => prev.map((q) => q.id === queueItem.id ? { ...q, status: "ignored" } : q));
      } else {
        const res = await fetch("/api/sku-research-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manufacturer_sku: sku, status: "ignored", customer_id: customer_id ?? null }),
        });
        if (res.ok) {
          const json = await res.json() as { data: QueueItem };
          if (json.data) setQueue((prev) => [...prev, json.data]);
        }
      }
      setClassifyingSkuKey(null);
      showToast(`SKU ${sku} permanently ignored`);
    } catch { showToast("Failed to ignore", "err"); }
  }

  // -- Review panel actions (Suggest All) --
  async function handleReviewSave(item: { key: string; sku: string; suggestion: TaxonomySuggestion; customerId: string | null }) {
    setReviewSavingKey(item.key);
    try {
      const res = await fetch("/api/sku-taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturer_sku: item.sku.trim().toUpperCase(), ...item.suggestion }),
      });
      if (res.ok) {
        const json = await res.json() as { data: TaxonomyEntry };
        setTaxonomy((prev) => {
          const filtered = prev.filter((t) => t.manufacturer_sku !== json.data.manufacturer_sku);
          return [...filtered, json.data].sort((a, b) => a.manufacturer_sku.localeCompare(b.manufacturer_sku));
        });
        await fetch("/api/sku-taxonomy/resolve-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manufacturer_sku: item.sku.trim().toUpperCase() }),
        }).catch(() => null);
        setSuggestAllReview((prev) => {
          if (!prev) return null;
          const remaining = prev.items.filter((i) => i.key !== item.key);
          return remaining.length > 0 ? { ...prev, items: remaining } : null;
        });
        showToast(item.sku + " saved");
      }
    } catch { showToast("Save failed", "err"); }
    setReviewSavingKey(null);
  }

  async function handleReviewSkip(item: { key: string; sku: string; customerId: string | null }) {
    await handleRunSkip(item.sku, item.customerId);
    setSuggestAllReview((prev) => {
      if (!prev) return null;
      const remaining = prev.items.filter((i) => i.key !== item.key);
      return remaining.length > 0 ? { ...prev, items: remaining } : null;
    });
  }

  async function handleReviewIgnore(item: { key: string; sku: string; customerId: string | null }) {
    await handleRunIgnore(item.sku, item.customerId);
    setSuggestAllReview((prev) => {
      if (!prev) return null;
      const remaining = prev.items.filter((i) => i.key !== item.key);
      return remaining.length > 0 ? { ...prev, items: remaining } : null;
    });
  }

  // -- AI Suggest for a SKU in the exception runs view --
  async function handleRunAiSuggest(runId: string, sku: string) {
    const key = `${runId}:${sku}`;
    setRunSuggestingKey(key);
    try {
      const queueItem = queue.find((q) => q.manufacturer_sku.trim().toLowerCase() === sku.trim().toLowerCase());
      let suggestion: TaxonomySuggestion | null = null;
      if (queueItem) {
        const res = await fetch("/api/sku-research-suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queue_id: queueItem.id }),
        });
        if (res.ok) {
          const json = await res.json() as { suggestion: TaxonomySuggestion };
          suggestion = json.suggestion;
        }
      } else {
        const res = await fetch("/api/sku-research-suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku }),
        });
        if (res.ok) {
          const json = await res.json() as { suggestion?: TaxonomySuggestion };
          suggestion = json.suggestion ?? null;
        }
      }
      if (suggestion) {
        setRunSuggestions((prev) => ({ ...prev, [key]: suggestion! }));
        setClassifyingSkuKey(key); // auto-open the form with suggestion pre-filled
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setRunSuggestingKey(null);
    }
  }

  // -- AI Suggest All for all unresolved SKUs in a run --
  async function handleRunSuggestAll(run: SkuRunException, unresolvedSkus: string[]) {
    setSuggestAllRunId(run.id);
    // Expand the run card so rows are visible
    setExpandedRunIds((prev) => { const next = new Set(prev); next.add(run.id); return next; });
    const newSuggestions: Record<string, TaxonomySuggestion> = {};
    let firstKey: string | null = null;
    await Promise.all(unresolvedSkus.map(async (sku) => {
      const key = `${run.id}:${sku}`;
      try {
        const queueItem = queue.find((q) => q.manufacturer_sku.trim().toLowerCase() === sku.trim().toLowerCase());
        let suggestion: TaxonomySuggestion | null = null;
        if (queueItem) {
          const res = await fetch("/api/sku-research-suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queue_id: queueItem.id }),
          });
          if (res.ok) suggestion = ((await res.json()) as { suggestion: TaxonomySuggestion }).suggestion;
        } else {
          const res = await fetch("/api/sku-research-suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sku }),
          });
          if (res.ok) suggestion = ((await res.json()) as { suggestion?: TaxonomySuggestion }).suggestion ?? null;
        }
        if (suggestion) {
          newSuggestions[key] = suggestion;
          if (!firstKey) firstKey = key;
        }
      } catch { /* skip failed SKU */ }
    }));
    // Open review panel instead of auto-saving
    const reviewItems = Object.entries(newSuggestions).map(([key, suggestion]) => {
      const sku = key.split(":").slice(1).join(":");
      return { key, sku, suggestion, customerId: run.customer_id ?? null };
    });
    setSuggestAllRunId(null);
    if (reviewItems.length > 0) {
      setSuggestAllReview({ runId: run.id, items: reviewItems });
    } else {
      showToast("No suggestions generated", "err");
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
    window.location.href = `/scheduler?rerun=${run.id}`;
  }

  // -- Archive / unarchive a run --
  async function handleArchive(run: SkuRunException) {
    try {
      const res = await fetch(`/api/sku-run-exceptions/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (res.ok) setRuns((prev) => prev.map((r) => r.id === run.id ? { ...r, archived: true } : r));
      showToast("Run archived");
    } catch { showToast("Failed to archive run", "err"); }
  }

  async function handleUnarchive(run: SkuRunException) {
    try {
      const res = await fetch(`/api/sku-run-exceptions/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      if (res.ok) setRuns((prev) => prev.map((r) => r.id === run.id ? { ...r, archived: false } : r));
      showToast("Run unarchived");
    } catch { showToast("Failed to unarchive run", "err"); }
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

  async function handleBulkDeleteTaxonomy() {
    if (selectedTaxIds.size === 0) return;
    setBulkDeleting(true);
    let deleted = 0;
    for (const sku of Array.from(selectedTaxIds)) {
      try {
        const res = await fetch(`/api/sku-taxonomy?sku=${encodeURIComponent(sku)}`, { method: "DELETE" });
        if (res.ok) deleted++;
      } catch {
        // continue
      }
    }
    setTaxonomy((prev) => prev.filter((t) => !selectedTaxIds.has(t.manufacturer_sku)));
    setSelectedTaxIds(new Set());
    setBulkDeleting(false);
    showToast(`${deleted} SKU${deleted !== 1 ? "s" : ""} deleted`);
  }

  return (
    <div className="flex flex-col bg-gray-950 text-white" style={{height:"calc(100vh - 44px)"}}>
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

      {/* Suggest All Review Modal */}
      {suggestAllReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-white">Review AI Suggestions</h2>
                <p className="text-xs text-gray-500 mt-0.5">{suggestAllReview.items.length} SKU{suggestAllReview.items.length !== 1 ? "s" : ""} — choose an action for each</p>
              </div>
              <button onClick={() => setSuggestAllReview(null)} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-3">
              {suggestAllReview.items.map((item) => (
                <div key={item.key} className="bg-gray-800/50 border border-gray-700/60 rounded-xl p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-semibold text-white mb-2">{item.sku}</div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      {item.suggestion.manufacturer && <div><span className="text-gray-500">Manufacturer </span><span className="text-gray-300">{item.suggestion.manufacturer}</span></div>}
                      {item.suggestion.type        && <div><span className="text-gray-500">Type </span><span className="text-gray-300">{item.suggestion.type}</span></div>}
                      {item.suggestion.subtype     && <div><span className="text-gray-500">Subtype </span><span className="text-gray-300">{item.suggestion.subtype}</span></div>}
                      {item.suggestion.model       && <div><span className="text-gray-500">Model </span><span className="text-gray-300">{item.suggestion.model}</span></div>}
                      {item.suggestion.description && <div className="col-span-2"><span className="text-gray-500">Description </span><span className="text-gray-400">{item.suggestion.description}</span></div>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button onClick={() => handleReviewSave(item)} disabled={reviewSavingKey === item.key}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/35 border border-indigo-500/30 transition-all disabled:opacity-50"
                    >{reviewSavingKey === item.key ? "Saving..." : "Save"}</button>
                    <button onClick={() => handleReviewSkip(item)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all"
                    >Skip for Now</button>
                    <button onClick={() => handleReviewIgnore(item)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all"
                    >Ignore Forever</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white flex items-center gap-2.5">
              <Tag className="w-5 h-5 text-indigo-400" />
              SKU Research
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Resolve unrecognized SKUs and rerun failed import tasks
            </p>
          </div>
          <div className="flex items-center gap-2">
            {customers.length > 0 && (
              <CustomerSwitcher customers={customers} activeCustomerId={activeCustomerId} />
            )}

            <button
              onClick={() => { setShowAddForm(true); setTab("taxonomy"); }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all"
            >
              <Plus className="w-4 h-4" />
              Add SKU
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5">
          {(["runs", "taxonomy"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? "bg-gray-800 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "runs" ? `Tasks with Exceptions (${runs.filter(r => !r.archived).length})`
               : `Taxonomy (${taxonomy.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="shrink-0 px-8 py-4 flex items-center gap-3 border-b border-gray-800/60">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU…"
            className="w-full pl-9 pr-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>

      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden px-8 py-2">

        {/* ── Queue Tab ── */}
        {/* -- Tasks with Exceptions Tab -- */}        {tab === "runs" && (
          <div className="h-full overflow-y-auto space-y-6">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">
                {runs.filter((r) => !r.archived).length} active run{runs.filter((r) => !r.archived).length !== 1 ? "s" : ""}
                {runs.some((r) => r.archived) && `, ${runs.filter((r) => r.archived).length} archived`}
              </div>
              {runs.some((r) => r.archived) && (
                <button
                  onClick={() => setShowArchived((v) => !v)}
                  className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors"
                >
                  {showArchived ? "Hide Archived" : "Show Archived"}
                </button>
              )}
            </div>
            {runs.filter((r) => showArchived ? r.archived : !r.archived).length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                {showArchived ? "No archived runs." : "No exception runs recorded yet."}
              </div>
            ) : (() => {
              const visibleRuns = runs.filter((r) => showArchived ? r.archived : !r.archived);
              return (
                <div className="space-y-3">
                  {visibleRuns.map((run) => {
                      const uniqueSkus = [...new Set(run.exceptions.map((e) => e.sku))];
                      const classifiedSkus = uniqueSkus.filter((s) => {
                        const norm = s.trim().toLowerCase();
                        return taxonomy.some((t) => t.manufacturer_sku.trim().toLowerCase() === norm) ||
                          queue.some((q) => q.manufacturer_sku.trim().toLowerCase() === norm &&
                            (q.status === "ignored" || q.status === "skipped"));
                      });
                      const allClassified = classifiedSkus.length === uniqueSkus.length;
                      const unresolvedSkus = uniqueSkus.filter((s) => !classifiedSkus.includes(s));
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
                                {run.customer_name && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">{run.customer_name}</span>
                                )}
                                {run.status === "resolved"
                                  ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Resolved</span>
                                  : allClassified
                                    ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">Ready to Rerun</span>
                                    : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">Pending ({classifiedSkus.length}/{uniqueSkus.length})</span>
                                }
                              </div>
                            </div>
                            {run.status !== "resolved" && unresolvedSkus.length > 0 && (
                              <button
                                onClick={() => handleRunSuggestAll(run, unresolvedSkus)}
                                disabled={suggestAllRunId === run.id}
                                title="AI suggest all unresolved SKUs in this run"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/20 transition-all disabled:opacity-50"
                              >
                                {suggestAllRunId === run.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <Sparkles className="w-3 h-3" />}
                                Suggest All
                              </button>
                            )}
                            {run.status !== "resolved" && (
                              <button
                                onClick={() => handleRerunJob(run)}
                                disabled={!allClassified}
                                title={allClassified ? "Rerun exception rows in scheduler" : "Resolve all SKUs first"}
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
                            {run.archived ? (
                              <button
                                onClick={() => handleUnarchive(run)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-amber-400 hover:bg-gray-800 transition-all border border-gray-800"
                                title="Unarchive this run"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Unarchive
                              </button>
                            ) : run.status === "resolved" && (
                              <button
                                onClick={() => handleArchive(run)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-all border border-gray-800"
                                title="Archive this resolved run"
                              >
                                Archive
                              </button>
                            )}
                          </div>
                          {isExpanded && (
                            <div className="border-t border-gray-800 divide-y divide-gray-800/60">
                              {uniqueSkus.map((sku) => {
                                const inTaxonomy = taxonomy.some((t) => t.manufacturer_sku.trim().toLowerCase() === sku.trim().toLowerCase());
                                const queueEntry = queue.find((q) => q.manufacturer_sku.trim().toLowerCase() === sku.trim().toLowerCase());
                                const isClassified = inTaxonomy || queueEntry?.status === "ignored" || queueEntry?.status === "skipped";
                                const skuKey = `${run.id}:${sku}`;
                                const isResolving = classifyingSkuKey === skuKey;
                                const isSuggestingThis = runSuggestingKey === skuKey;
                                const suggestion = runSuggestions[skuKey] ?? null;
                                return (
                                  <div key={sku} className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                      {isClassified
                                        ? inTaxonomy
                                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                          : <CheckCircle2 className="w-4 h-4 text-gray-500 shrink-0" />
                                        : <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
                                      }
                                      <span className="font-mono text-sm text-white">{sku}</span>
                                      <span className="text-xs text-gray-600">
                                        {run.exceptions.filter((e) => e.sku === sku).map((e) => `row ${e.row}`).join(", ")}
                                      </span>
                                      {!isClassified && (
                                        <div className="ml-auto flex items-center gap-2">
                                          <button
                                            onClick={() => handleRunAiSuggest(run.id, sku)}
                                            disabled={isSuggestingThis}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 text-xs font-medium transition-all border border-purple-500/20 disabled:opacity-50"
                                          >
                                            {isSuggestingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                            {suggestion ? "Re-suggest" : "AI Suggest"}
                                          </button>
                                          <button
                                            onClick={() => setClassifyingSkuKey(isResolving ? null : skuKey)}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 text-xs font-medium transition-all border border-indigo-500/20"
                                          >
                                            <CheckCircle2 className="w-3 h-3" />
                                            Resolve
                                          </button>
                                        </div>
                                      )}
                                      {isClassified && (
                                        <div className="ml-auto flex items-center gap-2">
                                          <span className={"text-xs font-medium " + (inTaxonomy ? "text-emerald-500" : queueEntry?.status === "skipped" ? "text-blue-400" : "text-gray-500")}>
                                            {inTaxonomy ? "Resolved" : queueEntry?.status === "skipped" ? "Skipped" : "Ignored"}
                                          </span>
                                          <button
                                            onClick={() => setClassifyingSkuKey(isResolving ? null : skuKey)}
                                            title="Edit classification"
                                            className="p-1 rounded text-gray-600 hover:text-indigo-400 hover:bg-gray-800 transition-all"
                                          >
                                            <Pencil className="w-3 h-3" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    {isResolving && (
                                      <div className="mt-3 pl-7">
                                        {!suggestion && (
                                          <div className="mb-2">
                                            <button
                                              onClick={() => handleRunAiSuggest(run.id, sku)}
                                              disabled={isSuggestingThis}
                                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 text-xs font-medium transition-all border border-purple-500/20 disabled:opacity-50"
                                            >
                                              {isSuggestingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                              {isSuggestingThis ? "Fetching..." : "AI Suggest"}
                                            </button>
                                          </div>
                                        )}
                                        <TaxonomyForm
                                          sku={sku}
                                          aiSuggestion={suggestion}
                                          saving={runClassifySaving}
                                          saveLabel="Save & Resolve"
                                          onCancel={() => setClassifyingSkuKey(null)}
                                          onSave={(data) => handleRunClassify(sku, data, run.customer_id)}
                                          onSkip={() => { handleRunSkip(sku, run.customer_id); setClassifyingSkuKey(null); }}
                                          onIgnore={() => handleRunIgnore(sku, run.customer_id)}
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
              );
            })()}
          </div>
        )}

        {tab === "taxonomy" && (
          <div className="h-full flex flex-col gap-4">
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

            {/* Bulk delete toolbar */}
            {selectedTaxIds.size > 0 && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 mb-2">
                <span className="text-sm text-red-300 font-medium">{selectedTaxIds.size} selected</span>
                <button
                  onClick={handleBulkDeleteTaxonomy}
                  disabled={bulkDeleting}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {bulkDeleting ? "Deleting..." : `Delete ${selectedTaxIds.size}`}
                </button>
                <button
                  onClick={() => setSelectedTaxIds(new Set())}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Clear selection
                </button>
              </div>
            )}

            {/* Table */}
            {filteredTaxonomy.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No taxonomy entries yet. Resolve SKUs from the queue to populate this.</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto w-full">
                <table className="text-sm" style={{minWidth:"1800px"}}>
                  <thead className="sticky top-0 z-10 bg-gray-950">
                    <tr className="text-left text-xs text-gray-600 uppercase tracking-wider border-b border-gray-800">
                      <th className="pb-2" style={{width:36,minWidth:36}}>
                        <input
                          type="checkbox"
                          checked={sortedTaxonomy.length > 0 && sortedTaxonomy.every((t) => selectedTaxIds.has(t.manufacturer_sku))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTaxIds(new Set(sortedTaxonomy.map((t) => t.manufacturer_sku)));
                            } else {
                              setSelectedTaxIds(new Set());
                            }
                          }}
                          className="accent-indigo-500 cursor-pointer"
                        />
                      </th>
                      <th className="pb-2" style={{width:80,minWidth:80}}></th>
                      {([
                        { label: "Updated",      col: "updated_at",       w: 110 },
                        { label: "SKU",         col: "manufacturer_sku", w: 200 },
                        { label: "Manufacturer", col: "manufacturer",     w: 140 },
                        { label: "Type",         col: "type",             w: 120 },
                        { label: "Subtype",      col: "subtype",          w: 150 },
                        { label: "Model",        col: "model",            w: 200 },
                        { label: "Description",  col: "description",      w: 300 },
                      ] as { label: string; col: string; w: number }[]).map(({ label, col, w }) => (
                        <th
                          key={col}
                          onClick={() => toggleTaxSort(col)}
                          style={{width: w, minWidth: w}}
                          className="pb-2 pr-4 font-semibold cursor-pointer select-none hover:text-gray-300 transition-colors"
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            {taxSort.col === col
                              ? taxSort.dir === "asc"
                                ? <ChevronUp className="w-3 h-3 text-cyan-400" />
                                : <ChevronDown className="w-3 h-3 text-cyan-400" />
                              : <ChevronDown className="w-3 h-3 opacity-20" />
                            }
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {sortedTaxonomy.map((t) => (
                      <Fragment key={t.manufacturer_sku}>
                        <tr className={`transition-colors ${editingId === t.manufacturer_sku ? "bg-indigo-950/30" : "hover:bg-gray-900/50"}`}>
                          <td className="py-2.5 pr-1" style={{width:36}}>
                            <input
                              type="checkbox"
                              checked={selectedTaxIds.has(t.manufacturer_sku)}
                              onChange={(e) => {
                                setSelectedTaxIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(t.manufacturer_sku);
                                  else next.delete(t.manufacturer_sku);
                                  return next;
                                });
                              }}
                              className="accent-indigo-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 pr-2">
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
                          <td className="py-2.5 pr-4 text-xs text-gray-500">{timeAgo(t.updated_at)}</td>
                          <td className="py-2.5 pr-4 font-mono text-white font-medium">{t.manufacturer_sku}</td>
                          <td className="py-2.5 pr-4 text-gray-300">{t.manufacturer ?? <span className="text-gray-700">—</span>}</td>
                          <td className="py-2.5 pr-4 text-gray-300">{t.type ?? <span className="text-gray-700">—</span>}</td>
                          <td className="py-2.5 pr-4 text-gray-300">{t.subtype ?? <span className="text-gray-700">—</span>}</td>
                          <td className="py-2.5 pr-4 text-gray-300">{t.model ?? <span className="text-gray-700">—</span>}</td>
                          <td className="py-2.5 pr-4 text-gray-400 max-w-[220px] truncate">{t.description ?? <span className="text-gray-700">—</span>}</td>
                          
                        </tr>
                        {editingId === t.manufacturer_sku && (
                          <tr>
                            <td colSpan={9} className="p-4 bg-gray-900/40 border-b border-gray-800">
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
