"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Users, Save, Check, Plus, Trash2,
  CreditCard, MapPin, Key, Bell, Eye, EyeOff,
  AlertTriangle, RefreshCw, ChevronDown, Zap, Activity,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import StripeCardSection from "@/components/StripeCardSection";
import type {
  Customer, CustomerLicense, LicenseType, LicenseTypeKind,
  PaymentStatus, LicenseStatus, RenewalType,
} from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────

function uid() { return crypto.randomUUID(); }

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

const LICENSE_STATUS_META: Record<LicenseStatus, { label: string; color: string; bg: string }> = {
  active:    { label: "Active",    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
  trial:     { label: "Trial",     color: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/25"        },
  expired:   { label: "Expired",   color: "text-red-400",     bg: "bg-red-500/10 border-red-500/25"        },
  cancelled: { label: "Cancelled", color: "text-gray-400",    bg: "bg-gray-500/10 border-gray-500/25"      },
};

const LT_KIND_META: Record<LicenseTypeKind, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  one_time:     { label: "One-Time",     color: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/25",         icon: <Zap className="w-3 h-3" /> },
  subscription: { label: "Subscription", color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/25",   icon: <RefreshCw className="w-3 h-3" /> },
  by_endpoint:  { label: "By Endpoint",  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25", icon: <Activity className="w-3 h-3" /> },
};

// ── Field helpers ─────────────────────────────────────────────

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
    />
  );
}

function MaskedInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••"}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 pr-11 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
      />
      <button type="button" onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function SelectInput({ value, onChange, children, ring = "indigo" }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; ring?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full appearance-none bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 pr-9 text-white focus:outline-none focus:ring-2 focus:ring-${ring}-500 text-sm cursor-pointer`}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <span className="text-indigo-400">{icon}</span>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────

interface Props {
  customer: Customer | null;
  licenses: CustomerLicense[];
  licenseTypes: LicenseType[];
  isNew: boolean;
  userId: string;
}

// ── Component ─────────────────────────────────────────────────

export default function CustomerEditorClient({ customer, licenses: initialLicenses, licenseTypes, isNew, userId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const pickerRef = useRef<HTMLDivElement>(null);

  const [name,    setName]    = useState(customer?.name    ?? "");
  const [company, setCompany] = useState(customer?.company ?? "");
  const [email,   setEmail]   = useState(customer?.email   ?? "");
  const [phone,   setPhone]   = useState(customer?.phone   ?? "");
  const [notes,   setNotes]   = useState(customer?.notes   ?? "");

  const [street,  setStreet]  = useState(customer?.billing_street  ?? "");
  const [city,    setCity]    = useState(customer?.billing_city    ?? "");
  const [state,   setState]   = useState(customer?.billing_state   ?? "");
  const [zip,     setZip]     = useState(customer?.billing_zip     ?? "");
  const [country, setCountry] = useState(customer?.billing_country ?? "US");

  const [processorRef,  setProcessorRef]  = useState(customer?.payment_processor_ref   ?? "");
  const [poTerms,       setPoTerms]       = useState(customer?.po_terms        ?? "");
  const [cardType,      setCardType]      = useState(customer?.card_type       ?? "");
  const [cardLast4,     setCardLast4]     = useState(customer?.card_last4      ?? "");
  const [cardExpiryM,   setCardExpiryM]   = useState(String(customer?.card_expiry_month ?? ""));
  const [cardExpiryY,   setCardExpiryY]   = useState(String(customer?.card_expiry_year  ?? ""));
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(customer?.payment_status ?? "active");
  const [alertDays,     setAlertDays]     = useState(String(customer?.alert_days_before ?? 30));

  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [licenses,          setLicenses]          = useState<CustomerLicense[]>(initialLicenses);
  const [showLicensePicker, setShowLicensePicker] = useState(false);

  useEffect(() => {
    if (!showLicensePicker) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowLicensePicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showLicensePicker]);

  function addLicense(lt: LicenseType) {
    const newLic: CustomerLicense = {
      id: uid(),
      customer_id: customer?.id ?? "",
      product_name: lt.name,
      license_key: null,
      seats: 1,
      start_date: lt.type === "subscription" ? new Date().toISOString().split("T")[0] : null,
      expiry_date: lt.type === "subscription" ? (() => {
        const d = new Date(); d.setDate(d.getDate() + (lt.duration_days ?? 365)); return d.toISOString().split("T")[0];
      })() : null,
      status: "active",
      renewal_type: "manual",
      notes: null,
      license_type_id: lt.id,
      max_executions: lt.type === "one_time" ? (lt.default_executions ?? null) : null,
      executions_used: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setLicenses((p) => [...p, newLic]);
    setShowLicensePicker(false);
  }

  function updateLicense(id: string, patch: Partial<CustomerLicense>) {
    setLicenses((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLicense(id: string) {
    setLicenses((p) => p.filter((l) => l.id !== id));
  }

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setSaveError("Customer name is required."); return; }

    setSaving(true);
    setSaveError(null);

    try {
      const payload = {
        name: name.trim(),
        company: company.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        billing_street: street.trim() || null,
        billing_city: city.trim() || null,
        billing_state: state.trim() || null,
        billing_zip: zip.trim() || null,
        billing_country: country.trim() || "US",
        card_type: cardType.trim() || null,
        card_last4: cardLast4.trim() || null,
        card_expiry_month: cardExpiryM ? parseInt(cardExpiryM) : null,
        card_expiry_year: cardExpiryY ? parseInt(cardExpiryY) : null,
        payment_processor_ref: processorRef.trim() || null,
        po_terms: poTerms.trim() || null,
        payment_status: paymentStatus,
        alert_days_before: parseInt(alertDays) || 30,
        created_by: userId,
      };

      let customerId = customer?.id ?? "";

      if (isNew) {
        const { data, error } = await supabase
          .from("customers").insert(payload).select("id").single();
        if (error) throw error;
        customerId = data.id;
      } else {
        const { error } = await supabase
          .from("customers").update(payload).eq("id", customerId);
        if (error) throw error;
      }

      if (!isNew) {
        await supabase.from("customer_licenses").delete().eq("customer_id", customerId);
      }
      if (licenses.length > 0) {
        const licenseRows = licenses.map((l) => ({
          customer_id: customerId,
          product_name: l.product_name.trim(),
          license_key: l.license_key?.trim() || null,
          seats: l.seats,
          start_date: l.start_date || null,
          expiry_date: l.expiry_date || null,
          status: l.status,
          renewal_type: l.renewal_type,
          notes: l.notes?.trim() || null,
          license_type_id: l.license_type_id ?? null,
          max_executions: l.max_executions ?? null,
        }));
        const { error: licErr } = await supabase.from("customer_licenses").insert(licenseRows);
        if (licErr) throw licErr;
      }

      setSaved(true);
      if (isNew) {
        setTimeout(() => router.replace(`/boh/customers/${customerId}`), 800);
      } else {
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message
        : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : JSON.stringify(err);
      setSaveError(msg || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    name, company, email, phone, notes,
    street, city, state, zip, country,
    cardType, cardLast4, cardExpiryM, cardExpiryY, processorRef, poTerms, paymentStatus,
    alertDays, licenses, isNew, customer, userId, supabase, router,
  ]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05)_0%,_transparent_50%)] pointer-events-none" />

      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 shrink-0 min-w-0">
            <button onClick={() => router.push("/boh/customers")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm shrink-0">
              <ArrowLeft className="w-4 h-4" />
              Customers
            </button>
            <span className="text-gray-700">|</span>
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white hidden sm:block">
                {isNew ? "New Customer" : "Edit Customer"}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 min-w-0">
              <span className="text-gray-600">/</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer name…"
                className="bg-transparent border-b border-transparent hover:border-gray-600 focus:border-indigo-500 px-1 py-0.5 text-white text-sm font-medium placeholder-gray-600 focus:outline-none transition-colors min-w-[140px] max-w-[280px]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {saveError && (
              <span className="text-red-400 text-xs max-w-xs truncate hidden sm:block" title={saveError}>{saveError}</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg ${
                saved
                  ? "bg-emerald-600 text-white shadow-emerald-600/20"
                  : "bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white shadow-indigo-600/20"
              }`}
            >
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? "Saved!" : saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">

        {saveError && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/25 rounded-2xl text-sm text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {saveError}
          </div>
        )}

        {/* Customer Info */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <SectionHeader icon={<Users className="w-4 h-4" />} title="Customer Info" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Full Name">
              <TextInput value={name} onChange={setName} placeholder="Jane Smith" />
            </Field>
            <Field label="Company">
              <TextInput value={company} onChange={setCompany} placeholder="Acme Corp" />
            </Field>
            <Field label="Email">
              <TextInput value={email} onChange={setEmail} placeholder="jane@example.com" type="email" />
            </Field>
            <Field label="Phone">
              <TextInput value={phone} onChange={setPhone} placeholder="+1 555-000-0000" type="tel" />
            </Field>
            <Field label="Notes" className="md:col-span-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes about this customer…"
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm resize-none"
              />
            </Field>
          </div>
        </section>

        {/* Billing Address */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <SectionHeader icon={<MapPin className="w-4 h-4" />} title="Billing Address" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Street" className="md:col-span-2">
              <TextInput value={street} onChange={setStreet} placeholder="123 Main St" />
            </Field>
            <Field label="City">
              <TextInput value={city} onChange={setCity} placeholder="Springfield" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State">
                <TextInput value={state} onChange={setState} placeholder="IL" />
              </Field>
              <Field label="ZIP">
                <TextInput value={zip} onChange={setZip} placeholder="62701" />
              </Field>
            </div>
            <Field label="Country">
              <TextInput value={country} onChange={setCountry} placeholder="US" />
            </Field>
          </div>
        </section>

        {/* Payment Info */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <SectionHeader icon={<CreditCard className="w-4 h-4" />} title="Payment Info" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Payment Status">
              <SelectInput value={paymentStatus} onChange={(v) => setPaymentStatus(v as PaymentStatus)}>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="lapsed">Lapsed</option>
                <option value="failed">Failed</option>
              </SelectInput>
            </Field>
            <Field label="PO / Invoice Terms">
              <TextInput value={poTerms} onChange={setPoTerms} placeholder="Net-30, Net-60, COD…" />
            </Field>
            <Field label="Card on File" className="md:col-span-2">
              {!isNew && customer?.id ? (
                <StripeCardSection
                  customerId={customer.id}
                  card={{
                    card_type: cardType || null,
                    card_last4: cardLast4 || null,
                    card_expiry_month: cardExpiryM ? parseInt(cardExpiryM) : null,
                    card_expiry_year: cardExpiryY ? parseInt(cardExpiryY) : null,
                    payment_processor_ref: processorRef || null,
                  }}
                  onCardSaved={(info) => {
                    setCardType(info.card_type);
                    setCardLast4(info.card_last4);
                    setCardExpiryM(String(info.card_expiry_month));
                    setCardExpiryY(String(info.card_expiry_year));
                    setProcessorRef(info.payment_processor_ref);
                    setPaymentStatus("active");
                  }}
                  onChargeComplete={(status) => {
                    if (status === "succeeded") setPaymentStatus("active");
                    else if (status === "failed") setPaymentStatus("failed");
                    else setPaymentStatus("pending");
                  }}
                />
              ) : (
                <p className="text-xs text-gray-500">Save the customer first before adding a card.</p>
              )}
            </Field>
          </div>
        </section>

        {/* Licenses */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">Product Licenses</h2>
              <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{licenses.length}</span>
            </div>
            <div className="relative" ref={pickerRef}>
              <button
                type="button"
                onClick={() => setShowLicensePicker((p) => !p)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 text-indigo-400 rounded-lg text-xs font-medium transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Add License
                <ChevronDown className="w-3 h-3 ml-0.5" />
              </button>

              {showLicensePicker && (
                <div className="absolute right-0 top-full mt-1 z-20 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
                  {licenseTypes.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-gray-400">
                      No license types defined.{" "}
                      <button
                        onClick={() => router.push("/boh/license-types")}
                        className="text-indigo-400 hover:underline"
                      >
                        Create one first.
                      </button>
                    </div>
                  ) : (
                    licenseTypes.map((lt) => {
                      const km = LT_KIND_META[lt.type];
                      return (
                        <button
                          key={lt.id}
                          type="button"
                          onClick={() => addLicense(lt)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 transition-colors text-left border-b border-gray-700/50 last:border-0"
                        >
                          <span className={`shrink-0 ${km.color}`}>{km.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{lt.name}</p>
                            <p className="text-xs text-gray-500">
                              {km.label} &middot; {formatPrice(lt.price_cents)}
                              {lt.type === "one_time" && lt.default_executions ? ` · ${lt.default_executions} execs` : ""}
                              {lt.type === "by_endpoint" && lt.endpoint_type ? ` · ${lt.endpoint_type}` : ""}
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {licenses.length === 0 ? (
            <div className="border border-dashed border-gray-700 rounded-xl py-8 text-center">
              <Key className="w-7 h-7 text-gray-700 mx-auto mb-2" />
              <p className="text-gray-600 text-sm">No licenses yet — click &quot;Add License&quot; to add one.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {licenses.map((lic) => {
                const lt = licenseTypes.find((t) => t.id === lic.license_type_id);
                const days = daysUntil(lic.expiry_date);
                const isExpiringSoon = days !== null && days <= 30 && days >= 0;
                const isExpired = days !== null && days < 0;
                const statusMeta = LICENSE_STATUS_META[lic.status];
                const kindMeta = lt ? LT_KIND_META[lt.type] : null;

                return (
                  <div key={lic.id} className="border border-gray-700 bg-gray-800/50 rounded-xl p-4 flex flex-col gap-3">

                    {/* Header: type name + kind badge + status + expiry + delete */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {kindMeta && <span className={kindMeta.color}>{kindMeta.icon}</span>}
                          <p className="text-sm font-semibold text-white truncate">{lt?.name ?? lic.product_name}</p>
                          {kindMeta && (
                            <span className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-semibold ${kindMeta.bg} ${kindMeta.color}`}>
                              {kindMeta.label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          {lt?.description && (
                            <p className="text-xs text-gray-500 truncate">{lt.description}</p>
                          )}
                          {lt && (
                            <span className="text-xs font-semibold text-indigo-300 shrink-0">{formatPrice(lt.price_cents)}</span>
                          )}
                        </div>
                      </div>
                      <span className={`shrink-0 px-2.5 py-0.5 rounded-lg border text-xs font-semibold ${statusMeta.bg} ${statusMeta.color}`}>
                        {statusMeta.label}
                      </span>
                      {(isExpiringSoon || isExpired) && (
                        <span className="shrink-0 flex items-center gap-1 text-xs text-yellow-400">
                          <AlertTriangle className="w-3 h-3" />
                          {isExpired ? "Expired" : `${days}d`}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeLicense(lic.id)}
                        className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* one_time: executions */}
                    {lt?.type === "one_time" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Max Executions</label>
                          <input
                            type="number"
                            min="1"
                            value={lic.max_executions ?? ""}
                            onChange={(e) => updateLicense(lic.id, { max_executions: parseInt(e.target.value) || null })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Executions Used</label>
                          <p className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-400">{lic.executions_used}</p>
                        </div>
                      </div>
                    )}

                    {/* subscription: dates */}
                    {lt?.type === "subscription" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Start Date</label>
                          <input
                            type="date"
                            value={lic.start_date ?? ""}
                            onChange={(e) => updateLicense(lic.id, { start_date: e.target.value || null })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Expiry Date</label>
                          <input
                            type="date"
                            value={lic.expiry_date ?? ""}
                            onChange={(e) => updateLicense(lic.id, { expiry_date: e.target.value || null })}
                            className={`w-full bg-gray-800 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isExpiringSoon || isExpired ? "border-yellow-500/40" : "border-gray-700"}`}
                          />
                        </div>
                      </div>
                    )}

                    {/* by_endpoint: show connector */}
                    {lt?.type === "by_endpoint" && lt.endpoint_type && (
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Endpoint Type</label>
                        <p className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-medium">{lt.endpoint_type}</p>
                      </div>
                    )}

                    {/* Common fields */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="col-span-2">
                        <label className="text-xs text-gray-500 mb-1 block">License Key</label>
                        <input
                          type="text"
                          value={lic.license_key ?? ""}
                          onChange={(e) => updateLicense(lic.id, { license_key: e.target.value || null })}
                          placeholder="XXXX-XXXX-XXXX-XXXX"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Seats</label>
                        <input
                          type="number"
                          min="1"
                          value={lic.seats}
                          onChange={(e) => updateLicense(lic.id, { seats: parseInt(e.target.value) || 1 })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Status</label>
                        <div className="relative">
                          <select
                            value={lic.status}
                            onChange={(e) => updateLicense(lic.id, { status: e.target.value as LicenseStatus })}
                            className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 pr-7 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="active">Active</option>
                            <option value="trial">Trial</option>
                            <option value="expired">Expired</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Renewal</label>
                        <div className="relative">
                          <select
                            value={lic.renewal_type}
                            onChange={(e) => updateLicense(lic.id, { renewal_type: e.target.value as RenewalType })}
                            className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 pr-7 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="manual">Manual</option>
                            <option value="auto">Auto-Renew</option>
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-gray-500 mb-1 block">Notes</label>
                        <input
                          type="text"
                          value={lic.notes ?? ""}
                          onChange={(e) => updateLicense(lic.id, { notes: e.target.value || null })}
                          placeholder="License notes…"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Notification Settings */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <SectionHeader icon={<Bell className="w-4 h-4" />} title="Notification Settings" subtitle="— when to alert about upcoming expirations" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Alert days before expiry">
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={alertDays}
                  onChange={(e) => setAlertDays(e.target.value)}
                  className="w-28 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
                <span className="text-sm text-gray-400">days</span>
              </div>
              <p className="text-xs text-gray-600">
                Licenses expiring within this window will be flagged on the customer list and Dashboard.
              </p>
            </Field>
          </div>
        </section>

        {/* Footer save */}
        <div className="flex justify-end gap-3 pb-8">
          <button type="button" onClick={() => router.push("/boh/customers")}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-all">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg ${
              saved
                ? "bg-emerald-600 text-white shadow-emerald-600/20"
                : "bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white shadow-indigo-600/20"
            }`}>
            {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? "Saved!" : saving ? "Saving…" : "Save Customer"}
          </button>
        </div>
      </main>
    </div>
  );
}
