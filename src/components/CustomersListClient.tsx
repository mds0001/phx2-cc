"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Users, Trash2, Edit2, ArrowLeft,
  AlertTriangle, CreditCard, Key, Clock,
  CheckCircle2, XCircle, RefreshCw, Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { Customer, CustomerLicense, PaymentStatus } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────

type CustomerWithLicenses = Customer & {
  customer_licenses: Pick<CustomerLicense, "id" | "status" | "expiry_date" | "renewal_type">[];
};

const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  active:  { label: "Active",  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25", icon: <CheckCircle2 className="w-3 h-3" /> },
  lapsed:  { label: "Lapsed",  color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/25",  icon: <Clock        className="w-3 h-3" /> },
  failed:  { label: "Failed",  color: "text-red-400",     bg: "bg-red-500/10 border-red-500/25",        icon: <XCircle      className="w-3 h-3" /> },
  pending: { label: "Pending", color: "text-gray-400",    bg: "bg-gray-500/10 border-gray-500/25",      icon: <Clock        className="w-3 h-3" /> },
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getAttentionFlags(c: CustomerWithLicenses) {
  const flags: string[] = [];
  if (c.payment_status === "failed")  flags.push("Payment failed");
  if (c.payment_status === "lapsed")  flags.push("Payment lapsed");

  for (const lic of c.customer_licenses) {
    if (lic.status === "expired" || lic.status === "cancelled") continue;
    const days = daysUntil(lic.expiry_date);
    if (days !== null && days <= (c.alert_days_before ?? 30) && days >= 0)
      flags.push(`License expires in ${days}d`);
    if (days !== null && days < 0)
      flags.push("License expired");
    if (lic.renewal_type === "manual" && days !== null && days <= 60 && days >= 0)
      flags.push("Renewal due");
  }
  return flags;
}

// ── Component ─────────────────────────────────────────────────

export default function CustomersListClient({
  customers: initial,
}: {
  customers: CustomerWithLicenses[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [customers, setCustomers] = useState(initial);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function handleDelete(id: string) {
    if (!confirm("Delete this customer and all their licenses?")) return;
    setDeleting(id);
    await supabase.from("customers").delete().eq("id", id);
    setCustomers((p) => p.filter((c) => c.id !== id));
    setDeleting(null);
  }

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    );
  });

  const attentionCount = customers.reduce(
    (n, c) => n + (getAttentionFlags(c).length > 0 ? 1 : 0),
    0
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
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
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">Customers</span>
              {attentionCount > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 rounded-full text-xs font-semibold">
                  <AlertTriangle className="w-3 h-3" />
                  {attentionCount} need attention
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative hidden sm:flex">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customers…"
                className="bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-52"
              />
            </div>
            <button
              onClick={() => router.push("/boh/customers/new")}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-600/20"
            >
              <Plus className="w-4 h-4" />
              New Customer
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center">
              <Users className="w-7 h-7 text-gray-600" />
            </div>
            <p className="text-gray-400 text-lg font-medium">
              {search ? "No customers match your search" : "No customers yet"}
            </p>
            {!search && (
              <button
                onClick={() => router.push("/boh/customers/new")}
                className="mt-2 flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all"
              >
                <Plus className="w-4 h-4" />
                Add First Customer
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((customer) => {
              const flags = getAttentionFlags(customer);
              const payMeta = PAYMENT_STATUS_META[customer.payment_status];
              const activeLicenses = customer.customer_licenses.filter(
                (l) => l.status === "active" || l.status === "trial"
              );
              const soonestExpiry = customer.customer_licenses
                .filter((l) => l.expiry_date && (l.status === "active" || l.status === "trial"))
                .sort((a, b) =>
                  new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime()
                )[0];
              const soonestDays = soonestExpiry ? daysUntil(soonestExpiry.expiry_date) : null;

              return (
                <div
                  key={customer.id}
                  className={`bg-gray-900 border rounded-2xl p-5 flex flex-col gap-4 hover:border-gray-700 transition-colors ${
                    flags.length > 0 ? "border-yellow-500/30" : "border-gray-800"
                  }`}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{customer.name}</p>
                      {customer.company && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{customer.company}</p>
                      )}
                      {customer.email && (
                        <p className="text-xs text-gray-600 truncate">{customer.email}</p>
                      )}
                    </div>
                    <span className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold ${payMeta.bg} ${payMeta.color}`}>
                      {payMeta.icon}
                      {payMeta.label}
                    </span>
                  </div>

                  {/* Attention flags */}
                  {flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {flags.slice(0, 3).map((f, i) => (
                        <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 rounded-lg text-xs">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {f}
                        </span>
                      ))}
                      {flags.length > 3 && (
                        <span className="px-2 py-0.5 bg-gray-800 border border-gray-700 text-gray-500 rounded-lg text-xs">
                          +{flags.length - 3} more
                        </span>
                      )}
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Key className="w-3 h-3" />
                      {activeLicenses.length} license{activeLicenses.length !== 1 ? "s" : ""}
                    </span>
                    {customer.card_last4 && (
                      <span className="flex items-center gap-1">
                        <CreditCard className="w-3 h-3" />
                        {customer.card_type ?? "Card"} ···{customer.card_last4}
                      </span>
                    )}
                    {soonestDays !== null && (
                      <span className={`flex items-center gap-1 ml-auto ${soonestDays <= 30 ? "text-yellow-500" : "text-gray-500"}`}>
                        <Clock className="w-3 h-3" />
                        {soonestDays < 0 ? "Expired" : `Exp. ${soonestDays}d`}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1 border-t border-gray-800">
                    <button
                      onClick={() => router.push(`/boh/customers/${customer.id}`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-all"
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(customer.id)}
                      disabled={deleting === customer.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                    <span className="ml-auto text-xs text-gray-600">
                      {new Date(customer.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
