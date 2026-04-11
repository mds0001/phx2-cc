"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plug, Save, Check, Eye, EyeOff,
  File, Cloud, Mail, Database, Globe,
  Upload, X, FileText, Loader2, Zap,
  Wifi, WifiOff, FlaskConical,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { EndpointConnection, ConnectionType } from "@/lib/types";

// ── Type metadata ────────────────────────────────────────────
const TYPE_OPTIONS: { value: ConnectionType; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: "file",   label: "File",    icon: <File     className="w-5 h-5" />, desc: "Local or network file path" },
  { value: "cloud",  label: "Cloud",   icon: <Cloud    className="w-5 h-5" />, desc: "Cloud API endpoint" },
  { value: "smtp",   label: "SMTP",    icon: <Mail     className="w-5 h-5" />, desc: "Email / SMTP server" },
  { value: "odbc",   label: "ODBC",    icon: <Database className="w-5 h-5" />, desc: "Database via ODBC" },
  { value: "portal", label: "Portal",  icon: <Globe    className="w-5 h-5" />, desc: "Web portal / API" },
  { value: "ivanti", label: "Ivanti",  icon: <Zap      className="w-5 h-5" />, desc: "Ivanti Neurons for Service Management" },
];

const TYPE_COLOR: Record<ConnectionType, string> = {
  file:   "bg-amber-500/10 border-amber-500/40 text-amber-400",
  cloud:  "bg-sky-500/10 border-sky-500/40 text-sky-400",
  smtp:   "bg-emerald-500/10 border-emerald-500/40 text-emerald-400",
  odbc:   "bg-violet-500/10 border-violet-500/40 text-violet-400",
  portal: "bg-rose-500/10 border-rose-500/40 text-rose-400",
  ivanti: "bg-orange-500/10 border-orange-500/40 text-orange-400",
};

const TYPE_RING: Record<ConnectionType, string> = {
  file:   "ring-amber-500",
  cloud:  "ring-sky-500",
  smtp:   "ring-emerald-500",
  odbc:   "ring-violet-500",
  portal: "ring-rose-500",
  ivanti: "ring-orange-500",
};

// ── Field helper components ──────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function TextInput({
  value, onChange, placeholder, type = "text",
}: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
    />
  );
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Password"}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-11 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ── File browser form ────────────────────────────────────────
function FileForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const storedPath = config.file_path ?? "";
  const fileName = storedPath ? storedPath.split("/").pop() ?? storedPath : null;

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const ext = file.name.split(".").pop();
      const path = `connections/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("task_files").upload(path, file, { upsert: true });
      if (error) throw error;
      onChange("file_path", path);
      onChange("file_name", file.name);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function clearFile() {
    onChange("file_path", "");
    onChange("file_name", "");
    if (inputRef.current) inputRef.current.value = "";
  }

  const displayName = config.file_name || fileName;

  return (
    <Field label="File">
      {displayName ? (
        /* File already selected */
        <div className="flex items-center gap-3 bg-gray-800 border border-amber-500/30 rounded-xl px-4 py-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">{displayName}</p>
            <p className="text-xs text-gray-500 truncate">{storedPath}</p>
          </div>
          <button
            type="button"
            onClick={clearFile}
            className="shrink-0 text-gray-500 hover:text-red-400 transition-colors"
            title="Remove file"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Drop zone */
        <label
          className={`block cursor-pointer rounded-xl border-2 border-dashed transition-all ${
            dragOver
              ? "border-amber-500 bg-amber-500/10"
              : "border-gray-600 hover:border-amber-500/50 hover:bg-gray-800/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center gap-3 px-6 py-8">
            {uploading ? (
              <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Upload className="w-5 h-5 text-amber-400" />
              </div>
            )}
            <div className="text-center">
              <p className="text-sm font-medium text-white">
                {uploading ? "Uploading…" : "Drop a file here or click to browse"}
              </p>
              <p className="text-xs text-gray-500 mt-1">Any file type supported</p>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleInputChange}
            disabled={uploading}
          />
        </label>
      )}

      {/* Replace button when file is set */}
      {displayName && !uploading && (
        <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 hover:text-amber-400 transition-colors w-fit">
          <Upload className="w-3.5 h-3.5" />
          Replace file
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleInputChange}
          />
        </label>
      )}

      {uploadError && (
        <p className="text-xs text-red-400">{uploadError}</p>
      )}
    </Field>
  );
}

function CloudForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <>
      <Field label="URL">
        <TextInput value={config.url ?? ""} onChange={(v) => onChange("url", v)} placeholder="https://api.example.com" type="url" />
      </Field>
      <Field label="Customer ID">
        <TextInput value={config.customer_id ?? ""} onChange={(v) => onChange("customer_id", v)} placeholder="Customer ID" />
      </Field>
      <Field label="Customer Secret">
        <PasswordInput value={config.customer_secret ?? ""} onChange={(v) => onChange("customer_secret", v)} placeholder="Customer Secret" />
      </Field>
    </>
  );
}

function SmtpForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Field label="Server">
            <TextInput value={config.server ?? ""} onChange={(v) => onChange("server", v)} placeholder="smtp.example.com" />
          </Field>
        </div>
        <Field label="Port">
          <TextInput value={config.port ?? "587"} onChange={(v) => onChange("port", v)} placeholder="587" type="number" />
        </Field>
      </div>
      <Field label="Login Name">
        <TextInput value={config.login_name ?? ""} onChange={(v) => onChange("login_name", v)} placeholder="user@example.com" />
      </Field>
      <Field label="Password">
        <PasswordInput value={config.password ?? ""} onChange={(v) => onChange("password", v)} />
      </Field>
    </>
  );
}

function OdbcForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Field label="Server Name">
            <TextInput value={config.server_name ?? ""} onChange={(v) => onChange("server_name", v)} placeholder="db.example.com or 192.168.1.1" />
          </Field>
        </div>
        <Field label="Port">
          <TextInput value={config.port ?? "1433"} onChange={(v) => onChange("port", v)} placeholder="1433" type="number" />
        </Field>
      </div>
      <Field label="Login Name">
        <TextInput value={config.login_name ?? ""} onChange={(v) => onChange("login_name", v)} placeholder="sa or domain\user" />
      </Field>
      <Field label="Password">
        <PasswordInput value={config.password ?? ""} onChange={(v) => onChange("password", v)} />
      </Field>
    </>
  );
}

function PortalForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <>
      <Field label="URL">
        <TextInput value={config.url ?? ""} onChange={(v) => onChange("url", v)} placeholder="https://portal.example.com" type="url" />
      </Field>
      <Field label="Login Name">
        <TextInput value={config.login_name ?? ""} onChange={(v) => onChange("login_name", v)} placeholder="Username or email" />
      </Field>
      <Field label="Password">
        <PasswordInput value={config.password ?? ""} onChange={(v) => onChange("password", v)} />
      </Field>
    </>
  );
}

function IvantiForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 bg-orange-500/10 border border-orange-500/20 rounded-xl">
        <Zap className="w-4 h-4 text-orange-400 shrink-0" />
        <p className="text-xs text-orange-300">Ivanti Neurons for Service Management — REST API connection</p>
      </div>

      <Field label="Base URL">
        <TextInput
          value={config.url ?? ""}
          onChange={(v) => onChange("url", v)}
          placeholder="https://your-instance.ivanticloud.com"
          type="url"
        />
      </Field>

      <Field label="REST API Key">
        <PasswordInput
          value={config.api_key ?? ""}
          onChange={(v) => onChange("api_key", v)}
          placeholder="e.g. 251E668B0B42478EB3DA9D6E8446CA0B"
        />
      </Field>

      <Field label="Business Object">
        <div className="flex gap-2">
          <TextInput
            value={config.business_object ?? "CI__Computers"}
            onChange={(v) => onChange("business_object", v)}
            placeholder="CI__Computers"
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          OData business object name — used in the endpoint path{" "}
          <span className="text-gray-600 font-mono">/api/odata/businessobject/&#123;name&#125;</span>
        </p>
      </Field>

      <Field label="Tenant ID (optional)">
        <TextInput
          value={config.tenant_id ?? ""}
          onChange={(v) => onChange("tenant_id", v)}
          placeholder="Leave blank if not required"
        />
      </Field>
    </>
  );
}

// ── Main editor ───────────────────────────────────────────────
export default function ConnectionEditorClient({
  connection,
  isNew,
  userId,
}: {
  connection: EndpointConnection | null;
  isNew: boolean;
  userId: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState(connection?.name ?? "");
  const [type, setType] = useState<ConnectionType>(connection?.type ?? "file");
  const [config, setConfig] = useState<Record<string, string>>(
    (connection?.config as Record<string, string>) ?? {}
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function setConfigField(key: string, value: string) {
    setConfig((p) => ({ ...p, [key]: value }));
    setTestResult(null);
  }

  // Reset config when type changes
  function handleTypeChange(t: ConnectionType) {
    setTestResult(null);
    setType(t);
    setConfig(
      t === "odbc"   ? { port: "1433" } :
      t === "smtp"   ? { port: "587" } :
      t === "ivanti" ? { business_object: "CI__Computers", api_key: "251E668B0B42478EB3DA9D6E8446CA0B" } :
      {}
    );
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, config }),
      });
      const data = await res.json();
      setTestResult({ ok: data.success, message: data.message });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setSaveError("Connection name is required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = { name: name.trim(), type, config, created_by: userId };
      if (isNew) {
        const { data, error } = await supabase
          .from("endpoint_connections").insert(payload).select("id").single();
        if (error) throw error;
        setSaved(true);
        setTimeout(() => router.replace(`/connections/${data.id}`), 800);
      } else {
        const { error } = await supabase
          .from("endpoint_connections").update(payload).eq("id", connection!.id);
        if (error) throw error;
        setSaved(true);
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
  }, [name, type, config, userId, isNew, connection, supabase, router]);

  const selectedMeta = TYPE_OPTIONS.find((t) => t.value === type)!;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(20,184,166,0.05)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 shrink-0">
            <button
              onClick={() => router.push("/connections")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Connections
            </button>
            <span className="text-gray-700">|</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center">
                <Plug className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">
                {isNew ? "New Connection" : "Edit Connection"}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-gray-600">/</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Connection name…"
                className="bg-transparent border-b border-transparent hover:border-gray-600 focus:border-teal-500 px-1 py-0.5 text-white text-sm font-medium placeholder-gray-600 focus:outline-none transition-colors min-w-[160px] max-w-[300px]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {saveError && (
              <span className="text-red-400 text-xs max-w-xs truncate" title={saveError}>
                {saveError}
              </span>
            )}
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || saving}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
            >
              {testing
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <FlaskConical className="w-4 h-4" />}
              {testing ? "Testing…" : "Test"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || testing}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg ${
                saved
                  ? "bg-emerald-600 text-white shadow-emerald-600/20"
                  : "bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white shadow-teal-600/20"
              }`}
            >
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? "Saved!" : saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-8">

        {/* Type Selector */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Connection Type</h2>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {TYPE_OPTIONS.map((opt) => {
              const active = type === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleTypeChange(opt.value)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all ${
                    active
                      ? `${TYPE_COLOR[opt.value]} ring-2 ${TYPE_RING[opt.value]}`
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                  }`}
                >
                  {opt.icon}
                  <span className="text-xs font-semibold">{opt.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-500">{selectedMeta.desc}</p>
        </section>

        {/* Dynamic Config Fields */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <span className={TYPE_COLOR[type].split(" ")[2]}>{selectedMeta.icon}</span>
            {selectedMeta.label} Configuration
          </h2>

          {/* Test result banner */}
          {testResult && (
            <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm ${
              testResult.ok
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                : "bg-red-500/10 border-red-500/25 text-red-300"
            }`}>
              {testResult.ok
                ? <Wifi    className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                : <WifiOff className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />}
              <div>
                <p className="font-semibold">{testResult.ok ? "Connection successful" : "Connection failed"}</p>
                <p className="text-xs opacity-80 mt-0.5">{testResult.message}</p>
              </div>
            </div>
          )}

          {type === "file"   && <FileForm   config={config} onChange={setConfigField} />}
          {type === "cloud"  && <CloudForm  config={config} onChange={setConfigField} />}
          {type === "smtp"   && <SmtpForm   config={config} onChange={setConfigField} />}
          {type === "odbc"   && <OdbcForm   config={config} onChange={setConfigField} />}
          {type === "portal" && <PortalForm config={config} onChange={setConfigField} />}
          {type === "ivanti" && <IvantiForm config={config} onChange={setConfigField} />}
        </section>

        {/* Save footer */}
        <div className="flex justify-end gap-3 pb-8">
          <button
            type="button"
            onClick={() => router.push("/connections")}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg ${
              saved
                ? "bg-emerald-600 text-white shadow-emerald-600/20"
                : "bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white shadow-teal-600/20"
            }`}
          >
            {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? "Saved!" : saving ? "Saving…" : "Save Connection"}
          </button>
        </div>
      </main>
    </div>
  );
}
