"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Trash2, CheckCircle2, Ban, Loader2, X, AlertTriangle, RotateCcw } from "lucide-react";
import type { CustomerOption } from "@/components/CustomerSwitcher";

// ── Types ────────────────────────────────────────────────────────────────
interface Override {
  id: string;
  customer_id: string;
  manufacturer_sku: string;
  manufacturer: string | null;
  type: string | null;
  subtype: string | null;
  description: string | null;
  model: string | null;
  sw_title: string | null;
  sw_version: string | null;
  sw_edition: string | null;
  ignore: boolean | null;
  status: "pending" | "active" | "disabled";
  reason: string;
  global_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const CLASS_FIELDS = [
  "manufacturer", "type", "subtype", "description", "model",
  "sw_title", "sw_version", "sw_edition",
] as const;
type ClassField = (typeof CLASS_FIELDS)[number];

const FIELD_LABEL: Record<ClassField, string> = {
  manufacturer: "Manufacturer", type: "Type", subtype: "Subtype",
  description: "Description", model: "Model",
  sw_title: "SW Title", sw_version: "SW Version", sw_edition: "SW Edition",
};

type Drift = "orphaned" | "stale" | "redundant" | null;

/** Compare an override against the live global row and its creation snapshot. */
function classifyDrift(o: Override, global: Record<string, unknown> | undefined): Drift {
  if (!global) return "orphaned";
  const snap = o.global_snapshot ?? {};
  const setFields = CLASS_FIELDS.filter((f) => o[f] != null);
  const redundant =
    setFields.length > 0 &&
    setFields.every((f) => o[f] === (global[f] ?? null)) &&
    (o.ignore == null || o.ignore === (global.ignore ?? false));
  if (redundant) return "redundant";
  const stale =
    CLASS_FIELDS.some((f) => (snap[f] ?? null) !== (global[f] ?? null)) ||
    (snap.ignore ?? null) !== (global.ignore ?? null);
  return stale ? "stale" : null;
}

const emptyForm = {
  manufacturer_sku: "", manufacturer: "", type: "", subtype: "", description: "",
  model: "", sw_title: "", sw_version: "", sw_edition: "", ignore: "inherit", reason: "",
};
type FormState = typeof emptyForm;

function StatusPill({ status }: { status: Override["status"] }) {
  const cfg = {
    pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    disabled: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  }[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg}`}>
      {status}
    </span>
  );
}

function DriftPill({ drift }: { drift: Drift }) {
  if (!drift) return null;
  const cfg = {
    orphaned: { cls: "bg-rose-500/15 text-rose-400 border-rose-500/30", label: "Orphaned" },
    stale: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: "Stale" },
    redundant: { cls: "bg-sky-500/15 text-sky-400 border-sky-500/30", label: "Redundant" },
  }[drift];
  return (
    <span
      title={
        drift === "orphaned" ? "No global taxonomy row for this SKU"
          : drift === "stale" ? "Global row changed since this override was created — review it"
          : "Every overridden field equals the current global value — this override is a no-op"
      }
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.cls}`}
    >
      <AlertTriangle className="w-3 h-3" /> {cfg.label}
    </span>
  );
}

export default function SkuOverridesPanel({
  customers,
  activeCustomerId,
  isAdmin,
  globalBySku,
}: {
  customers: CustomerOption[];
  activeCustomerId: string | null;
  isAdmin: boolean;
  globalBySku: Record<string, Record<string, unknown>>;
}) {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerId, setCustomerId] = useState<string>(activeCustomerId ?? "");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = isAdmin && customerId ? `?customer_id=${encodeURIComponent(customerId)}` : "";
    try {
      const res = await fetch(`/api/sku-overrides${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load overrides");
      setOverrides(json.data ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, customerId]);

  useEffect(() => { load(); }, [load]);

  const ignoreToBool = (v: string): boolean | null =>
    v === "ignore" ? true : v === "include" ? false : null;

  async function handleCreate() {
    const targetCustomer = isAdmin ? customerId : activeCustomerId;
    if (!targetCustomer) { setError("Pick a customer first."); return; }
    if (!form.manufacturer_sku.trim()) { setError("SKU is required."); return; }
    if (!form.reason.trim()) { setError("Reason is required."); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        customer_id: targetCustomer,
        manufacturer_sku: form.manufacturer_sku,
        reason: form.reason,
        ignore: ignoreToBool(form.ignore),
      };
      for (const f of CLASS_FIELDS) body[f] = form[f];
      const res = await fetch("/api/sku-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Create failed");
      setShowForm(false);
      setForm(emptyForm);
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function patchOverride(id: string, patch: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await fetch("/api/sku-overrides", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteOverride(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/sku-overrides?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Delete failed");
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const withDrift = useMemo(
    () => overrides.map((o) => ({ o, drift: classifyDrift(o, globalBySku[o.manufacturer_sku]) })),
    [overrides, globalBySku],
  );
  const driftCounts = useMemo(() => {
    const c = { orphaned: 0, stale: 0, redundant: 0 };
    for (const { drift } of withDrift) if (drift) c[drift]++;
    return c;
  }, [withDrift]);

  const canCreate = isAdmin ? !!customerId : !!activeCustomerId;
  const custName = (id: string) => customers.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {isAdmin && (
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-1.5"
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => { setForm(emptyForm); setShowForm((v) => !v); setError(null); }}
          disabled={!canCreate}
          title={canCreate ? "Add a customer override" : "Select a customer first"}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/40 text-violet-300 rounded-lg text-sm font-semibold disabled:opacity-40"
        >
          <Plus className="w-4 h-4" /> New override
        </button>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-sm">
          <RotateCcw className="w-3.5 h-3.5" /> Refresh
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          {driftCounts.orphaned > 0 && <span className="text-rose-400">{driftCounts.orphaned} orphaned</span>}
          {driftCounts.stale > 0 && <span className="text-amber-400">{driftCounts.stale} stale</span>}
          {driftCounts.redundant > 0 && <span className="text-sky-400">{driftCounts.redundant} redundant</span>}
          <span>{overrides.length} override{overrides.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between px-3 py-2 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-lg text-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="p-4 bg-gray-900/60 border border-gray-700 rounded-xl space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <label className="text-xs text-gray-400 col-span-2 md:col-span-1">
              Manufacturer SKU *
              <input
                value={form.manufacturer_sku}
                onChange={(e) => setForm({ ...form, manufacturer_sku: e.target.value })}
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100 uppercase"
              />
            </label>
            {CLASS_FIELDS.map((f) => (
              <label key={f} className="text-xs text-gray-400">
                {FIELD_LABEL[f]}
                <input
                  value={form[f]}
                  onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                  placeholder="inherit global"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100"
                />
              </label>
            ))}
            <label className="text-xs text-gray-400">
              Ignore
              <select
                value={form.ignore}
                onChange={(e) => setForm({ ...form, ignore: e.target.value })}
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100"
              >
                <option value="inherit">Inherit global</option>
                <option value="ignore">Ignore for this customer</option>
                <option value="include">Force include (beat global ignore)</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-gray-400">
            Reason * <span className="text-gray-500">(required — why this customer differs)</span>
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-violet-200 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create as pending
            </button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-gray-400 hover:text-gray-200 text-sm">Cancel</button>
            <span className="text-xs text-gray-500">Created as <b>pending</b>; an administrator activates it.</span>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading overrides…
        </div>
      ) : overrides.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-10">No overrides{isAdmin && !customerId ? " yet" : " for this customer"}.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                <th className="py-2 pr-3">SKU</th>
                {isAdmin && <th className="py-2 pr-3">Customer</th>}
                <th className="py-2 pr-3">Overrides</th>
                <th className="py-2 pr-3">Ignore</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Drift</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {withDrift.map(({ o, drift }) => (
                <tr key={o.id} className="border-b border-gray-800/60 align-top">
                  <td className="py-2 pr-3 font-mono text-gray-200 whitespace-nowrap">{o.manufacturer_sku}</td>
                  {isAdmin && <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{custName(o.customer_id)}</td>}
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {CLASS_FIELDS.filter((f) => o[f] != null).map((f) => (
                        <span key={f} className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-[11px] text-gray-300">
                          {FIELD_LABEL[f]}: <b className="ml-1 text-gray-100">{String(o[f])}</b>
                        </span>
                      ))}
                      {CLASS_FIELDS.every((f) => o[f] == null) && <span className="text-gray-600 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">
                    {o.ignore == null ? <span className="text-gray-500">inherit</span>
                      : o.ignore ? <span className="text-rose-400">ignore</span>
                      : <span className="text-emerald-400">force-include</span>}
                  </td>
                  <td className="py-2 pr-3"><StatusPill status={o.status} /></td>
                  <td className="py-2 pr-3"><DriftPill drift={drift} /></td>
                  <td className="py-2 pr-3 text-gray-400 text-xs max-w-[220px]">{o.reason}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-1.5 justify-end">
                      {busyId === o.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                      ) : (
                        <>
                          {isAdmin && o.status !== "active" && (
                            <button
                              onClick={() => patchOverride(o.id, { status: "active" })}
                              title="Activate (admin)"
                              className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {o.status !== "disabled" && (
                            <button
                              onClick={() => patchOverride(o.id, { status: "disabled" })}
                              title="Disable"
                              className="p-1.5 rounded-lg bg-gray-700/40 hover:bg-gray-700 border border-gray-600 text-gray-300"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {o.status === "disabled" && (
                            <button
                              onClick={() => patchOverride(o.id, { status: "pending" })}
                              title="Re-open as pending"
                              className="p-1.5 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-400"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteOverride(o.id)}
                            title="Delete"
                            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
