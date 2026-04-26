"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, TrendingUp, Trash2, X, Save, Search,
  CheckCircle2, Clock, XCircle, Trophy,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { Opportunity, OpportunityStatus, TierInterest } from "@/lib/types";

// ── Meta ─────────────────────────────────────────────────────────────────────

const STATUS_META: Record<OpportunityStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  active: { label: "Active", color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/25",    icon: <Clock        className="w-3 h-3" /> },
  won:    { label: "Won",    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25",icon: <Trophy       className="w-3 h-3" /> },
  lost:   { label: "Lost",   color: "text-gray-500",    bg: "bg-gray-500/10 border-gray-500/25",    icon: <XCircle      className="w-3 h-3" /> },
};

const TIER_LABELS: Record<TierInterest, string> = { free: "Free", pro: "Pro", master: "Master" };

type OpportunityWithLead = Opportunity & {
  leads: { name: string; email: string | null; company: string | null } | null;
};

type LeadOption = { id: string; name: string; email: string | null; company: string | null };

const EMPTY: Partial<Opportunity> = {
  lead_id: null, tier: null, estimated_close_date: null, status: "active", notes: "",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls  = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500";
const selectCls = inputCls;

// ── Component ─────────────────────────────────────────────────────────────────

export default function OpportunitiesListClient({
  opportunities: initial,
  leads,
  userId,
}: {
  opportunities: OpportunityWithLead[];
  leads: LeadOption[];
  userId: string;
}) {
  const router   = useRouter();
  const supabase = createClient();

  const [opps,      setOpps]      = useState(initial);
  const [search,    setSearch]    = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing,   setEditing]   = useState<Partial<Opportunity>>(EMPTY);
  const [saving,    setSaving]    = useState(false);
  const [converting, setConverting] = useState<string | null>(null);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  function openNew() { setEditing({ ...EMPTY }); setError(null); setPanelOpen(true); }
  function openEdit(o: OpportunityWithLead) { setEditing({ ...o }); setError(null); setPanelOpen(true); }
  function closePanel() { setPanelOpen(false); setEditing(EMPTY); }

  async function handleSave() {
    setSaving(true); setError(null);
    if (editing.id) {
      const { error: err } = await supabase.from("opportunities").update({
        lead_id: editing.lead_id, tier: editing.tier,
        estimated_close_date: editing.estimated_close_date || null,
        status: editing.status, notes: editing.notes,
      }).eq("id", editing.id);
      if (err) { setError(err.message); setSaving(false); return; }
      setOpps((p) => p.map((o) => o.id === editing.id ? { ...o, ...editing } as OpportunityWithLead : o));
    } else {
      const { data, error: err } = await supabase.from("opportunities").insert({
        lead_id: editing.lead_id, tier: editing.tier,
        estimated_close_date: editing.estimated_close_date || null,
        status: editing.status, notes: editing.notes,
        created_by: userId,
      }).select("*, leads(name, email, company)").single();
      if (err || !data) { setError(err?.message ?? "Insert failed."); setSaving(false); return; }
      setOpps((p) => [data, ...p]);
    }
    setSaving(false);
    closePanel();
  }

  async function handleConvert(opp: OpportunityWithLead) {
    if (!confirm(`Convert "${opp.leads?.name ?? "this opportunity"}" to a customer and send an invite?`)) return;
    setConverting(opp.id);
    const res = await fetch("/api/pipeline/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunityId: opp.id }),
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error ?? "Convert failed."); setConverting(null); return; }
    // Mark won in local state
    setOpps((p) => p.map((o) => o.id === opp.id ? { ...o, status: "won" } : o));
    setConverting(null);
    router.push("/boh/customers");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this opportunity?")) return;
    setDeleting(id);
    await supabase.from("opportunities").delete().eq("id", id);
    setOpps((p) => p.filter((o) => o.id !== id));
    setDeleting(null);
  }

  const filtered = opps.filter((o) => {
    const q = search.toLowerCase();
    return (
      (o.leads?.name ?? "").toLowerCase().includes(q) ||
      (o.leads?.company ?? "").toLowerCase().includes(q) ||
      (o.tier ?? "").toLowerCase().includes(q)
    );
  });

  const activeCount = opps.filter((o) => o.status === "active").length;

  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-indigo-400" />
          <h1 className="text-xl font-semibold text-gray-100">Opportunities</h1>
          {activeCount > 0 && (
            <span className="text-xs bg-indigo-500/15 border border-indigo-500/25 text-indigo-400 rounded-full px-2 py-0.5">{activeCount} active</span>
          )}
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Opportunity
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search opportunities…"
          className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            {search ? "No opportunities match your search." : "No opportunities yet."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Lead</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Est. Close</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((opp) => {
                const sm = STATUS_META[opp.status];
                return (
                  <tr key={opp.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-100">{opp.leads?.name ?? "—"}</div>
                      {opp.leads?.company && <div className="text-xs text-gray-500 mt-0.5">{opp.leads.company}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{opp.tier ? TIER_LABELS[opp.tier] : "—"}</td>
                    <td className="px-4 py-3 text-gray-400">{opp.estimated_close_date ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${sm.bg} ${sm.color}`}>
                        {sm.icon}{sm.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {opp.status === "active" && (
                          <button
                            onClick={() => handleConvert(opp)}
                            disabled={converting === opp.id}
                            title="Convert to customer"
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                          >
                            <Trophy className="w-3.5 h-3.5" />
                            {converting === opp.id ? "Converting…" : "Convert"}
                          </button>
                        )}
                        <button onClick={() => openEdit(opp)} className="p-1.5 rounded-md text-gray-600 hover:text-indigo-400 hover:bg-gray-800 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        </button>
                        <button onClick={() => handleDelete(opp.id)} disabled={deleting === opp.id} className="p-1.5 rounded-md text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Slide-over panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={closePanel} />
          <div className="w-[420px] bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
              <h2 className="text-base font-semibold text-gray-100">{editing.id ? "Edit Opportunity" : "New Opportunity"}</h2>
              <button onClick={closePanel} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 px-6 py-5 flex flex-col gap-4">
              {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>}

              <Field label="Lead">
                <select value={editing.lead_id ?? ""} onChange={(e) => setEditing((p) => ({ ...p, lead_id: e.target.value || null }))} className={selectCls}>
                  <option value="">— Select a lead —</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}{l.company ? ` (${l.company})` : ""}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Tier">
                  <select value={editing.tier ?? ""} onChange={(e) => setEditing((p) => ({ ...p, tier: (e.target.value || null) as TierInterest | null }))} className={selectCls}>
                    <option value="">—</option>
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="master">Master</option>
                  </select>
                </Field>
                <Field label="Est. Close Date">
                  <input type="date" value={editing.estimated_close_date ?? ""} onChange={(e) => setEditing((p) => ({ ...p, estimated_close_date: e.target.value || null }))} className={inputCls} />
                </Field>
              </div>
              <Field label="Status">
                <select value={editing.status ?? "active"} onChange={(e) => setEditing((p) => ({ ...p, status: e.target.value as OpportunityStatus }))} className={selectCls}>
                  <option value="active">Active</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </Field>
              <Field label="Notes">
                <textarea value={editing.notes ?? ""} onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} rows={4} className={`${inputCls} resize-none`} placeholder="Any context…" />
              </Field>
            </div>

            <div className="shrink-0 px-6 py-4 border-t border-gray-800 flex gap-3">
              <button onClick={closePanel} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                <Save className="w-4 h-4" />{saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
