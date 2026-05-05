"use client";

import { useState, useMemo } from "react";
import {
  DollarSign, Plus, X, ChevronDown, CheckCircle2,
  Clock, AlertCircle, Building2, Receipt, Tag, Calendar,
  CreditCard, FileText, Pencil, Trash2, Send, Loader2, User, ArrowDownCircle, ArrowUpCircle, RefreshCw, Download
} from "lucide-react";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase-browser";
import {
  Vendor, Bill, SCHEDULE_C_CATEGORIES, PAYMENT_METHODS,
  ScheduleCCategory, PaymentMethod
} from "@/lib/types";

const supabase = createBrowserSupabaseClient();

interface CcTxn {
  id: string;
  date: string;
  description: string;
  counterpartyName: string | null;
  amount: number;
  isCharge: boolean;
  status: string;
  kind: string;
  // local review state
  vendorId: string;
  scheduleC: string;
  skip: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  "17 - Legal/Professional": "text-violet-400 bg-violet-500/10 border-violet-500/20",
  "18 - Office/Software":    "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  "20 - Rent/Lease":         "text-orange-400 bg-orange-500/10 border-orange-500/20",
  "22 - Supplies":           "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  "25 - Utilities":          "text-green-400 bg-green-500/10 border-green-500/20",
  "26 - Wages":              "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "27a - Other Expenses":    "text-gray-400 bg-gray-500/10 border-gray-500/20",
};

const STATUS_STYLES: Record<string, string> = {
  unpaid: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  paid:   "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  void:   "text-gray-500 bg-gray-500/10 border-gray-500/20",
};

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

interface Props {
  vendors: Vendor[];
  bills: Bill[];
  ownerLedger: OwnerLedgerEntry[];
}

interface OwnerLedgerEntry {
  id: string;
  date: string;
  description: string;
  type: "fronted" | "reimbursed" | "draw";
  amount: number;
  payment_method?: string;
  notes?: string;
}

interface BillForm {
  vendor_id: string;
  description: string;
  amount: string;
  bill_date: string;
  due_date: string;
  paid_date: string;
  status: "unpaid" | "paid" | "void";
  payment_method: PaymentMethod | "";
  schedule_c_line: ScheduleCCategory | "";
  notes: string;
  tax_year: string;
}

const EMPTY_BILL: BillForm = {
  vendor_id: "",
  description: "",
  amount: "",
  bill_date: new Date().toISOString().slice(0, 10),
  due_date: "",
  paid_date: "",
  status: "unpaid",
  payment_method: "",
  schedule_c_line: "",
  notes: "",
  tax_year: new Date().getFullYear().toString(),
};

export default function FinanceClient({ vendors: initialVendors, bills: initialBills, ownerLedger: initialOwnerLedger }: Props) {
  const [vendors, setVendors] = useState<Vendor[]>(initialVendors);
  const [bills, setBills] = useState<Bill[]>(initialBills);
  const [ownerLedger, setOwnerLedger] = useState<OwnerLedgerEntry[]>(initialOwnerLedger);
  const [tab, setTab] = useState<"bills" | "vendors" | "owner">("bills");
  const [showBillForm, setShowBillForm] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [billForm, setBillForm] = useState<BillForm>(EMPTY_BILL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "unpaid" | "paid">("all");
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [paying, setPaying] = useState<string | null>(null);
  const [payResult, setPayResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const [reimburseAmount, setReimburseAmount] = useState<string>("");
  const [showCcSync, setShowCcSync] = useState(false);
  const [ccTxns, setCcTxns] = useState<CcTxn[]>([]);
  const [ccSyncing, setCcSyncing] = useState(false);
  const [ccImporting, setCcImporting] = useState<string | null>(null);

  // Derived stats
  const stats = useMemo(() => {
    const currentYear = bills.filter(b => b.tax_year === parseInt(filterYear));
    const totalPaid = currentYear.filter(b => b.status === "paid").reduce((s, b) => s + b.amount, 0);
    const totalUnpaid = currentYear.filter(b => b.status === "unpaid").reduce((s, b) => s + b.amount, 0);
    const byCategory = currentYear.filter(b => b.status === "paid").reduce((acc, b) => {
      const cat = b.schedule_c_line || "27a - Other Expenses";
      acc[cat] = (acc[cat] || 0) + b.amount;
      return acc;
    }, {} as Record<string, number>);
    return { totalPaid, totalUnpaid, byCategory, count: currentYear.length };
  }, [bills, filterYear]);

  const ownerStats = useMemo(() => {
    const totalFronted = ownerLedger.filter(e => e.type === "fronted").reduce((s, e) => s + e.amount, 0);
    const totalReimbursed = ownerLedger.filter(e => e.type === "reimbursed" || e.type === "draw").reduce((s, e) => s + e.amount, 0);
    return { totalFronted, totalReimbursed, balance: totalFronted - totalReimbursed };
  }, [ownerLedger]);

  const filteredBills = useMemo(() => {
    return bills.filter(b => {
      if (filterStatus !== "all" && b.status !== filterStatus) return false;
      if (b.tax_year !== parseInt(filterYear)) return false;
      return true;
    });
  }, [bills, filterStatus, filterYear]);

  const years = useMemo(() => {
    const ys = new Set(bills.map(b => b.tax_year.toString()));
    ys.add(new Date().getFullYear().toString());
    return Array.from(ys).sort().reverse();
  }, [bills]);

  function openNewBill() {
    setEditingBill(null);
    setBillForm(EMPTY_BILL);
    setError(null);
    setShowBillForm(true);
  }

  function openEditBill(bill: Bill) {
    setEditingBill(bill);
    setBillForm({
      vendor_id: bill.vendor_id,
      description: bill.description,
      amount: bill.amount.toString(),
      bill_date: bill.bill_date,
      due_date: bill.due_date ?? "",
      paid_date: bill.paid_date ?? "",
      status: bill.status,
      payment_method: (bill.payment_method as PaymentMethod) ?? "",
      schedule_c_line: (bill.schedule_c_line as ScheduleCCategory) ?? "",
      notes: bill.notes ?? "",
      tax_year: bill.tax_year.toString(),
    });
    setError(null);
    setShowBillForm(true);
  }

  async function saveBill(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const vendor = vendors.find(v => v.id === billForm.vendor_id);
    const payload = {
      vendor_id: billForm.vendor_id,
      description: billForm.description,
      amount: parseFloat(billForm.amount),
      bill_date: billForm.bill_date,
      due_date: billForm.due_date || null,
      paid_date: billForm.paid_date || null,
      status: billForm.status,
      payment_method: billForm.payment_method || null,
      schedule_c_line: billForm.schedule_c_line || vendor?.category || null,
      notes: billForm.notes || null,
      tax_year: parseInt(billForm.tax_year),
    };

    if (editingBill) {
      const { data, error: err } = await supabase
        .from("cw_bills").update(payload).eq("id", editingBill.id)
        .select("*, vendor:cw_vendors(*)").single();
      if (err) { setError(err.message); setSaving(false); return; }
      setBills(prev => prev.map(b => b.id === editingBill.id ? data : b));
    } else {
      const { data, error: err } = await supabase
        .from("cw_bills").insert(payload)
        .select("*, vendor:cw_vendors(*)").single();
      if (err) { setError(err.message); setSaving(false); return; }
      setBills(prev => [data, ...prev]);
    }

    setSaving(false);
    setShowBillForm(false);
  }

  async function deleteBill(id: string) {
    if (!confirm("Delete this bill?")) return;
    await supabase.from("cw_bills").delete().eq("id", id);
    setBills(prev => prev.filter(b => b.id !== id));
  }

  async function markPaid(bill: Bill) {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("cw_bills")
      .update({ status: "paid", paid_date: today })
      .eq("id", bill.id)
      .select("*, vendor:cw_vendors(*)")
      .single();
    if (data) setBills(prev => prev.map(b => b.id === bill.id ? data : b));
  }

  async function payViaMercury(bill: Bill, smokeTest = true) {
    setPaying(bill.id);
    setPayResult(null);
    try {
      const res = await fetch("/api/mercury-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId: bill.id, amount: bill.amount, note: bill.description, smokeTest }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPayResult({ msg: "Error: " + (data.error ?? "unknown") + (data.details ? " — " + JSON.stringify(data.details) : ""), ok: false });
      } else {
        setPayResult({ msg: (smokeTest ? "Smoke test" : "Payment") + " sent! $" + data.amount + " · Mercury txn: " + data.mercuryTransactionId, ok: true });
        if (!smokeTest) {
          const today = new Date().toISOString().slice(0, 10);
          const { data: updated } = await supabase
            .from("cw_bills")
            .update({ status: "paid", paid_date: today, mercury_transaction_id: data.mercuryTransactionId })
            .eq("id", bill.id)
            .select("*, vendor:cw_vendors(*)")
            .single();
          if (updated) setBills(prev => prev.map(b => b.id === bill.id ? updated : b));
        }
      }
    } catch (e) {
      setPayResult({ msg: "Network error: " + String(e), ok: false });
    } finally {
      setPaying(null);
    }
  }

  async function reimburseViaMercury(amount: number) {
    setPaying("owner-reimburse");
    setPayResult(null);
    try {
      const res = await fetch("/api/mercury-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId: "owner-reimburse-" + Date.now(), amount, note: "Owner reimbursement via Mercury ACH", smokeTest: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPayResult({ msg: "Error: " + (data.error ?? "unknown") + (data.details ? " — " + JSON.stringify(data.details) : ""), ok: false });
      } else {
        setPayResult({ msg: "Reimbursement sent! $" + data.amount + " · Mercury txn: " + data.mercuryTransactionId, ok: true });
        const today = new Date().toISOString().slice(0, 10);
        const { data: entry } = await supabase
          .from("cw_owner_ledger")
          .insert({ date: today, description: "Reimbursement via Mercury ACH", type: "reimbursed", amount, payment_method: "mercury", notes: "Mercury txn: " + data.mercuryTransactionId })
          .select()
          .single();
        if (entry) setOwnerLedger(prev => [entry, ...prev]);
        setReimburseAmount("");
      }
    } catch (e) {
      setPayResult({ msg: "Network error: " + String(e), ok: false });
    } finally {
      setPaying(null);
    }
  }

  async function syncMercuryCC() {
    setCcSyncing(true);
    try {
      const res = await fetch("/api/mercury-cc-sync");
      const data = await res.json();
      if (!res.ok) { alert("Sync failed: " + (data.error ?? "unknown")); return; }
      // Auto-match vendor by counterpartyName
      const mapped: CcTxn[] = (data.transactions ?? []).map((t: Omit<CcTxn, "vendorId"|"scheduleC"|"skip">) => {
        const name = (t.counterpartyName ?? t.description ?? "").toLowerCase();
        const matched = vendors.find(v => name.includes(v.name.toLowerCase()));
        return { ...t, vendorId: matched?.id ?? "", scheduleC: matched?.category ?? "18 - Office/Software", skip: !t.isCharge };
      });
      setCcTxns(mapped);
      setShowCcSync(true);
    } finally {
      setCcSyncing(false);
    }
  }

  async function importCcTxn(txn: CcTxn) {
    if (!txn.vendorId) { alert("Please select a vendor first."); return; }
    setCcImporting(txn.id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("cw_bills")
        .insert({
          vendor_id: txn.vendorId,
          description: txn.description,
          amount: txn.amount,
          bill_date: txn.date,
          paid_date: txn.date,
          status: "paid",
          payment_method: "mercury_cc",
          mercury_transaction_id: txn.id,
          schedule_c_line: txn.scheduleC,
          tax_year: parseInt(txn.date.slice(0, 4)),
        })
        .select("*, vendor:cw_vendors(*)")
        .single();
      if (error) { alert("Import failed: " + error.message); return; }
      if (data) setBills(prev => [data, ...prev]);
      setCcTxns(prev => prev.filter(t => t.id !== txn.id));
    } finally {
      setCcImporting(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-semibold text-white">Finance</span>
            <span className="ml-1 px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-400">
              Cloud Weaver, LLC
            </span>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={filterYear}
              onChange={e => setFilterYear(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {tab === "bills" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={syncMercuryCC}
                  disabled={ccSyncing}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all"
                >
                  {ccSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Sync CC
                </button>
                <button
                  onClick={openNewBill}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-all"
                >
                  <Plus className="w-4 h-4" /> New Bill
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {payResult && (
        <div className={"px-6 py-3 text-sm font-medium flex items-center justify-between " + (payResult.ok ? "bg-emerald-500/10 text-emerald-400 border-b border-emerald-500/20" : "bg-red-500/10 text-red-400 border-b border-red-500/20")}>
          <span>{payResult.msg}</span>
          <button onClick={() => setPayResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
        </div>
      )}
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="text-xs text-gray-500 mb-1">Total Expenses {filterYear}</div>
            <div className="text-2xl font-bold text-white">{fmt(stats.totalPaid)}</div>
            <div className="text-xs text-gray-600 mt-1">{stats.count} bill{stats.count !== 1 ? "s" : ""}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="text-xs text-gray-500 mb-1">Unpaid / Outstanding</div>
            <div className={`text-2xl font-bold ${stats.totalUnpaid > 0 ? "text-amber-400" : "text-gray-600"}`}>
              {fmt(stats.totalUnpaid)}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="text-xs text-gray-500 mb-2">By Schedule C Line</div>
            <div className="space-y-1">
              {Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 truncate max-w-[140px]">{cat}</span>
                  <span className="text-xs font-semibold text-white">{fmt(amt)}</span>
                </div>
              ))}
              {Object.keys(stats.byCategory).length === 0 && (
                <div className="text-xs text-gray-600">No paid bills yet</div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900/50 rounded-xl p-1 w-fit border border-gray-800">
          {(["bills", "vendors", "owner"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${
                tab === t ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >{t}</button>
          ))}
        </div>

        {/* Bills tab */}
        {tab === "bills" && (
          <div className="space-y-3">
            {/* Filter */}
            <div className="flex gap-2">
              {(["all", "unpaid", "paid"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-all border ${
                    filterStatus === s
                      ? "bg-gray-700 border-gray-600 text-white"
                      : "border-gray-800 text-gray-500 hover:text-gray-300"
                  }`}
                >{s}</button>
              ))}
            </div>

            {filteredBills.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <div>No bills yet. Add your first expense.</div>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-xs text-gray-500">
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-left px-4 py-3">Vendor</th>
                      <th className="text-left px-4 py-3">Description</th>
                      <th className="text-left px-4 py-3">Category</th>
                      <th className="text-right px-4 py-3">Amount</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBills.map(bill => (
                      <tr key={bill.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors group">
                        <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtDate(bill.bill_date)}</td>
                        <td className="px-4 py-3 font-medium text-white">{bill.vendor?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-400 max-w-[200px] truncate">{bill.description}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-medium border ${CATEGORY_COLORS[bill.schedule_c_line ?? ""] ?? "text-gray-400 bg-gray-800 border-gray-700"}`}>
                            {bill.schedule_c_line ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-white">{fmt(bill.amount)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border capitalize ${STATUS_STYLES[bill.status]}`}>
                            {bill.status === "paid" && <CheckCircle2 className="w-2.5 h-2.5" />}
                            {bill.status === "unpaid" && <Clock className="w-2.5 h-2.5" />}
                            {bill.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {bill.status === "unpaid" && (
                              <>
                                <button
                                  onClick={() => markPaid(bill)}
                                  className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10 transition-all"
                                  title="Mark paid"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => payViaMercury(bill, false)}
                                    disabled={paying === bill.id}
                                    className="p-1 rounded text-blue-400 hover:bg-blue-500/10 transition-all disabled:opacity-50"
                                    title={"Pay " + fmt(bill.amount) + " via Mercury ACH"}
                                  >
                                    {paying === bill.id
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <Send className="w-3.5 h-3.5" />}
                                  </button>
                              </>
                            )}
                            <button
                              onClick={() => openEditBill(bill)}
                              className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 transition-all"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteBill(bill.id)}
                              className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-700 bg-gray-800/40">
                      <td colSpan={4} className="px-5 py-3 text-xs text-gray-500 font-medium">
                        {filteredBills.length} bill{filteredBills.length !== 1 ? "s" : ""}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-white">
                        {fmt(filteredBills.reduce((s, b) => s + b.amount, 0))}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Vendors tab */}
        {tab === "vendors" && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500">
                  <th className="text-left px-5 py-3">Vendor</th>
                  <th className="text-left px-4 py-3">Schedule C Category</th>
                  <th className="text-left px-4 py-3">Website</th>
                  <th className="text-left px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map(v => (
                  <tr key={v.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3 font-medium text-white">{v.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-medium border ${CATEGORY_COLORS[v.category] ?? "text-gray-400 bg-gray-800 border-gray-700"}`}>
                        {v.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {v.website ? <a href={v.website} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">{v.website.replace("https://", "")}</a> : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{v.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

        {/* Owner tab */}
        {tab === "owner" && (
          <div className="space-y-4">
            {/* Balance cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <div className="text-xs text-gray-500 mb-1">Total Fronted by Owner</div>
                <div className="text-2xl font-bold text-white">{fmt(ownerStats.totalFronted)}</div>
                <div className="text-xs text-gray-600 mt-1">Paid personally for company</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <div className="text-xs text-gray-500 mb-1">Total Reimbursed</div>
                <div className="text-2xl font-bold text-emerald-400">{fmt(ownerStats.totalReimbursed)}</div>
                <div className="text-xs text-gray-600 mt-1">Paid back to owner</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <div className="text-xs text-gray-500 mb-1">Outstanding Balance</div>
                <div className={`text-2xl font-bold ${ownerStats.balance > 0 ? "text-amber-400" : "text-gray-400"}`}>
                  {fmt(ownerStats.balance)}
                </div>
                <div className="text-xs text-gray-600 mt-1">Company owes owner</div>
                {ownerStats.balance > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-gray-500 text-xs">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={ownerStats.balance}
                      value={reimburseAmount !== "" ? reimburseAmount : ownerStats.balance.toFixed(2)}
                      onChange={e => setReimburseAmount(e.target.value)}
                      className="w-24 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => reimburseViaMercury(parseFloat(reimburseAmount !== "" ? reimburseAmount : ownerStats.balance.toFixed(2)))}
                      disabled={paying === "owner-reimburse"}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-all"
                    >
                      {paying === "owner-reimburse"
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Send className="w-3 h-3" />}
                      Reimburse
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Ledger table */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-xs text-gray-500">
                    <th className="text-left px-5 py-3">Date</th>
                    <th className="text-left px-4 py-3">Description</th>
                    <th className="text-left px-4 py-3">Type</th>
                    <th className="text-left px-4 py-3">Method</th>
                    <th className="text-right px-4 py-3">Amount</th>
                    <th className="text-right px-5 py-3">Running Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ownerLedger].sort((a, b) => a.date.localeCompare(b.date)).reduce<{ entries: (OwnerLedgerEntry & { balance: number })[]; running: number }>(
                    (acc, e) => {
                      const delta = e.type === "fronted" ? e.amount : -e.amount;
                      const running = acc.running + delta;
                      acc.entries.push({ ...e, balance: running });
                      acc.running = running;
                      return acc;
                    },
                    { entries: [], running: 0 }
                  ).entries.reverse().map(entry => (
                    <tr key={entry.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtDate(entry.date)}</td>
                      <td className="px-4 py-3 text-white">
                        <div>{entry.description}</div>
                        {entry.notes && <div className="text-xs text-gray-500 mt-0.5">{entry.notes}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border capitalize ${
                          entry.type === "fronted"
                            ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                            : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                        }`}>
                          {entry.type === "fronted"
                            ? <ArrowDownCircle className="w-2.5 h-2.5" />
                            : <ArrowUpCircle className="w-2.5 h-2.5" />}
                          {entry.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs capitalize">{entry.payment_method ?? "—"}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${entry.type === "fronted" ? "text-amber-400" : "text-emerald-400"}`}>
                        {entry.type === "fronted" ? "+" : "-"}{fmt(entry.amount)}
                      </td>
                      <td className={`px-5 py-3 text-right font-bold ${entry.balance > 0 ? "text-white" : "text-gray-500"}`}>
                        {fmt(entry.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {/* Bill form modal */}
      {showBillForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowBillForm(false)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-400" />
                {editingBill ? "Edit Bill" : "New Bill"}
              </h3>
              <button onClick={() => setShowBillForm(false)} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={saveBill} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">{error}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Vendor *</label>
                  <select
                    required
                    value={billForm.vendor_id}
                    onChange={e => {
                      const v = vendors.find(v => v.id === e.target.value);
                      setBillForm(p => ({ ...p, vendor_id: e.target.value, schedule_c_line: v?.category ?? p.schedule_c_line }));
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Select vendor…</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Description *</label>
                  <input
                    required
                    type="text"
                    value={billForm.description}
                    onChange={e => setBillForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="e.g. Supabase Pro - May 2026"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Amount *</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={billForm.amount}
                    onChange={e => setBillForm(p => ({ ...p, amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Tax Year</label>
                  <input
                    type="number"
                    value={billForm.tax_year}
                    onChange={e => setBillForm(p => ({ ...p, tax_year: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Bill Date *</label>
                  <input
                    required
                    type="date"
                    value={billForm.bill_date}
                    onChange={e => setBillForm(p => ({ ...p, bill_date: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Status</label>
                  <select
                    value={billForm.status}
                    onChange={e => setBillForm(p => ({ ...p, status: e.target.value as "unpaid" | "paid" | "void" }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="unpaid">Unpaid</option>
                    <option value="paid">Paid</option>
                    <option value="void">Void</option>
                  </select>
                </div>

                {billForm.status === "paid" && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Paid Date</label>
                      <input
                        type="date"
                        value={billForm.paid_date}
                        onChange={e => setBillForm(p => ({ ...p, paid_date: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Payment Method</label>
                      <select
                        value={billForm.payment_method}
                        onChange={e => setBillForm(p => ({ ...p, payment_method: e.target.value as PaymentMethod }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="">Select…</option>
                        <option value="mercury">Mercury</option>
                        <option value="personal_card">Personal Card</option>
                        <option value="usaa">USAA</option>
                        <option value="check">Check</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </>
                )}

                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Schedule C Line</label>
                  <select
                    value={billForm.schedule_c_line}
                    onChange={e => setBillForm(p => ({ ...p, schedule_c_line: e.target.value as ScheduleCCategory }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Auto from vendor…</option>
                    {SCHEDULE_C_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Notes</label>
                  <input
                    type="text"
                    value={billForm.notes}
                    onChange={e => setBillForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Optional"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBillForm(false)}
                  className="flex-1 px-4 py-2 rounded-xl border border-gray-700 text-gray-400 hover:text-white text-sm transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all disabled:opacity-50"
                >
                  {saving ? "Saving…" : editingBill ? "Save Changes" : "Add Bill"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mercury CC Sync panel */}
      {showCcSync && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" style={{background:"rgba(0,0,0,0.7)"}}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <div>
                <div className="text-white font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-blue-400" /> Mercury CC — Unimported Charges</div>
                <div className="text-xs text-gray-500 mt-0.5">{ccTxns.filter(t => !t.skip).length} charge{ccTxns.filter(t => !t.skip).length !== 1 ? "s" : ""} ready to import</div>
              </div>
              <button onClick={() => setShowCcSync(false)} className="p-1 rounded text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              {ccTxns.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500 text-sm">No unimported transactions found.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-xs text-gray-500">
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-left px-4 py-3">Description</th>
                      <th className="text-right px-4 py-3">Amount</th>
                      <th className="text-left px-4 py-3">Vendor</th>
                      <th className="text-left px-4 py-3">Schedule C</th>
                      <th className="text-center px-4 py-3">Skip</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ccTxns.map(txn => (
                      <tr key={txn.id} className={"border-b border-gray-800/60 " + (txn.skip ? "opacity-40" : "")}>
                        <td className="px-5 py-3 text-gray-400 whitespace-nowrap text-xs">{txn.date}</td>
                        <td className="px-4 py-3 text-white max-w-xs">
                          <div className="truncate">{txn.description}</div>
                          {txn.counterpartyName && txn.counterpartyName !== txn.description && <div className="text-xs text-gray-500 truncate">{txn.counterpartyName}</div>}
                        </td>
                        <td className={"px-4 py-3 text-right font-semibold whitespace-nowrap " + (txn.isCharge ? "text-amber-400" : "text-emerald-400")}>
                          {txn.isCharge ? "-" : "+"}{fmt(txn.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={txn.vendorId}
                            onChange={e => setCcTxns(prev => prev.map(t => t.id === txn.id ? { ...t, vendorId: e.target.value } : t))}
                            className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1 w-full focus:outline-none"
                            disabled={txn.skip}
                          >
                            <option value="">-- select --</option>
                            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={txn.scheduleC}
                            onChange={e => setCcTxns(prev => prev.map(t => t.id === txn.id ? { ...t, scheduleC: e.target.value } : t))}
                            className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1 w-full focus:outline-none"
                            disabled={txn.skip}
                          >
                            {SCHEDULE_C_CATEGORIES.map((c: ScheduleCCategory) => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input type="checkbox" checked={txn.skip} onChange={e => setCcTxns(prev => prev.map(t => t.id === txn.id ? { ...t, skip: e.target.checked } : t))} className="w-4 h-4 accent-blue-500" />
                        </td>
                        <td className="px-4 py-3">
                          {!txn.skip && (
                            <button
                              onClick={() => importCcTxn(txn)}
                              disabled={ccImporting === txn.id || !txn.vendorId}
                              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-all whitespace-nowrap"
                            >
                              {ccImporting === txn.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                              Import
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
