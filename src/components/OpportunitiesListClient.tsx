"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, TrendingUp, Trash2, X, Save, Search,
  CheckCircle2, Clock, XCircle, Trophy, Mail, Minus,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { Opportunity, OpportunityStatus, TierInterest, LicenseType, QuoteConfig, QuoteConfigEndpoint } from "@/lib/types";
import QuoteBuilderPanel from "@/components/QuoteBuilderPanel";

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
  quote_config: null, send_to_admin: false,
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

function computeOppTotal(opp: OpportunityWithLead, licenseTypes: LicenseType[]): { cents: number; label: string } | null {
  if (opp.tier === "free") return { cents: 0, label: "Free" };
  if (opp.quote_config?.customPriceCents != null) {
    const label = opp.tier === "master" ? ((opp.quote_config.masterTerm ?? 1) === 3 ? "3yr" : "1yr") : opp.tier === "pro" ? (opp.quote_config.proTerm === "annual" ? "/yr" : "/mo") : "";
    return { cents: opp.quote_config.customPriceCents, label };
  }
  if (opp.tier === "master") {
    const term = opp.quote_config?.masterTerm ?? 1;
    const targetDays = term === 3 ? 1095 : 365;
    const lt = licenseTypes.find((l) => l.type === "subscription" && l.duration_days === targetDays)
            ?? licenseTypes.find((l) => l.type === "subscription");
    if (!lt) return null;
    return { cents: lt.price_cents, label: term === 3 ? "3yr" : "1yr" };
  }
  if (opp.tier === "pro") {
    const eps = opp.quote_config?.proEndpoints ?? [];
    if (eps.length === 0) return null;
    const isAnnual = opp.quote_config?.proTerm === "annual";
    const cents = eps.reduce((sum, ep) => {
      const lt = licenseTypes.find((l) => l.id === ep.licenseTypeId);
      if (!lt) return sum;
      return sum + (isAnnual && lt.yearly_price_cents != null ? lt.yearly_price_cents : lt.price_cents) * ep.qty;
    }, 0);
    return { cents, label: isAnnual ? "/yr" : "/mo" };
  }
  return null;
}

function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

// ── Component ─────────────────────────────────────────────────────────────────

function EditablePriceRow({ termLabel, listCents, displayCents, onChange, onReset }: {
  termLabel: string; listCents: number; displayCents: number;
  onChange: (cents: number) => void; onReset: () => void;
}) {
  const isCustom = displayCents !== listCents;
  return (
    <div className="flex flex-col gap-2 px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-400">Quote Total</span>
          <span className="text-xs text-gray-600">{termLabel}</span>
        </div>
        {isCustom && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 line-through">{formatUSD(listCents)}</span>
            <button type="button" onClick={onReset} className="text-xs text-gray-600 hover:text-indigo-400 transition-colors">Reset</button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-500 text-sm font-medium">$</span>
        <input
          type="number" min={0} step={1}
          value={(displayCents / 100).toFixed(2)}
          onChange={(e) => onChange(Math.round(parseFloat(e.target.value || "0") * 100))}
          className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-base font-bold text-gray-100 focus:outline-none focus:border-indigo-500"
        />
      </div>
    </div>
  );
}

export default function OpportunitiesListClient({
  opportunities: initial,
  leads,
  licenseTypes,
  userId,
}: {
  opportunities: OpportunityWithLead[];
  leads: LeadOption[];
  licenseTypes: LicenseType[];
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
  const [quoteOpp, setQuoteOpp] = useState<OpportunityWithLead | null>(null);

  function openNew() { setEditing({ ...EMPTY }); setError(null); setPanelOpen(true); }
  function openEdit(o: OpportunityWithLead) { setEditing({ ...o }); setError(null); setPanelOpen(true); }
  function closePanel() { setPanelOpen(false); setEditing(EMPTY); }

  async function provisionLicense(opp: OpportunityWithLead) {
    const lead = opp.leads;
    if (!lead || !editing.tier) return;
    // Create a Customer stub from the lead
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .insert({ name: lead.name, email: lead.email, company: lead.company, created_by: userId })
      .select("id").single();
    if (custErr || !customer) return;

    const today = new Date().toISOString().split("T")[0];

    if (editing.tier === "free") {
      await supabase.from("customer_licenses").insert({
        customer_id: customer.id, product_name: "Threads Free",
        start_date: today, status: "active",
      });
    } else if (editing.tier === "master") {
      const termYears = editing.quote_config?.masterTerm ?? 1;
      const targetDays = termYears === 3 ? 1095 : 365;
      const masterLt = licenseTypes.find((lt) => lt.type === "subscription" && lt.duration_days === targetDays)
                    ?? licenseTypes.find((lt) => lt.type === "subscription");
      if (!masterLt) return;
      const days = masterLt.duration_days ?? targetDays;
      const expiry = new Date(); expiry.setDate(expiry.getDate() + days);
      await supabase.from("customer_licenses").insert({
        customer_id: customer.id, license_type_id: masterLt.id,
        product_name: "Threads Master",
        start_date: today, expiry_date: expiry.toISOString().split("T")[0],
        status: "active",
      });
    } else if (editing.tier === "pro") {
      const eps = editing.quote_config?.proEndpoints ?? [];
      for (const ep of eps) {
        const lt = licenseTypes.find((l) => l.id === ep.licenseTypeId);
        if (!lt) continue;
        await supabase.from("customer_licenses").insert({
          customer_id: customer.id, license_type_id: lt.id,
          product_name: `Threads Pro — ${lt.name}`,
          seats: ep.qty, start_date: today, status: "active",
        });
      }
    }
  }

  async function handleSave() {
    setSaving(true); setError(null);
    if (editing.id) {
      const originalOpp = opps.find((o) => o.id === editing.id);
      const isNewWin = editing.status === "won" && originalOpp?.status !== "won";
      const { error: err } = await supabase.from("opportunities").update({
        lead_id: editing.lead_id, tier: editing.tier,
        estimated_close_date: editing.estimated_close_date || null,
        status: editing.status, notes: editing.notes,
        quote_config: editing.quote_config ?? null,
        send_to_admin: editing.send_to_admin ?? false,
      }).eq("id", editing.id);
      if (err) { setError(err.message); setSaving(false); return; }
      setOpps((p) => p.map((o) => o.id === editing.id ? { ...o, ...editing } as OpportunityWithLead : o));
      if (isNewWin && originalOpp) await provisionLicense(originalOpp);
    } else {
      const { data, error: err } = await supabase.from("opportunities").insert({
        lead_id: editing.lead_id, tier: editing.tier,
        estimated_close_date: editing.estimated_close_date || null,
        status: editing.status, notes: editing.notes,
        quote_config: editing.quote_config ?? null,
        send_to_admin: editing.send_to_admin ?? false,
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

  function handleSendQuote(opp: OpportunityWithLead) {
    setQuoteOpp(opp);
  }

  function handleQuoteSent(sentAt: string, quoteNumber: string) {
    if (quoteOpp) {
      setOpps((p) => p.map((o) => o.id === quoteOpp.id ? { ...o, quote_sent_at: sentAt } : o));
    }
    setQuoteOpp(null);
    alert("Quote " + quoteNumber + " sent successfully.");
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
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Value</th>
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
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const tot = computeOppTotal(opp, licenseTypes);
                        if (!tot) return <span className="text-xs text-gray-600">—</span>;
                        if (tot.cents === 0) return <span className="text-sm font-medium text-emerald-400">Free</span>;
                        return (
                          <div className="text-right">
                            <span className="text-sm font-semibold text-gray-100">{formatUSD(tot.cents)}</span>
                            <span className="text-xs text-gray-600 ml-1">{tot.label}</span>
                          </div>
                        );
                      })()}
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
                        {opp.status === "active" && (
                          <button
                            onClick={() => handleSendQuote(opp)}
                            title="Send quote to lead"
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-sky-500/10 border border-sky-500/25 text-sky-400 hover:bg-sky-500/20 transition-colors"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            Send Quote
                          </button>
                        )}
                        {opp.quote_sent_at && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-500" title={`Quote sent ${new Date(opp.quote_sent_at).toLocaleString()}`}>
                            <Mail className="w-3 h-3" />
                            Quoted
                          </span>
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

              {/* Master: term */}
              {editing.tier === "master" && (
                <Field label="Term">
                  <div className="flex gap-2">
                    {([1, 3] as const).map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => setEditing((p) => ({ ...p, quote_config: { ...(p.quote_config ?? {}), masterTerm: yr } }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          (editing.quote_config?.masterTerm ?? 1) === yr
                            ? "bg-indigo-600 border-indigo-500 text-white"
                            : "bg-gray-800 border-gray-700 text-gray-400 hover:border-indigo-500"
                        }`}
                      >
                        {yr} Year{yr === 3 ? "s" : ""}
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              {/* Pro: term */}
              {editing.tier === "pro" && (
                <Field label="Billing Term">
                  <div className="flex gap-2">
                    {(["monthly", "annual"] as const).map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => setEditing((p) => ({ ...p, quote_config: { ...(p.quote_config ?? {}), proTerm: term } }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          (editing.quote_config?.proTerm ?? "monthly") === term
                            ? "bg-indigo-600 border-indigo-500 text-white"
                            : "bg-gray-800 border-gray-700 text-gray-400 hover:border-indigo-500"
                        }`}
                      >
                        {term === "monthly" ? "Monthly" : "Annual (save 2 mo.)"}
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              {/* Pro: endpoint line items */}
              {editing.tier === "pro" && (() => {
                const byEndpoint = licenseTypes.filter((lt) => lt.type === "by_endpoint");
                const addedIds = (editing.quote_config?.proEndpoints ?? []).map((ep) => ep.licenseTypeId);
                const available = byEndpoint.filter((lt) => !addedIds.includes(lt.id));
                return (
                  <Field label="Connections">
                    <div className="flex flex-col gap-2">
                      {/* Already-added connections */}
                      {(editing.quote_config?.proEndpoints ?? []).map((ep, idx) => {
                        const lt = byEndpoint.find((l) => l.id === ep.licenseTypeId);
                        return (
                          <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-gray-800/60 border border-gray-700 rounded-lg">
                            <span className="flex-1 text-sm text-gray-200">{lt?.name ?? "Unknown"}</span>
                            <input
                              type="number"
                              min={1}
                              value={ep.qty}
                              onChange={(e) => {
                                const eps = [...(editing.quote_config?.proEndpoints ?? [])];
                                eps[idx] = { ...eps[idx], qty: Math.max(1, parseInt(e.target.value) || 1) };
                                setEditing((p) => ({ ...p, quote_config: { ...(p.quote_config ?? {}), proEndpoints: eps } }));
                              }}
                              className="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 text-center focus:outline-none focus:border-indigo-500"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const eps = (editing.quote_config?.proEndpoints ?? []).filter((_, i) => i !== idx);
                                setEditing((p) => ({ ...p, quote_config: { ...(p.quote_config ?? {}), proEndpoints: eps } }));
                              }}
                              className="p-1 rounded text-gray-600 hover:text-red-400 transition-colors"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                      {/* Add-from-dropdown — always visible while there are options left */}
                      {available.length > 0 ? (
                        <select
                          value=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const eps = [...(editing.quote_config?.proEndpoints ?? []), { licenseTypeId: e.target.value, qty: 1 }];
                            setEditing((p) => ({ ...p, quote_config: { ...(p.quote_config ?? {}), proEndpoints: eps } }));
                          }}
                          className={selectCls}
                        >
                          <option value="">+ Add connection type…</option>
                          {available.map((lt) => (
                            <option key={lt.id} value={lt.id}>{lt.name}</option>
                          ))}
                        </select>
                      ) : byEndpoint.length === 0 ? (
                        <p className="text-xs text-gray-500 py-1">No connection types configured in License Types.</p>
                      ) : null}
                    </div>
                  </Field>
                );
              })()}

              {/* Live quote total */}
              {editing.tier && (() => {
                if (editing.tier === "free") {
                  return (
                    <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                      <span className="text-sm font-medium text-gray-400">Quote Total</span>
                      <span className="text-base font-bold text-emerald-400">Free</span>
                    </div>
                  );
                }
                if (editing.tier === "master") {
                  const term = editing.quote_config?.masterTerm ?? 1;
                  const targetDays = term === 3 ? 1095 : 365;
                  const masterLt = licenseTypes.find((lt) => lt.type === "subscription" && lt.duration_days === targetDays)
                                ?? licenseTypes.find((lt) => lt.type === "subscription");
                  if (!masterLt) return null;
                  const listCents = masterLt.price_cents;
                  const customCents = editing.quote_config?.customPriceCents;
                  const displayCents = customCents ?? listCents;
                  const termLabel = term === 3 ? "3-year contract" : "annual";
                  return <EditablePriceRow termLabel={termLabel} listCents={listCents} displayCents={displayCents}
                    onChange={(cents) => setEditing((p) => ({ ...p, quote_config: { ...(p.quote_config ?? {}), customPriceCents: cents } }))}
                    onReset={() => setEditing((p) => { const q = { ...(p.quote_config ?? {}) }; delete q.customPriceCents; return { ...p, quote_config: q }; })} />;
                }
                if (editing.tier === "pro") {
                  const endpoints = editing.quote_config?.proEndpoints ?? [];
                  if (endpoints.length === 0) return null;
                  const isAnnual = editing.quote_config?.proTerm === "annual";
                  const listCents = endpoints.reduce((sum, ep) => {
                    const lt = licenseTypes.find((l) => l.id === ep.licenseTypeId);
                    if (!lt) return sum;
                    const price = isAnnual && lt.yearly_price_cents != null ? lt.yearly_price_cents : lt.price_cents;
                    return sum + price * ep.qty;
                  }, 0);
                  const customCents = editing.quote_config?.customPriceCents;
                  const displayCents = customCents ?? listCents;
                  const termLabel = isAnnual ? "per year" : "per month";
                  return <EditablePriceRow termLabel={termLabel} listCents={listCents} displayCents={displayCents}
                    onChange={(cents) => setEditing((p) => ({ ...p, quote_config: { ...(p.quote_config ?? {}), customPriceCents: cents } }))}
                    onReset={() => setEditing((p) => { const q = { ...(p.quote_config ?? {}) }; delete q.customPriceCents; return { ...p, quote_config: q }; })} />;
                }
                return null;
              })()}

              {/* Send to Admin toggle */}
              <div className="flex items-center justify-between py-2 px-3 bg-gray-800/50 rounded-lg border border-gray-700">
                <div>
                  <div className="text-sm font-medium text-gray-200">Send copy to admin</div>
                  <div className="text-xs text-gray-500 mt-0.5">CC the administrator on the quote email</div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing((p) => ({ ...p, send_to_admin: !p.send_to_admin }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    editing.send_to_admin ? "bg-indigo-600" : "bg-gray-700"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    editing.send_to_admin ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>
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
      {quoteOpp && (
        <QuoteBuilderPanel
          opp={quoteOpp}
          licenseTypes={licenseTypes}
          onClose={() => setQuoteOpp(null)}
          onSent={handleQuoteSent}
        />
      )}
    </div>
  );
}
