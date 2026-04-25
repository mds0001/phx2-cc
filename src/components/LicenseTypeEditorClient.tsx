"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Key, Save, Check, Users, Activity,
  RefreshCw, Zap, Tag, AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { LicenseType, LicenseTypeKind, ConnectionType } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────

const CONNECTION_TYPES: ConnectionType[] = [
  "ivanti", "ivanti_neurons", "dell", "cdw", "azure", "insight",
  "cloud", "file", "smtp", "odbc", "portal",
];

const CONNECTION_LABELS: Record<ConnectionType, string> = {
  ivanti:          "Ivanti",
  ivanti_neurons:  "Ivanti Neurons",
  dell:            "Dell",
  cdw:             "CDW",
  azure:           "Azure",
  insight:         "Insight",
  cloud:           "Cloud",
  file:            "File",
  smtp:            "SMTP",
  odbc:            "ODBC",
  portal:          "Portal",
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600">{hint}</p>}
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
      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
    />
  );
}

// ── Component ─────────────────────────────────────────────────

export default function LicenseTypeEditorClient({
  licenseType,
  isNew,
  userId,
}: {
  licenseType: LicenseType | null;
  isNew: boolean;
  userId: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState(licenseType?.name ?? "");
  const [description, setDescription] = useState(licenseType?.description ?? "");
  const [kind, setKind] = useState<LicenseTypeKind>(licenseType?.type ?? "subscription");
  const [priceDollars, setPriceDollars] = useState(
    licenseType ? (licenseType.price_cents / 100).toFixed(2) : "0.00"
  );
  const [renewalDays, setRenewalDays] = useState(String(licenseType?.renewal_notification_days ?? 30));
  const [endpointType, setEndpointType] = useState<ConnectionType | "">(
    (licenseType?.endpoint_type as ConnectionType) ?? ""
  );
  const [defaultExecutions, setDefaultExecutions] = useState(
    String(licenseType?.default_executions ?? "")
  );
  const [startDate, setStartDate] = useState(licenseType?.start_date ?? "");
  const [endDate, setEndDate]     = useState(licenseType?.end_date ?? "");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setSaveError("Name is required."); return; }
    if (kind === "by_endpoint" && !endpointType) { setSaveError("Select an endpoint type."); return; }

    const priceCents = Math.round(parseFloat(priceDollars || "0") * 100);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      type: kind,
      price_cents: isNaN(priceCents) ? 0 : priceCents,
      renewal_notification_days: parseInt(renewalDays) || 30,
      endpoint_type: kind === "by_endpoint" ? endpointType || null : null,
      default_executions: kind === "one_time" && defaultExecutions ? parseInt(defaultExecutions) : null,
      start_date: kind === "subscription" && startDate ? startDate : null,
      end_date: kind === "subscription" && endDate ? endDate : null,
    };

    setSaving(true);
    setSaveError(null);
    try {
      if (isNew) {
        const { error } = await supabase
          .from("license_types")
          .insert({ ...payload, created_by: userId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("license_types")
          .update(payload)
          .eq("id", licenseType!.id);
        if (error) throw error;
      }
      setSaved(true);
      setTimeout(() => router.push("/boh/license-types"), 1000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [name, description, kind, priceDollars, renewalDays, endpointType, defaultExecutions, startDate, endDate, isNew, licenseType, userId, supabase, router]);

  const KIND_OPTIONS: { value: LicenseTypeKind; label: string; desc: string; icon: React.ReactNode }[] = [
    {
      value: "one_time",
      label: "One-Time",
      desc: "A fixed block of task executions. Once used up, the license is exhausted.",
      icon: <Zap className="w-4 h-4" />,
    },
    {
      value: "subscription",
      label: "Subscription",
      desc: "All tasks run freely within a start/end date window. Renewable.",
      icon: <RefreshCw className="w-4 h-4" />,
    },
    {
      value: "by_endpoint",
      label: "By Endpoint",
      desc: "Grants access to run scheduled tasks using a specific connector type at any time.",
      icon: <Activity className="w-4 h-4" />,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/boh/license-types")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              License Types
            </button>
            <span className="text-gray-700">|</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
                <Key className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">
                {isNew ? "New License Type" : licenseType?.name}
              </span>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-600/20"
          >
            {saved ? (
              <><Check className="w-4 h-4" /> Saved!</>
            ) : saving ? (
              <><Save className="w-4 h-4 animate-pulse" /> Saving…</>
            ) : (
              <><Save className="w-4 h-4" /> {isNew ? "Create" : "Save Changes"}</>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {saveError && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/25 text-red-300 rounded-xl px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {saveError}
          </div>
        )}

        {/* Basic info */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Tag className="w-4 h-4 text-indigo-400" />
            Basic Info
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Name" >
              <TextInput value={name} onChange={setName} placeholder="e.g. LuminaGrid Pro Annual" />
            </Field>
            <Field label="Price">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-8 pr-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </Field>
            <Field label="Description" >
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Optional description…"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm resize-none md:col-span-2"
              />
            </Field>
          </div>
        </section>

        {/* License type */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Key className="w-4 h-4 text-indigo-400" />
            License Type
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setKind(opt.value)}
                className={`flex flex-col gap-2 p-4 rounded-xl border text-left transition-all ${
                  kind === opt.value
                    ? "border-indigo-500/50 bg-indigo-500/10"
                    : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={kind === opt.value ? "text-indigo-400" : "text-gray-500"}>
                    {opt.icon}
                  </span>
                  <span className={`text-sm font-semibold ${kind === opt.value ? "text-white" : "text-gray-400"}`}>
                    {opt.label}
                  </span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{opt.desc}</p>
              </button>
            ))}
          </div>

          {/* Type-specific fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {kind === "by_endpoint" && (
              <Field label="Endpoint Type" hint="Which connector type this license covers">
                <select
                  value={endpointType}
                  onChange={(e) => setEndpointType(e.target.value as ConnectionType)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                >
                  <option value="">— Select endpoint type —</option>
                  {CONNECTION_TYPES.map((ct) => (
                    <option key={ct} value={ct}>{CONNECTION_LABELS[ct]}</option>
                  ))}
                </select>
              </Field>
            )}

            {kind === "one_time" && (
              <Field label="Default Executions" hint="Number of task runs included in this license">
                <TextInput
                  value={defaultExecutions}
                  onChange={(v) => setDefaultExecutions(v.replace(/\D/g, ""))}
                  placeholder="e.g. 100"
                  type="number"
                />
              </Field>
            )}

            {kind === "subscription" && (
              <>
                <Field label="Start Date" hint="When the subscription period begins">
                  <TextInput value={startDate} onChange={setStartDate} type="date" />
                </Field>
                <Field label="End Date" hint="When the subscription period expires">
                  <TextInput value={endDate} onChange={setEndDate} type="date" />
                </Field>
                <Field label="Renewal Notification (days)" hint="Alert days before expiry">
                  <TextInput
                    value={renewalDays}
                    onChange={(v) => setRenewalDays(v.replace(/\D/g, ""))}
                    placeholder="30"
                    type="number"
                  />
                </Field>
              </>
            )}
          </div>
        </section>

      </main>
    </div>
  );
}
