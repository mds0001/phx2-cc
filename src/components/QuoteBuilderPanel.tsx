"use client";

import { useState } from "react";
import { X, Mail, Send, AlertTriangle } from "lucide-react";
import type { LicenseType, Opportunity } from "@/lib/types";

type OpportunityWithLead = Opportunity & {
  leads: { name: string; email: string | null; company: string | null } | null;
};

interface ResolvedLineItem {
  name: string;
  description: string;
  unitPriceCents: number;
  qty: number;
}

interface Props {
  opp: OpportunityWithLead;
  licenseTypes: LicenseType[];
  onClose: () => void;
  onSent: (sentAt: string, quoteNumber: string) => void;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function resolveLineItems(opp: OpportunityWithLead, licenseTypes: LicenseType[]): ResolvedLineItem[] {
  const tier = opp.tier;
  const config = opp.quote_config;

  if (tier === "free") {
    return [{ name: "Threads Free Tier", description: "No cost — free forever", unitPriceCents: 0, qty: 1 }];
  }

  if (tier === "master") {
    const term = config?.masterTerm ?? 1;
    const targetDays = term === 3 ? 1095 : 365;
    const masterLt = licenseTypes.find((lt) => lt.type === "subscription" && lt.duration_days === targetDays)
                  ?? licenseTypes.find((lt) => lt.type === "subscription");
    if (!masterLt) return [];
    const unitCents = masterLt.price_cents;
    const termLabel = term === 3 ? "3-Year Term" : "Annual";
    const desc = masterLt.description
      ? masterLt.description + " (" + termLabel + ")"
      : termLabel;
    return [{ name: masterLt.name, description: desc, unitPriceCents: unitCents, qty: 1 }];
  }

  if (tier === "pro") {
    const endpoints = config?.proEndpoints ?? [];
    const isAnnual = config?.proTerm === "annual";
    return endpoints
      .filter((ep) => ep.licenseTypeId)
      .map((ep) => {
        const lt = licenseTypes.find((l) => l.id === ep.licenseTypeId);
        if (!lt) return null;
        const unitPriceCents = isAnnual && lt.yearly_price_cents != null
          ? lt.yearly_price_cents
          : lt.price_cents;
        const termSuffix = isAnnual ? "/yr" : "/mo";
        const desc = lt.description
          ? lt.description + " " + termSuffix
          : termSuffix;
        return { name: lt.name, description: desc, unitPriceCents, qty: ep.qty };
      })
      .filter((x): x is ResolvedLineItem => x !== null);
  }

  return [];
}

export default function QuoteBuilderPanel({ opp, licenseTypes, onClose, onSent }: Props) {
  const [sending, setSending] = useState(false);

  const lineItems = resolveLineItems(opp, licenseTypes);
  const calculatedCents = lineItems.reduce((s, item) => s + item.unitPriceCents * item.qty, 0);
  const totalCents = opp.quote_config?.customPriceCents ?? calculatedCents;
  const hasEmail = !!opp.leads?.email;
  const tierLabel = opp.tier === "free" ? "Free" : opp.tier === "master" ? "Master" : opp.tier === "pro" ? "Pro" : "—";
  const tierColors: Record<string, string> = {
    free:   "bg-gray-500/10 border-gray-500/30 text-gray-400",
    pro:    "bg-sky-500/10 border-sky-500/30 text-sky-400",
    master: "bg-violet-500/10 border-violet-500/30 text-violet-400",
  };
  const tierColor = opp.tier ? (tierColors[opp.tier] ?? "bg-gray-700 text-gray-400") : "bg-gray-700 text-gray-400";

  const missingConfig: string[] = [];
  if (opp.tier === "pro" && (!opp.quote_config?.proEndpoints || opp.quote_config.proEndpoints.length === 0)) {
    missingConfig.push("No endpoints configured — edit the opportunity to add endpoint line items.");
  }
  if (opp.tier === "pro" && opp.quote_config?.proEndpoints?.some((ep) => !ep.licenseTypeId)) {
    missingConfig.push("One or more endpoint rows is missing a type — edit the opportunity to fix them.");
  }

  async function handleSend() {
    if (!hasEmail) return;
    if (lineItems.length === 0) { alert("No line items to quote. Edit the opportunity first."); return; }
    setSending(true);
    try {
      const res = await fetch("/api/pipeline/send-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opp.id,
          lineItems: lineItems.map((item) => ({
            name: item.name,
            description: item.description,
            unitPriceCents: item.unitPriceCents,
            qty: item.qty,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error ?? "Failed to send quote."); return; }
      onSent(json.sentAt, json.quoteNumber);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-[480px] bg-gray-900 border-l border-gray-800 flex flex-col h-full">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <Mail className="w-4 h-4 text-sky-400" />
            <h2 className="text-base font-semibold text-gray-100">Send Quote</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {/* Recipient */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recipient</div>
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-100">{opp.leads?.name ?? "—"}</div>
                {opp.leads?.company && <div className="text-xs text-gray-500 mt-0.5">{opp.leads.company}</div>}
              </div>
              <div className="text-sm text-gray-400">{opp.leads?.email ?? <span className="text-red-400">No email</span>}</div>
            </div>
            {!hasEmail && (
              <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                This lead has no email address. Add one before sending a quote.
              </div>
            )}
          </div>

          {/* Tier + config summary */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Quote Details</div>
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className={"inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border " + tierColor}>
                {tierLabel}
              </span>
              {opp.tier === "master" && (
                <span className="text-sm text-gray-300">
                  {(opp.quote_config?.masterTerm ?? 1) === 3 ? "3-Year Term" : "1-Year Term"}
                </span>
              )}
              {opp.tier === "pro" && (
                <span className="text-sm text-gray-300">
                  {(opp.quote_config?.proEndpoints ?? []).length} connection{(opp.quote_config?.proEndpoints ?? []).length !== 1 ? "s" : ""}
                  {" — "}
                  {opp.quote_config?.proTerm === "annual" ? "Annual billing (save 2 mo.)" : "Monthly billing"}
                </span>
              )}
              {opp.tier === "free" && <span className="text-sm text-gray-300">No cost</span>}
            </div>
            {missingConfig.map((msg, i) => (
              <div key={i} className="mt-2 flex items-start gap-2 text-xs text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {msg}
              </div>
            ))}
          </div>

          {/* Line items */}
          {lineItems.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Line Items</div>
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Item</th>
                      <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-12">Qty</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-700/50 last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-100">{item.name}</div>
                          {item.description && <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>}
                        </td>
                        <td className="px-3 py-3 text-center text-gray-400">{item.qty}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-100">
                          {item.unitPriceCents === 0
                            ? <span className="text-emerald-400">Free</span>
                            : formatCurrency(item.unitPriceCents * item.qty)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {opp.tier !== "free" && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 bg-gray-800/80">
                    <span className="text-sm font-semibold text-gray-300">Total</span>
                    <span className="text-base font-bold text-gray-100">{formatCurrency(totalCents)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Send to admin badge */}
          {opp.send_to_admin && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-indigo-500/10 border border-indigo-500/25 rounded-lg text-xs text-indigo-400">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              A copy will be sent to the administrator.
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-gray-800 flex gap-3">
          <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !hasEmail || lineItems.length === 0}
            className="flex-1 flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Send className="w-4 h-4" />
            {sending ? "Sending…" : "Send Quote"}
          </button>
        </div>
      </div>
    </div>
  );
}
