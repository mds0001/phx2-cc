"use client";

import { useMemo, useState } from "react";
import {
  AppWindow, BookOpen, CheckCircle2, ChevronDown, ChevronRight,
  EyeOff, Fingerprint, Loader2, Plus, RefreshCw, ShieldCheck,
  SkipForward, Sparkles, Trash2, X,
} from "lucide-react";

/**
 * Software Research — the knowledge layer for Intune software normalization.
 * Three tabs:
 *   Queue      — raw detected-app strings no signature matched yet (resolve here)
 *   Signatures — matching rules (pending -> active two-step, admin activates)
 *   Catalog    — canonical licensable products
 */

interface QueueItem {
  id: string;
  raw_key: string;
  publisher: string | null;
  name: string;
  sample_version: string | null;
  seen_count: number;
  device_count: number;
  customer_id: string | null;
  context: { co_installed_sample?: string[] } | null;
  status: "pending" | "researched" | "ignored" | "skipped";
  notes: string | null;
  created_at: string;
  last_seen_at: string;
}

interface Signature {
  id: string;
  publisher: string | null;
  name_pattern: string;
  version_pattern: string | null;
  verdict: "product" | "component_of" | "noise";
  catalog_id: string | null;
  confidence: number | null;
  status: "pending" | "active" | "disabled";
  source: "ai" | "manual";
  reason: string | null;
  created_at: string;
}

interface CatalogEntry {
  id: string;
  manufacturer: string;
  title: string;
  version: string | null;
  edition: string | null;
  licensable: boolean;
  notes: string | null;
}

type Tab = "queue" | "signatures" | "catalog";

const VERDICT_LABEL: Record<Signature["verdict"], string> = {
  product: "Product",
  component_of: "Component of",
  noise: "Noise",
};

const catalogLabel = (c: CatalogEntry) =>
  [c.manufacturer, c.title, c.version, c.edition].filter(Boolean).join(" ");

function StatusBadge({ value }: { value: string }) {
  const cls =
    value === "active" || value === "researched"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
      : value === "pending"
      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
      : "bg-gray-500/10 text-gray-400 border-gray-500/30";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium ${cls}`}>
      {value}
    </span>
  );
}

export default function SoftwareResearchClient({
  initialQueue,
  initialSignatures,
  initialCatalog,
  isAdmin,
}: {
  initialQueue: QueueItem[];
  initialSignatures: Signature[];
  initialCatalog: CatalogEntry[];
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<Tab>("queue");
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [signatures, setSignatures] = useState<Signature[]>(initialSignatures);
  const [catalog, setCatalog] = useState<CatalogEntry[]>(initialCatalog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const pendingQueue = queue.filter((q) => q.status === "pending");
  const visibleQueue = showDismissed ? queue : queue.filter((q) => q.status === "pending");

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/software-research");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setQueue(json.queue ?? []);
      setSignatures(json.signatures ?? []);
      setCatalog(json.catalog ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function api(method: string, body?: Record<string, unknown>, qs?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/software-research${qs ?? ""}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function setQueueStatus(item: QueueItem, status: QueueItem["status"]) {
    if (await api("PATCH", { resource: "queue", id: item.id, status })) refresh();
  }

  async function setSignatureStatus(sig: Signature, status: Signature["status"]) {
    if (await api("PATCH", { resource: "signature", id: sig.id, status })) refresh();
  }

  async function deleteRow(resource: string, id: string, label: string) {
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    if (await api("DELETE", undefined, `?resource=${resource}&id=${id}`)) refresh();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <AppWindow className="w-6 h-6 text-teal-400" />
            Software Research
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Intune detected-app normalization — resolve raw install strings into licensable products
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm text-gray-300 transition-all disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-800">
        {([
          ["queue", `Research Queue${pendingQueue.length ? ` (${pendingQueue.length})` : ""}`, <Fingerprint key="q" className="w-4 h-4" />],
          ["signatures", `Signatures (${signatures.length})`, <ShieldCheck key="s" className="w-4 h-4" />],
          ["catalog", `Catalog (${catalog.length})`, <BookOpen key="c" className="w-4 h-4" />],
        ] as [Tab, string, React.ReactNode][]).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all ${
              tab === key
                ? "border-teal-500 text-teal-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {tab === "queue" && (
        <QueueTab
          items={visibleQueue}
          catalog={catalog}
          showDismissed={showDismissed}
          onToggleDismissed={() => setShowDismissed((v) => !v)}
          onIgnore={(i) => setQueueStatus(i, "ignored")}
          onSkip={(i) => setQueueStatus(i, "skipped")}
          onRequeue={(i) => setQueueStatus(i, "pending")}
          onResolved={refresh}
          busy={busy}
        />
      )}

      {tab === "signatures" && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Name Pattern</th>
                <th className="px-4 py-3">Publisher</th>
                <th className="px-4 py-3">Verdict</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {signatures.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No signatures yet — resolve queue items to create them.
                </td></tr>
              )}
              {signatures.map((sig) => {
                const cat = sig.catalog_id ? catalogById.get(sig.catalog_id) : null;
                return (
                  <tr key={sig.id} className="hover:bg-gray-900/50">
                    <td className="px-4 py-3 font-mono text-gray-200">{sig.name_pattern}</td>
                    <td className="px-4 py-3 text-gray-400">{sig.publisher ?? <span className="text-gray-600">any</span>}</td>
                    <td className="px-4 py-3 text-gray-300">{VERDICT_LABEL[sig.verdict]}</td>
                    <td className="px-4 py-3 text-gray-300">{cat ? catalogLabel(cat) : sig.verdict === "noise" ? "—" : "?"}</td>
                    <td className="px-4 py-3"><StatusBadge value={sig.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {sig.status !== "active" && isAdmin && (
                          <button
                            onClick={() => setSignatureStatus(sig, "active")}
                            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-xs text-emerald-400 transition-all"
                            title="Activate — signature starts matching on the next run"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Activate
                          </button>
                        )}
                        {sig.status === "active" && (
                          <button
                            onClick={() => setSignatureStatus(sig, "disabled")}
                            className="flex items-center gap-1 px-2.5 py-1 bg-gray-500/10 hover:bg-gray-500/20 border border-gray-500/30 rounded-lg text-xs text-gray-400 transition-all"
                          >
                            <EyeOff className="w-3.5 h-3.5" /> Disable
                          </button>
                        )}
                        <button
                          onClick={() => deleteRow("signature", sig.id, `signature "${sig.name_pattern}"`)}
                          className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-500 hover:text-red-400 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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

      {tab === "catalog" && (
        <CatalogTab
          catalog={catalog}
          onDelete={(c) => deleteRow("catalog", c.id, `"${catalogLabel(c)}" (its signatures cascade)`)}
          onCreated={refresh}
        />
      )}
    </div>
  );
}

// ── Queue tab with inline resolve panel ────────────────────────────────────

function QueueTab({
  items, catalog, showDismissed, onToggleDismissed,
  onIgnore, onSkip, onRequeue, onResolved, busy,
}: {
  items: QueueItem[];
  catalog: CatalogEntry[];
  showDismissed: boolean;
  onToggleDismissed: () => void;
  onIgnore: (i: QueueItem) => void;
  onSkip: (i: QueueItem) => void;
  onRequeue: (i: QueueItem) => void;
  onResolved: () => void;
  busy: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="flex justify-end mb-3">
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={showDismissed} onChange={onToggleDismissed} className="accent-teal-500" />
          Show resolved / dismissed
        </label>
      </div>
      <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
        {items.length === 0 && (
          <div className="px-4 py-10 text-center text-gray-500 text-sm">
            Queue is empty — run an Intune task with software inventory on and unmatched strings will land here.
          </div>
        )}
        {items.map((item) => (
          <div key={item.id}>
            <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-900/50">
              <button
                onClick={() => setOpenId(openId === item.id ? null : item.id)}
                className="text-gray-500 hover:text-gray-300"
              >
                {openId === item.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-200 truncate">{item.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {item.publisher || "(no publisher)"}
                  {item.sample_version ? ` · v${item.sample_version}` : ""}
                </div>
              </div>
              <div className="text-xs text-gray-500 shrink-0" title="devices / sightings">
                {item.device_count} device{item.device_count === 1 ? "" : "s"} · seen {item.seen_count}×
              </div>
              <StatusBadge value={item.status} />
              <div className="flex items-center gap-1.5 shrink-0">
                {item.status === "pending" ? (
                  <>
                    <button
                      onClick={() => setOpenId(openId === item.id ? null : item.id)}
                      className="px-2.5 py-1 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 rounded-lg text-xs text-teal-400 transition-all"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={() => onSkip(item)}
                      title="Skip — revives if seen again"
                      className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-500 hover:text-gray-300 transition-all"
                    >
                      <SkipForward className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onIgnore(item)}
                      title="Ignore permanently"
                      className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-500 hover:text-gray-300 transition-all"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => onRequeue(item)}
                    className="px-2.5 py-1 bg-gray-500/10 hover:bg-gray-500/20 border border-gray-500/30 rounded-lg text-xs text-gray-400 transition-all"
                  >
                    Re-queue
                  </button>
                )}
              </div>
            </div>
            {openId === item.id && (
              <ResolvePanel
                item={item}
                catalog={catalog}
                busy={busy}
                onDone={() => { setOpenId(null); onResolved(); }}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function ResolvePanel({
  item, catalog, busy, onDone,
}: {
  item: QueueItem;
  catalog: CatalogEntry[];
  busy: boolean;
  onDone: () => void;
}) {
  const [verdict, setVerdict] = useState<Signature["verdict"]>("product");
  const [catalogId, setCatalogId] = useState<string>("");
  const [manufacturer, setManufacturer] = useState(item.publisher ?? "");
  const [title, setTitle] = useState(item.name);
  const [version, setVersion] = useState("");
  const [edition, setEdition] = useState("");
  const [namePattern, setNamePattern] = useState(item.name);
  const [publisher, setPublisher] = useState(item.publisher ?? "");
  const [reason, setReason] = useState("");
  const [licensable, setLicensable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const coInstalled = item.context?.co_installed_sample ?? [];

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        action: "resolve",
        queue_id: item.id,
        verdict,
        name_pattern: namePattern,
        publisher: publisher || null,
        reason: reason || null,
      };
      if (verdict !== "noise") {
        if (catalogId) body.catalog_id = catalogId;
        else body.catalog = { manufacturer, title, version: version || null, edition: edition || null, licensable };
      }
      const res = await fetch("/api/software-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function suggest() {
    setSuggesting(true);
    setErr(null);
    try {
      const res = await fetch("/api/software-research-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue_id: item.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const s = json.suggestion ?? {};
      if (s.verdict) setVerdict(s.verdict);
      if (s.verdict !== "noise") {
        setCatalogId("");
        setManufacturer(s.manufacturer ?? "");
        setTitle(s.title ?? "");
        setVersion(s.version ?? "");
        setEdition(s.edition ?? "");
        setLicensable(s.licensable !== false);
      }
      if (s.name_pattern) setNamePattern(s.name_pattern);
      if (s.publisher_match !== undefined) setPublisher(s.publisher_match ?? "");
      const conf = typeof s.confidence === "number" ? ` (confidence ${(s.confidence * 100).toFixed(0)}%)` : "";
      setReason(`AI: ${s.reasoning ?? "suggested"}${conf}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  }

  const input = "bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50 w-full";

  return (
    <div className="px-12 pb-4 pt-1 bg-gray-900/40 border-t border-gray-800/60">
      {coInstalled.length > 0 && (
        <p className="text-xs text-gray-500 mb-3">
          <span className="text-gray-400 font-medium">Co-installed on the same device:</span>{" "}
          {coInstalled.join(" · ")}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-gray-500 block mb-1">Verdict</label>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value as Signature["verdict"])} className={input}>
            <option value="product">Licensable product</option>
            <option value="component_of">Component of a product</option>
            <option value="noise">Noise — not licensable</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-gray-500 block mb-1">Name Pattern (% = wildcard)</label>
          <input value={namePattern} onChange={(e) => setNamePattern(e.target.value)} className={`${input} font-mono`} />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-gray-500 block mb-1">Publisher (blank = any)</label>
          <input value={publisher} onChange={(e) => setPublisher(e.target.value)} className={input} />
        </div>
      </div>

      {verdict !== "noise" && (
        <>
          <div className="mb-3">
            <label className="text-[11px] uppercase tracking-wider text-gray-500 block mb-1">
              {verdict === "product" ? "Catalog product this string IS" : "Catalog product this component EVIDENCES"}
            </label>
            <select value={catalogId} onChange={(e) => setCatalogId(e.target.value)} className={input}>
              <option value="">— create new product below —</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>{catalogLabel(c)}</option>
              ))}
            </select>
          </div>
          {!catalogId && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-gray-500 block mb-1">Manufacturer</label>
                <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={input} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-gray-500 block mb-1">Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-gray-500 block mb-1">Version</label>
                <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="optional" className={input} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-gray-500 block mb-1">Edition</label>
                <input value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="optional" className={input} />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer md:col-span-4">
                <input type="checkbox" checked={licensable} onChange={(e) => setLicensable(e.target.checked)} className="accent-teal-500" />
                Licensable — counts toward license reconciliation (uncheck for free software)
              </label>
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-3">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason / notes (optional)"
          className={`${input} flex-1`}
        />
        <button
          onClick={suggest}
          disabled={suggesting || busy}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600/80 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-all shrink-0"
        >
          {suggesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          AI Suggest
        </button>
        <button
          onClick={save}
          disabled={saving || busy || !namePattern.trim() || (verdict !== "noise" && !catalogId && (!manufacturer.trim() || !title.trim()))}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-all shrink-0"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Save as pending signature
        </button>
      </div>
      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
      <p className="text-[11px] text-gray-600 mt-2">
        Signatures start as <span className="text-amber-400">pending</span> — an administrator activates them before they match.
      </p>
    </div>
  );
}

// ── Catalog tab ─────────────────────────────────────────────────────────────

function CatalogTab({
  catalog, onDelete, onCreated,
}: {
  catalog: CatalogEntry[];
  onDelete: (c: CatalogEntry) => void;
  onCreated: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [manufacturer, setManufacturer] = useState("");
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [edition, setEdition] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/software-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "catalog",
          catalog: { manufacturer, title, version: version || null, edition: edition || null, licensable: true },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setAdding(false);
      setManufacturer(""); setTitle(""); setVersion(""); setEdition("");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const input = "bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50 w-full";

  return (
    <>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 rounded-lg text-xs text-teal-400 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Add product
        </button>
      </div>
      {adding && (
        <div className="mb-4 p-4 bg-gray-900/50 border border-gray-800 rounded-xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Manufacturer" className={input} />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={input} />
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version (optional)" className={input} />
            <input value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="Edition (optional)" className={input} />
          </div>
          <button
            onClick={save}
            disabled={saving || !manufacturer.trim() || !title.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-all"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create
          </button>
          {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900 text-left text-xs uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">Manufacturer</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Edition</th>
              <th className="px-4 py-3">Licensable</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {catalog.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                No catalog products yet.
              </td></tr>
            )}
            {catalog.map((c) => (
              <tr key={c.id} className="hover:bg-gray-900/50">
                <td className="px-4 py-3 text-gray-300">{c.manufacturer}</td>
                <td className="px-4 py-3 text-gray-200">{c.title}</td>
                <td className="px-4 py-3 text-gray-400">{c.version ?? "—"}</td>
                <td className="px-4 py-3 text-gray-400">{c.edition ?? "—"}</td>
                <td className="px-4 py-3">
                  {c.licensable
                    ? <span className="text-emerald-400 text-xs">yes</span>
                    : <span className="text-gray-500 text-xs">no</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <button
                      onClick={() => onDelete(c)}
                      className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-500 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
