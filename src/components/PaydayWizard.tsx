"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X, Loader2, Send, CheckCircle2, AlertCircle, Banknote,
  ArrowRight, ArrowLeft, Wallet, ClipboardCheck, RefreshCw, SkipForward
} from "lucide-react";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase-browser";

const supabase = createBrowserSupabaseClient();

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Deposit {
  id: string;
  date: string;
  description: string;
  counterpartyName: string | null;
  amount: number;
  status: string;
}

export interface PaydayLedgerEntry {
  id: string;
  date: string;
  description: string;
  type: "fronted" | "reimbursed" | "draw";
  amount: number;
  payment_method?: string;
  notes?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  outstandingBalance: number;
  onLedgerEntry: (entry: PaydayLedgerEntry) => void;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS = ["Deposit", "Reimburse", "Draw", "Wrap Up"];

export default function PaydayWizard({ open, onClose, outstandingBalance, onLedgerEntry }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — confirm the NCSI deposit
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [depositsError, setDepositsError] = useState<string | null>(null);
  const [selectedDepositId, setSelectedDepositId] = useState<string>("");
  const [manualDeposit, setManualDeposit] = useState<string>("");

  // Step 2 — reimburse fronted expenses
  const [reimburseInput, setReimburseInput] = useState<string>("");
  const [reimbMode, setReimbMode] = useState<"send" | "record">("record");
  const [reimbUuid, setReimbUuid] = useState<string>("");
  const [reimburseSending, setReimburseSending] = useState(false);
  const [reimbursed, setReimbursed] = useState<{ amount: number; txnId: string; sent: boolean } | null>(null);

  // Step 3 — owner draw
  const [drawInput, setDrawInput] = useState<string>("");
  const [drawMode, setDrawMode] = useState<"send" | "record">("record");
  const [drawUuid, setDrawUuid] = useState<string>("");
  const [drawSending, setDrawSending] = useState(false);
  const [draw, setDraw] = useState<{ amount: number; txnId: string; sent: boolean } | null>(null);

  const selectedDeposit = deposits.find(d => d.id === selectedDepositId) ?? null;
  const depositAmount = selectedDeposit ? selectedDeposit.amount : (parseFloat(manualDeposit) || 0);
  const availableForDraw = depositAmount - (reimbursed?.amount ?? 0);

  const loadDeposits = useCallback(async () => {
    setDepositsLoading(true);
    setDepositsError(null);
    try {
      const res = await fetch("/api/mercury-checking-deposits");
      const data = await res.json();
      if (!res.ok) {
        setDepositsError(data.error ?? "Failed to load deposits from Mercury.");
        return;
      }
      const list: Deposit[] = data.deposits ?? [];
      setDeposits(list);
      const ncsi = list.find(d => /ncsi/i.test((d.counterpartyName ?? "") + " " + d.description));
      if (ncsi) setSelectedDepositId(prev => prev || ncsi.id);
    } catch (e) {
      setDepositsError("Network error: " + String(e));
    } finally {
      setDepositsLoading(false);
    }
  }, []);

  // Reset everything each time the wizard opens
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setError(null);
    setDeposits([]);
    setDepositsError(null);
    setSelectedDepositId("");
    setManualDeposit("");
    setReimburseInput("");
    setReimbMode("record");
    setReimbUuid("");
    setReimbursed(null);
    setDrawInput("");
    setDrawMode("record");
    setDrawUuid("");
    setDraw(null);
    loadDeposits();
  }, [open, loadDeposits]);

  async function insertLedger(row: Omit<PaydayLedgerEntry, "id">): Promise<PaydayLedgerEntry | null> {
    const { data, error: err } = await supabase
      .from("cw_owner_ledger")
      .insert(row)
      .select()
      .single();
    if (err) {
      setError("Ledger insert failed: " + err.message + " — record this row manually before re-running.");
      return null;
    }
    if (data) onLedgerEntry(data);
    return data;
  }

  async function sendReimbursement() {
    const amount = parseFloat(reimburseInput !== "" ? reimburseInput : outstandingBalance.toFixed(2));
    if (!amount || amount <= 0) {
      setError("Enter a reimbursement amount greater than zero, or skip this step.");
      return;
    }
    setError(null);

    if (reimbMode === "record") {
      const uuid = reimbUuid.trim();
      if (!UUID_RE.test(uuid)) {
        setError("That doesn't look like a Mercury transaction UUID. Use the transaction's UUID (from the Mercury transaction URL or API), not the tracking number.");
        return;
      }
      setReimburseSending(true);
      const today = new Date().toISOString().slice(0, 10);
      const entry = await insertLedger({
        date: today,
        description: "Reimbursement via Mercury",
        type: "reimbursed",
        amount,
        payment_method: "mercury",
        notes: "Mercury txn: " + uuid,
      });
      setReimburseSending(false);
      if (entry) setReimbursed({ amount, txnId: uuid, sent: false });
      return;
    }

    setReimburseSending(true);
    try {
      const res = await fetch("/api/mercury-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billId: "owner-reimburse-" + Date.now(),
          amount,
          note: "Owner reimbursement via Mercury ACH",
          smokeTest: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError("Mercury transfer failed: " + (data.error ?? "unknown") + (data.details ? " — " + JSON.stringify(data.details) : ""));
        return;
      }
      setReimbursed({ amount, txnId: data.mercuryTransactionId, sent: true });
      const today = new Date().toISOString().slice(0, 10);
      await insertLedger({
        date: today,
        description: "Reimbursement via Mercury ACH",
        type: "reimbursed",
        amount,
        payment_method: "mercury",
        notes: "Mercury txn: " + data.mercuryTransactionId,
      });
    } catch (e) {
      setError("Network error: " + String(e));
    } finally {
      setReimburseSending(false);
    }
  }

  async function sendDraw() {
    const amount = parseFloat(drawInput);
    if (!amount || amount <= 0) {
      setError("Enter a draw amount greater than zero, or skip this step.");
      return;
    }
    setError(null);

    if (drawMode === "record") {
      const uuid = drawUuid.trim();
      if (!UUID_RE.test(uuid)) {
        setError("That doesn't look like a Mercury transaction UUID. Use the transaction's UUID (from the Mercury transaction URL or API), not the tracking number.");
        return;
      }
      setDrawSending(true);
      const today = new Date().toISOString().slice(0, 10);
      const entry = await insertLedger({
        date: today,
        description: "Owner draw",
        type: "draw",
        amount,
        payment_method: "mercury",
        notes: "Mercury txn: " + uuid,
      });
      setDrawSending(false);
      if (entry) {
        setDraw({ amount, txnId: uuid, sent: false });
        setStep(4);
      }
      return;
    }

    setDrawSending(true);
    try {
      const res = await fetch("/api/mercury-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billId: "owner-draw-" + Date.now(),
          amount,
          note: "Owner draw via Mercury ACH",
          smokeTest: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError("Mercury transfer failed: " + (data.error ?? "unknown") + (data.details ? " — " + JSON.stringify(data.details) : ""));
        return;
      }
      setDraw({ amount, txnId: data.mercuryTransactionId, sent: true });
      const today = new Date().toISOString().slice(0, 10);
      await insertLedger({
        date: today,
        description: "Owner draw via Mercury ACH",
        type: "draw",
        amount,
        payment_method: "mercury",
        notes: "Mercury txn: " + data.mercuryTransactionId,
      });
    } catch (e) {
      setError("Network error: " + String(e));
    } finally {
      setDrawSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Banknote className="w-4 h-4 text-emerald-400" />
            Monthly Payday — NCSI
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-6 pt-4">
          {STEP_LABELS.map((label, i) => {
            const n = (i + 1) as Step;
            const done = step > n;
            const active = step === n;
            return (
              <div key={label} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                  active ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : done ? "bg-gray-800 border-gray-700 text-gray-400"
                  : "border-gray-800 text-gray-600"
                }`}>
                  {done ? <CheckCircle2 className="w-3 h-3" /> : <span>{n}.</span>}
                  {label}
                </div>
                {i < STEP_LABELS.length - 1 && <ArrowRight className="w-3 h-3 text-gray-700" />}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="px-6 py-5 overflow-y-auto">

          {/* ── Step 1: Confirm deposit ── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                Select the NCSI payment that landed in Mercury checking. Recent incoming transactions:
              </p>

              {depositsLoading ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-6 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading deposits from Mercury…
                </div>
              ) : depositsError ? (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-sm">
                  {depositsError} — you can enter the amount manually below.
                </div>
              ) : deposits.length === 0 ? (
                <div className="p-3 bg-gray-800/60 border border-gray-700 rounded-xl text-gray-400 text-sm">
                  No incoming transactions found. Enter the amount manually below.
                </div>
              ) : (
                <div className="border border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-800 max-h-56 overflow-y-auto">
                  {deposits.slice(0, 15).map(d => (
                    <button
                      key={d.id}
                      onClick={() => { setSelectedDepositId(d.id); setManualDeposit(""); }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors ${
                        selectedDepositId === d.id ? "bg-emerald-500/10" : "hover:bg-gray-800/50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-white truncate">{d.counterpartyName ?? d.description}</div>
                        <div className="text-xs text-gray-500">{d.date} · {d.status}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <span className="font-semibold text-emerald-400">+{fmt(d.amount)}</span>
                        {selectedDepositId === d.id && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={loadDeposits}
                  disabled={depositsLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white text-xs transition-all disabled:opacity-50"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>or enter amount manually:</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={manualDeposit}
                    onChange={e => { setManualDeposit(e.target.value); setSelectedDepositId(""); }}
                    className="w-28 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl text-xs text-blue-300/80 flex items-start gap-2">
                <ClipboardCheck className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Manual step: in the Mercury dashboard, categorize this deposit as <b>Revenue</b>. Mercury is the system of record for income.</span>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => { setError(null); setStep(2); }}
                  disabled={depositAmount <= 0}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-all"
                >
                  Continue with {fmt(depositAmount)} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Reimburse ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-800/50 border border-gray-700 rounded-xl">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Wallet className="w-4 h-4 text-amber-400" /> Outstanding fronted expenses
                </div>
                <div className={`text-lg font-bold ${outstandingBalance > 0 ? "text-amber-400" : "text-gray-500"}`}>
                  {fmt(outstandingBalance)}
                </div>
              </div>

              {reimbursed ? (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-400">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Reimbursement {reimbursed.sent ? "sent" : "recorded"} — {fmt(reimbursed.amount)}
                  </div>
                  <div className="text-xs text-emerald-400/70 mt-1 break-all">Mercury txn: {reimbursed.txnId}</div>
                </div>
              ) : outstandingBalance <= 0 ? (
                <div className="p-3 bg-gray-800/60 border border-gray-700 rounded-xl text-gray-400 text-sm">
                  Nothing outstanding — skip straight to the draw.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-1 bg-gray-800/60 rounded-lg p-1 w-fit border border-gray-700">
                    <button
                      onClick={() => setReimbMode("record")}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${reimbMode === "record" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
                    >Record existing transfer</button>
                    <button
                      onClick={() => setReimbMode("send")}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${reimbMode === "send" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
                    >Send via Mercury ACH</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={outstandingBalance}
                      value={reimburseInput !== "" ? reimburseInput : outstandingBalance.toFixed(2)}
                      onChange={e => setReimburseInput(e.target.value)}
                      className="w-32 bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {reimbMode === "record" && (
                      <input
                        type="text"
                        placeholder="Mercury txn UUID"
                        value={reimbUuid}
                        onChange={e => setReimbUuid(e.target.value)}
                        className="flex-1 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                    <button
                      onClick={sendReimbursement}
                      disabled={reimburseSending}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all whitespace-nowrap"
                    >
                      {reimburseSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {reimbMode === "send" ? "Send via ACH" : "Record Reimbursement"}
                    </button>
                  </div>
                  {reimbMode === "record" && (
                    <p className="text-xs text-gray-500">
                      Make the transfer in the Mercury dashboard first, then paste the transaction <b>UUID</b> here — never the tracking number.
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => { setError(null); setStep(1); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-700 text-gray-400 hover:text-white text-sm transition-all"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => { setError(null); setStep(3); }}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-all"
                >
                  {reimbursed ? <>Next <ArrowRight className="w-4 h-4" /></> : <><SkipForward className="w-4 h-4" /> Skip</>}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Draw ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-xl text-sm space-y-1.5">
                <div className="flex justify-between text-gray-400">
                  <span>NCSI deposit</span><span className="text-white font-semibold">{fmt(depositAmount)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Reimbursed to owner</span><span className="text-white font-semibold">−{fmt(reimbursed?.amount ?? 0)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1.5 text-gray-300 font-medium">
                  <span>Available</span><span className="text-emerald-400 font-bold">{fmt(availableForDraw)}</span>
                </div>
              </div>

              {draw ? (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-400">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Draw {draw.sent ? "sent" : "recorded"} — {fmt(draw.amount)}
                  </div>
                  <div className="text-xs text-emerald-400/70 mt-1 break-all">Mercury txn: {draw.txnId}</div>
                </div>
              ) : (
                <>
                  <div className="flex gap-1 bg-gray-800/60 rounded-lg p-1 w-fit border border-gray-700">
                    <button
                      onClick={() => setDrawMode("record")}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${drawMode === "record" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
                    >Record existing transfer</button>
                    <button
                      onClick={() => setDrawMode("send")}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${drawMode === "send" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
                    >Send via Mercury ACH</button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="Draw amount"
                      value={drawInput}
                      onChange={e => setDrawInput(e.target.value)}
                      className="w-32 bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {drawMode === "record" && (
                      <input
                        type="text"
                        placeholder="Mercury txn UUID"
                        value={drawUuid}
                        onChange={e => setDrawUuid(e.target.value)}
                        className="flex-1 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                    <button
                      onClick={sendDraw}
                      disabled={drawSending}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all whitespace-nowrap"
                    >
                      {drawSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {drawMode === "send" ? "Send Draw" : "Record Draw"}
                    </button>
                  </div>

                  {drawMode === "record" && (
                    <p className="text-xs text-gray-500">
                      Use the transaction <b>UUID</b> from Mercury (in the transaction URL), never the tracking number — the ledger dedups on UUID.
                    </p>
                  )}
                </>
              )}

              <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl text-xs text-blue-300/80 flex items-start gap-2">
                <ClipboardCheck className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Manual step: in the Mercury dashboard, categorize the draw transfer as <b>Owner Draw</b>.</span>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => { setError(null); setStep(2); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-700 text-gray-400 hover:text-white text-sm transition-all"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => { setError(null); setStep(4); }}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-all"
                >
                  {draw ? <>Next <ArrowRight className="w-4 h-4" /></> : <><SkipForward className="w-4 h-4" /> Skip</>}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Wrap up ── */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-xl text-sm space-y-1.5">
                <div className="flex justify-between text-gray-400">
                  <span>NCSI deposit</span><span className="text-emerald-400 font-semibold">+{fmt(depositAmount)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Owner reimbursement</span>
                  <span className="text-white font-semibold">{reimbursed ? "−" + fmt(reimbursed.amount) : "skipped"}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Owner draw</span>
                  <span className="text-white font-semibold">{draw ? "−" + fmt(draw.amount) : "skipped"}</span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1.5 text-gray-300 font-medium">
                  <span>Retained in company</span>
                  <span className="text-white font-bold">{fmt(depositAmount - (reimbursed?.amount ?? 0) - (draw?.amount ?? 0))}</span>
                </div>
              </div>

              <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl text-xs text-blue-300/80 space-y-2">
                <div className="font-semibold text-blue-300 flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4" /> Mercury dashboard checklist
                </div>
                <ul className="list-disc list-inside space-y-1">
                  <li>Deposit categorized as <b>Revenue</b></li>
                  {draw && <li>Draw transfer categorized as <b>Owner Draw</b></li>}
                  {reimbursed && <li>Reimbursement transfer categorized (Owner Reimbursement, if the category exists)</li>}
                </ul>
              </div>

              {draw && (
                <p className="text-xs text-gray-500">
                  Note: a draw larger than fronted expenses makes the Outstanding Balance go negative — that&apos;s expected and cosmetic.
                </p>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={onClose}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" /> Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
