"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Users, Trash2, X, Save, Search,
  CheckCircle2, Clock, XCircle, Sparkles, TrendingUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { Lead, LeadStatus, LeadSource, TierInterest } from "@/lib/types";

// ── Meta ─────────────────────────────────────────────────────────────────────

const STATUS_META: Record<LeadStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  new:          { label: "New",          color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/25",    icon: <Sparkles    className="w-3 h-3" /> },
  contacted:    { label: "Contacted",    color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/25",icon: <Clock       className="w-3 h-3" /> },
  qualified:    { label: "Qualified",    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25",icon: <CheckCircle2 className="w-3 h-3" /> },
  disqualified: { label: "Disqualified", color: "text-gray-500",    bg: "bg-gray-500/10 border-gray-500/25",    icon: <XCircle     className="w-3 h-3" /> },
};

const TIER_LABELS: Record<TierInterest, string> = { free: "Free", pro: "Pro", master: "Master" };
const SOURCE_LABELS: Record<LeadSource, string>  = { website: "Website", referral: "Referral", cold: "Cold", event: "Event", other: "Other" };

const EMPTY: Partial<Lead> = {
  name: "", email: "", company: "", phone: "",
  tier_interest: null, source: null, status: "new", notes: "",
};

// ── Input helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500";
const selectCls = inputCls;

// ── Component ─────────────────────────────────────────────────────────────────

export default function LeadsListClient({
  leads: initial,
  userId,
}: {
  leads: Lead[];
  userId: string;
}) {
  const router  = useRouter();
  const supabase = createClient();

  const [leads,   setLeads]   = useState(initial);
  const [search,  setSearch]  = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing,   setEditing]   = useState<Partial<Lead>>(EMPTY);
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  function openNew() {
    setEditing({ ...EMPTY });
    setError(null);
    setPanelOpen(true);
  }

  function openEdit(lead: Lead) {
    setEditing({ ...lead });
    setError(null);
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    setEditing(EMPTY);
  }

  async function handleSave() {
    if (!editing.name?.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError(null);

    if (editing.id) {
      // Update
      const { error: err } = await supabase
        .from("leads")
        .update({
          name: editing.name, email: editing.email, company: editing.company,
          phone: editing.phone, tier_interest: editing.tier_interest,
          source: editing.source, status: editing.status, notes: editing.notes,
        })
        .eq("id", editing.id);
      if (err) { setError(err.message); setSaving(false); return; }
      setLeads((p) => p.map((l) => l.id === editing.id ? { ...l, ...editing } as Lead : l));
    } else {
      // Insert
      const { data, error: err } = await supabase
        .from("leads")
        .insert({
          name: editing.name, email: editing.email, company: editing.company,
          phone: editing.phone, tier_interest: editing.tier_interest,
          source: editing.source, status: editing.status, notes: editing.notes,
          created_by: userId,
        })
        .select()
        .single();
      if (err || !data) { setError(err?.message ?? "Insert failed."); setSaving(false); return; }
      setLeads((p) => [data, ...p]);
    }

    setSaving(false);
    closePanel();
  }

  async function handlePromote(lead: Lead) {
    if (!lead.email) { alert("This lead has no email address."); return; }
    if (!confirm(`Promote "${lead.name}" to an opportunity and send an onboarding email?`)) return;
    setPromoting(lead.id);
    const res = await fetch("/api/pipeline/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id }),
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error ?? "Promote failed."); setPromoting(null); return; }
    // Update lead status to contacted in local state
    setLeads((p) => p.map((l) => l.id === lead.id ? { ...l, status: "contacted" } : l));
    setPromoting(null);
    router.push("/boh/opportunities");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this lead?")) return;
    setDeleting(id);
    await supabase.from("leads").delete().eq("id", id);
    setLeads((p) => p.filter((l) => l.id !== id));
    setDeleting(null);
  }

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    return (
      l.name.toLowerCase().includes(q) ||
      (l.company ?? "").toLowerCase().includes(q) ||
      (l.email ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-indigo-400" />
          <h1 className="text-xl font-semibold text-gray-100">Leads</h1>
          <span className="text-xs bg-gray-800 border border-gray-700 text-gray-400 rounded-full px-2 py-0.5">{leads.length}</span>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Lead
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search leads…"
          className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            {search ? "No leads match your search." : "No leads yet — add one to get started."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Company</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const sm = STATUS_META[lead.status];
                return (
                  <tr key={lead.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-100">{lead.name}</div>
                      {lead.email && <div className="text-xs text-gray-500 mt-0.5">{lead.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{lead.company ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400">{lead.tier_interest ? TIER_LABELS[lead.tier_interest] : "—"}</td>
                    <td className="px-4 py-3 text-gray-400">{lead.source ? SOURCE_LABELS[lead.source] : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${sm.bg} ${sm.color}`}>
                        {sm.icon}{sm.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {lead.status !== "qualified" && lead.status !== "disqualified" && (
                          <button
                            onClick={() => handlePromote(lead)}
                            disabled={promoting === lead.id}
                            title="Promote to opportunity"
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
                          >
                            <TrendingUp className="w-3.5 h-3.5" />
                            {promoting === lead.id ? "Promoting..." : "Promote"}
                          </button>
                        )}
                        <button onClick={() => openEdit(lead)} className="p-1.5 rounded-md text-gray-600 hover:text-indigo-400 hover:bg-gray-800 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        </button>
                        <button onClick={() => handleDelete(lead.id)} disabled={deleting === lead.id} className="p-1.5 rounded-md text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors">
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
              <h2 className="text-base font-semibold text-gray-100">{editing.id ? "Edit Lead" : "New Lead"}</h2>
              <button onClick={closePanel} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 px-6 py-5 flex flex-col gap-4">
              {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>}

              <Field label="Name *">
                <input value={editing.name ?? ""} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="Jane Smith" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email">
                  <input value={editing.email ?? ""} onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))} className={inputCls} placeholder="jane@acme.com" />
                </Field>
                <Field label="Phone">
                  <input value={editing.phone ?? ""} onChange={(e) => setEditing((p) => ({ ...p, phone: e.target.value }))} className={inputCls} placeholder="555-1234" />
                </Field>
              </div>
              <Field label="Company">
                <input value={editing.company ?? ""} onChange={(e) => setEditing((p) => ({ ...p, company: e.target.value }))} className={inputCls} placeholder="Acme Corp" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Tier Interest">
                  <select value={editing.tier_interest ?? ""} onChange={(e) => setEditing((p) => ({ ...p, tier_interest: (e.target.value || null) as TierInterest | null }))} className={selectCls}>
                    <option value="">—</option>
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="master">Master</option>
                  </select>
                </Field>
                <Field label="Source">
                  <select value={editing.source ?? ""} onChange={(e) => setEditing((p) => ({ ...p, source: (e.target.value || null) as LeadSource | null }))} className={selectCls}>
                    <option value="">—</option>
                    <option value="website">Website</option>
                    <option value="referral">Referral</option>
                    <option value="cold">Cold</option>
                    <option value="event">Event</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              </div>
              <Field label="Status">
                <select value={editing.status ?? "new"} onChange={(e) => setEditing((p) => ({ ...p, status: e.target.value as LeadStatus }))} className={selectCls}>
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="qualified">Qualified</option>
                  <option value="disqualified">Disqualified</option>
                </select>
              </Field>
              <Field label="Notes">
                <textarea value={editing.notes ?? ""} onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} rows={4} className={`${inputCls} resize-none`} placeholder="Any context about this lead…" />
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
