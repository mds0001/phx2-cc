"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plug, Save, Check, Eye, EyeOff, Copy,
  File, Cloud, Mail, Database, Globe,
  Upload, X, FileText, Loader2, Zap, Download,
  FolderOpen, Folder, ChevronRight, Home,
  Wifi, WifiOff, FlaskConical, ShoppingCart, Package, Building2, Search, Bot,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { EndpointConnection, ConnectionType } from "@/lib/types";
import type { CustomerOption } from "@/components/CustomerSwitcher";

// ── Type metadata ────────────────────────────────────────────
const TYPE_OPTIONS: { value: ConnectionType; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: "file",   label: "File",    icon: <File     className="w-5 h-5" />, desc: "Local or network file path" },
  { value: "cloud",  label: "Cloud",   icon: <Cloud    className="w-5 h-5" />, desc: "Cloud API endpoint" },
  { value: "smtp",   label: "SMTP",    icon: <Mail     className="w-5 h-5" />, desc: "Email / SMTP server" },
  { value: "odbc",   label: "ODBC",    icon: <Database className="w-5 h-5" />, desc: "Database via ODBC" },
  { value: "portal", label: "Portal",  icon: <Globe    className="w-5 h-5" />, desc: "Web portal / API" },
  { value: "ivanti", label: "Ivanti ITSM",  icon: <Zap          className="w-5 h-5" />, desc: "Ivanti Neurons for Service Management (OData REST API)" },
  { value: "ivanti_neurons", label: "Ivanti Neurons", icon: <Search className="w-5 h-5" />, desc: "Ivanti Neurons People & Device Inventory API (OAuth2)" },
  { value: "dell",   label: "Dell",    icon: <ShoppingCart className="w-5 h-5" />, desc: "Dell Premier API — catalog, quotes & orders" },
  { value: "cdw",    label: "CDW",     icon: <Package      className="w-5 h-5" />, desc: "CDW API — PO status, orders & catalog" },
  { value: "azure",  label: "Azure",   icon: <Building2    className="w-5 h-5" />, desc: "Azure Enterprise App — OAuth2 client credentials" },
];

const TYPE_COLOR: Record<ConnectionType, string> = {
  file:   "bg-amber-500/10 border-amber-500/40 text-amber-400",
  cloud:  "bg-sky-500/10 border-sky-500/40 text-sky-400",
  smtp:   "bg-emerald-500/10 border-emerald-500/40 text-emerald-400",
  odbc:   "bg-violet-500/10 border-violet-500/40 text-violet-400",
  portal: "bg-rose-500/10 border-rose-500/40 text-rose-400",
  ivanti: "bg-orange-500/10 border-orange-500/40 text-orange-400",
  dell:   "bg-blue-500/10 border-blue-500/40 text-blue-400",
  cdw:    "bg-red-500/10 border-red-500/40 text-red-400",
  azure:  "bg-cyan-500/10 border-cyan-500/40 text-cyan-400",
  ivanti_neurons: "bg-indigo-500/10 border-indigo-500/40 text-indigo-400",
};

const TYPE_RING: Record<ConnectionType, string> = {
  file:   "ring-amber-500",
  cloud:  "ring-sky-500",
  smtp:   "ring-emerald-500",
  odbc:   "ring-violet-500",
  portal: "ring-rose-500",
  ivanti: "ring-orange-500",
  dell:   "ring-blue-500",
  cdw:    "ring-red-500",
  azure:  "ring-cyan-500",
  ivanti_neurons: "ring-indigo-500",
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


// ── Storage folder browser ────────────────────────────────────
function StorageBrowser({ onSelect, onClose }: { onSelect: (path: string) => void; onClose: () => void }) {
  const supabase = createClient();
  const [currentPath, setCurrentPath] = useState<string>("");
  const [items, setItems] = useState<{ name: string; id: string | null }[]>([]);
  const [loading, setLoading] = useState(false);

  async function listFolder(prefix: string) {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage.from("task_files").list(prefix || undefined, { limit: 200 });
      if (error) throw error;
      setItems(data ?? []);
      setCurrentPath(prefix);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  // load root on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { listFolder(""); }, []);

  const folders = items.filter((i) => i.id === null); // folders have no id
  const breadcrumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];

  function navigateTo(parts: string[]) {
    listFolder(parts.length ? parts.join("/") + "/" : "");
  }

  const displayPath = currentPath || "/";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl flex flex-col" style={{ maxHeight: "70vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-amber-400" />
            Select Directory
          </h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-all">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-gray-800 flex-wrap">
          <button onClick={() => navigateTo([])} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
            <Home className="w-3.5 h-3.5" />
          </button>
          {breadcrumbs.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-gray-600" />
              <button
                onClick={() => navigateTo(breadcrumbs.slice(0, i + 1))}
                className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="overflow-y-auto flex-1 px-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
            </div>
          ) : folders.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-8">No sub-folders here</p>
          ) : (
            folders.map((folder) => {
              const fullPath = currentPath ? `${currentPath}${folder.name}/` : `${folder.name}/`;
              return (
                <div key={folder.name} className="flex items-center gap-2 rounded-lg hover:bg-gray-800 px-2 py-1.5 group cursor-pointer"
                  onClick={() => listFolder(fullPath)}>
                  <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm text-white flex-1 truncate">{folder.name}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 shrink-0" />
                </div>
              );
            })
          )}
        </div>

        {/* Footer: select current or type new subfolder */}
        <div className="border-t border-gray-800 px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500 truncate">Selected: <span className="text-amber-400">{displayPath}</span></p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-semibold rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => { onSelect(currentPath); onClose(); }}
              className="flex-1 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-sm font-semibold rounded-xl transition-all"
            >
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── File form ─────────────────────────────────────────────────
const FILE_TYPES = ["xlsx", "json", "xml", "csv"] as const;

function FileForm({ config, onChange, agents, agentId, onAgentChange, customerId }: {
  config: Record<string, string>;
  onChange: (k: string, v: string) => void;
  agents: { id: string; name: string; status: string; customer_id: string }[];
  agentId: string | null;
  onAgentChange: (id: string | null) => void;
  customerId: string | null;
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileType = (config.file_type ?? "xlsx") as string;
  const fileMode = (config.file_mode ?? "file") as "file" | "directory" | "local";
  const [showBrowser, setShowBrowser] = useState(false);

  async function handleFilePick(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
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

  function clearFile() {
    onChange("file_path", "");
    onChange("file_name", "");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDownload() {
    if (!config.file_path) return;
    const { data, error } = await supabase.storage.from("task_files").download(config.file_path);
    if (error || !data) { alert("Download failed: " + error?.message); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = config.file_name ?? config.file_path.split("/").pop() ?? "file";
    a.click();
    URL.revokeObjectURL(url);
  }

  const displayName = config.file_name ?? (config.file_path ? config.file_path.split("/").pop() : null);

  return (
    <>
      {/* File Type */}
      <Field label="File Type">
        <div className="flex gap-2">
          {FILE_TYPES.map((ft) => (
            <button
              key={ft}
              type="button"
              onClick={() => onChange("file_type", ft)}
              className={`flex-1 px-3 py-2 rounded-xl border text-xs font-semibold uppercase tracking-wider transition-all ${
                fileType === ft
                  ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:border-amber-500/40 hover:text-amber-400"
              }`}
            >
              {ft}
            </button>
          ))}
        </div>
      </Field>

      {/* Mode: specific file vs directory */}
      <Field label="Target">
        <div className="flex gap-2 mb-3">
          {(["file", "directory", "local"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onChange("file_mode", m);
                onChange("file_path", "");
                onChange("file_name", "");
                onChange("output_file_name", "");
              }}
              className={`flex-1 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                fileMode === m
                  ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:border-amber-500/40 hover:text-amber-400"
              }`}
            >
              {m === "file" ? "Specific File" : m === "directory" ? "Directory" : "Local (Agent)"}
            </button>
          ))}
        </div>

        {fileMode === "file" ? (
          /* ── Specific file: upload / drop zone ── */
          <>
            {displayName ? (
              <div className="flex items-center gap-3 bg-gray-800 border border-amber-500/30 rounded-xl px-4 py-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{displayName}</p>
                  <p className="text-xs text-gray-500 truncate">{config.file_path}</p>
                </div>
                <button type="button" onClick={clearFile} className="shrink-0 text-gray-500 hover:text-red-400 transition-colors" title="Remove file">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label
                className={`block cursor-pointer rounded-xl border-2 border-dashed transition-all ${
                  dragOver ? "border-amber-500 bg-amber-500/10" : "border-gray-600 hover:border-amber-500/50 hover:bg-gray-800/50"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFilePick(f); }}
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
                    <p className="text-sm font-medium text-white">{uploading ? "Uploading…" : "Drop a file here or click to browse"}</p>
                    <p className="text-xs text-gray-500 mt-1">.{fileType} file</p>
                  </div>
                </div>
                <input ref={inputRef} type="file" className="hidden" accept={`.${fileType}`}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); }}
                  disabled={uploading} />
              </label>
            )}
            {displayName && !uploading && (
              <div className="flex items-center gap-4 mt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 hover:text-amber-400 transition-colors w-fit">
                  <Upload className="w-3.5 h-3.5" />
                  Replace file
                  <input ref={inputRef} type="file" className="hidden" accept={`.${fileType}`}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); }} />
                </label>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex items-center gap-2 text-xs text-gray-500 hover:text-amber-400 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
              </div>
            )}
          </>
        ) : fileMode === "local" ? (
          /* -- Local (Agent) mode -- */
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Local file path on agent machine</label>
              <input
                type="text"
                value={config.file_path ?? ""}
                onChange={(e) => onChange("file_path", e.target.value)}
                placeholder="e.g. C:\\Users\\mike\\data\\computers.xlsx"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-mono"
              />
              <p className="text-xs text-gray-600 mt-1">Full path on the agent machine -- the agent reads this file directly</p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1 flex items-center gap-1.5"><Bot className="w-3.5 h-3.5 text-indigo-400" /> Agent</label>
              {!customerId ? (
                <p className="text-xs text-amber-500">Assign a customer to this endpoint first, then an agent can be selected.</p>
              ) : (() => {
                const filtered = agents.filter((a) => a.customer_id === customerId);
                return filtered.length === 0 ? (
                  <p className="text-xs text-gray-600">No agents registered for this customer. Go to Admin &rarr; Agents to register one.</p>
                ) : (
                  <select
                    value={agentId ?? ""}
                    onChange={(e) => onAgentChange(e.target.value || null)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  >
                    <option value="">Select agent...</option>
                    {filtered.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.status})
                      </option>
                    ))}
                  </select>
                );
              })()}
            </div>
          </div>
        ) : (
          /* ── Directory mode ── */
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Directory path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.file_path ?? ""}
                  onChange={(e) => onChange("file_path", e.target.value)}
                  placeholder="e.g. exports/reports/"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShowBrowser(true)}
                  className="px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-amber-400 rounded-xl transition-all shrink-0"
                  title="Browse storage folders"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-1">Storage folder where files will be written</p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">File name <span className="text-gray-600">(optional — leave blank to auto-generate)</span></label>
              <input
                type="text"
                value={config.output_file_name ?? ""}
                onChange={(e) => onChange("output_file_name", e.target.value)}
                placeholder={`e.g. my_export.${fileType}`}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
          </div>
        )}
      </Field>

      {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
      {showBrowser && (
        <StorageBrowser
          onSelect={(p) => onChange("file_path", p)}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </>
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
      <Field label="From Address (optional)">
        <TextInput value={config.from_address ?? ""} onChange={(v) => onChange("from_address", v)} placeholder="noreply@example.com — defaults to Login Name if blank" />
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

function AzureForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
        <Building2 className="w-4 h-4 text-cyan-400 shrink-0" />
        <p className="text-xs text-cyan-300">Azure Enterprise App — OAuth2 client credentials flow (application permissions)</p>
      </div>

      <Field label="Tenant ID">
        <TextInput
          value={config.tenant_id ?? ""}
          onChange={(v) => onChange("tenant_id", v)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
        <p className="text-xs text-gray-500 mt-1">Found in Azure Portal under Azure Active Directory &rarr; Overview</p>
      </Field>

      <Field label="Client ID (Application ID)">
        <TextInput
          value={config.client_id ?? ""}
          onChange={(v) => onChange("client_id", v)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
        <p className="text-xs text-gray-500 mt-1">App Registration &rarr; Overview &rarr; Application (client) ID</p>
      </Field>

      <Field label="Client Secret">
        <PasswordInput
          value={config.client_secret ?? ""}
          onChange={(v) => onChange("client_secret", v)}
          placeholder="App Registration secret value"
        />
        <p className="text-xs text-gray-500 mt-1">App Registration &rarr; Certificates &amp; secrets &rarr; New client secret</p>
      </Field>

      <Field label="Scope">
        <TextInput
          value={config.scope ?? ""}
          onChange={(v) => onChange("scope", v)}
          placeholder="https://graph.microsoft.com/.default"
        />
        <p className="text-xs text-gray-500 mt-1">The resource URI followed by <span className="font-mono text-gray-400">/.default</span> for application permissions</p>
      </Field>

      <Field label="Base URL">
        <TextInput
          value={config.base_url ?? ""}
          onChange={(v) => onChange("base_url", v)}
          placeholder="https://graph.microsoft.com/v1.0"
          type="url"
        />
        <p className="text-xs text-gray-500 mt-1">The API base URL requests will be sent to after authentication</p>
      </Field>
    </>
  );
}

function IvantiForm({
  config, onChange,
}: {
  config: Record<string, string>;
  onChange: (k: string, v: string) => void;
}) {
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

      <div className="flex items-center gap-2 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
        <span className="text-xs text-yellow-300">
          <strong>Binary field uploads</strong> (e.g. <code>ivnt_CatalogImage</code>) require an authenticated web session.
          Enter admin credentials below to enable image uploads via the Ivanti UI upload handler.
          Leave blank if you are not uploading images.
        </span>
      </div>

      <Field label="Login Username (optional)">
        <TextInput
          value={config.login_username ?? ""}
          onChange={(v) => onChange("login_username", v)}
          placeholder="admin@example.com"
        />
        <p className="text-xs text-gray-500 mt-1">
          Ivanti web UI username — used only for binary field (image) uploads
        </p>
      </Field>

      <Field label="Login Password (optional)">
        <PasswordInput
          value={config.login_password ?? ""}
          onChange={(v) => onChange("login_password", v)}
          placeholder="Web UI password"
        />
      </Field>

    </>
  );
}

function DellForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
        <ShoppingCart className="w-4 h-4 text-blue-400 shrink-0" />
        <p className="text-xs text-blue-300">Dell Premier API — OAuth 2.0 (Client Credentials). Credentials are provided by your Dell Account Representative via TechDirect.</p>
      </div>

      <Field label="Base URL">
        <TextInput
          value={config.base_url ?? "https://apigtwb2c.us.dell.com"}
          onChange={(v) => onChange("base_url", v)}
          placeholder="https://apigtwb2c.us.dell.com"
          type="url"
        />
        <p className="text-xs text-gray-500 mt-1">Dell API Gateway — do not change unless instructed by Dell</p>
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Client ID">
          <TextInput
            value={config.client_id ?? ""}
            onChange={(v) => onChange("client_id", v)}
            placeholder="Provided by Dell Integration Team"
          />
        </Field>
        <Field label="Client Secret">
          <PasswordInput
            value={config.client_secret ?? ""}
            onChange={(v) => onChange("client_secret", v)}
            placeholder="Provided by Dell Integration Team"
          />
        </Field>
      </div>

      <Field label="X-Forwarded-Client-ID">
        <TextInput
          value={config.forwarded_client_id ?? ""}
          onChange={(v) => onChange("forwarded_client_id", v)}
          placeholder="e.g. CA_17_12_Test_CN_CLIENTID_Catalog"
        />
        <p className="text-xs text-gray-500 mt-1">Required header value provided by Dell — identifies your integration to the API Gateway</p>
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Premier Account / Store ID (optional)">
          <TextInput
            value={config.premier_account_id ?? ""}
            onChange={(v) => onChange("premier_account_id", v)}
            placeholder="Your Dell Premier account ID"
          />
        </Field>
        <Field label="OAuth Scope">
          <TextInput
            value={config.scope ?? "oob"}
            onChange={(v) => onChange("scope", v)}
            placeholder="oob"
          />
          <p className="text-xs text-gray-500 mt-1">Default: <span className="font-mono">oob</span></p>
        </Field>
      </div>

      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 text-xs text-gray-400 space-y-1.5">
        <p className="font-semibold text-gray-300">Available APIs with these credentials:</p>
        <p>• <span className="text-blue-400 font-mono">POST /auth/oauth/v2/token</span> — get Bearer token (auto-managed)</p>
        <p>• <span className="text-blue-400 font-mono">GET /PROD/CatalogAPI/</span> — product catalog &amp; negotiated pricing</p>
        <p>• <span className="text-blue-400 font-mono">GET /api/quote/{"{QuoteNumber}/{QuoteVersion}/{locale}"}</span> — quote details</p>
        <p>• <span className="text-blue-400 font-mono">GET /v1/premier/orderstatus</span> — order status by date range</p>
        <p>• <span className="text-blue-400 font-mono">POST</span> — Purchase Order, POA, ASN, Invoice APIs</p>
      </div>
    </>
  );
}

function CdwForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
        <Package className="w-4 h-4 text-red-400 shrink-0" />
        <p className="text-xs text-red-300">
          CDW API access requires approval. Contact{" "}
          <span className="font-mono">apiuser@cdw.com</span> with your account number and use-case.
          Once approved, CDW provides endpoint URLs and subscription keys via their Azure API Management portal.
        </p>
      </div>

      <Field label="Base URL">
        <TextInput
          value={config.base_url ?? "https://portal.apiconnect.cdw.com"}
          onChange={(v) => onChange("base_url", v)}
          placeholder="https://portal.apiconnect.cdw.com"
          type="url"
        />
        <p className="text-xs text-gray-500 mt-1">
          Endpoint URL provided by CDW — typically under{" "}
          <span className="font-mono">portal.apiconnect.cdw.com</span>
        </p>
      </Field>

      <Field label="Subscription Key">
        <PasswordInput
          value={config.subscription_key ?? ""}
          onChange={(v) => onChange("subscription_key", v)}
          placeholder="Ocp-Apim-Subscription-Key value from CDW portal"
        />
        <p className="text-xs text-gray-500 mt-1">
          Azure API Management subscription key — sent as{" "}
          <span className="font-mono">Ocp-Apim-Subscription-Key</span> header
        </p>
      </Field>

      <Field label="CDW Account Number (optional)">
        <TextInput
          value={config.account_number ?? ""}
          onChange={(v) => onChange("account_number", v)}
          placeholder="Your CDW customer account number"
        />
      </Field>

      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 text-xs text-gray-400 space-y-1.5">
        <p className="font-semibold text-gray-300">Available APIs (after approval):</p>
        <p>• <span className="text-red-400 font-mono">PO Status API</span> — real-time purchase order status &amp; history</p>
        <p>• <span className="text-red-400 font-mono">Customer Order API</span> — submit and track orders</p>
        <p>• <span className="text-red-400 font-mono">PO Confirmation API</span> — acknowledge CDW purchase orders</p>
        <p>• <span className="text-red-400 font-mono">Catalog / Pricing API</span> — product catalog and negotiated pricing</p>
        <p>• <span className="text-red-400 font-mono">eProcurement (cXML / EDI)</span> — deep ERP integrations (Ariba, Coupa, Oracle)</p>
        <p className="pt-1 text-gray-500">Developer portal: <span className="font-mono">portal.apiconnect.cdw.com</span></p>
      </div>
    </>
  );
}

function IvantiNeuronsForm({ config, onChange }: { config: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
        <Search className="w-4 h-4 text-indigo-400 shrink-0" />
        <p className="text-xs text-indigo-300">
          Ivanti Neurons People &amp; Device Inventory API — OAuth2 client credentials. Requires an App Registration in your Neurons console (<span className="font-mono">Admin → App Registrations</span>).
        </p>
      </div>

      <Field label="Auth URL">
        <TextInput
          value={config.auth_url ?? ""}
          onChange={(v) => onChange("auth_url", v)}
          placeholder="https://<tenant>.ivanticloud.com/<tenant-id>/connect/token"
          type="url"
        />
        <p className="text-xs text-gray-500 mt-1">Token endpoint copied from your App Registration in the Neurons console</p>
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Client ID">
          <TextInput
            value={config.client_id ?? ""}
            onChange={(v) => onChange("client_id", v)}
            placeholder="App Registration Client ID"
          />
        </Field>
        <Field label="Client Secret">
          <PasswordInput
            value={config.client_secret ?? ""}
            onChange={(v) => onChange("client_secret", v)}
            placeholder="App Registration Client Secret"
          />
        </Field>
      </div>

      <Field label="Tenant Base URL">
        <TextInput
          value={config.base_url ?? ""}
          onChange={(v) => onChange("base_url", v)}
          placeholder="https://<tenant>.ivanticloud.com"
          type="url"
        />
        <p className="text-xs text-gray-500 mt-1">Your Ivanti Neurons tenant root URL — the API path is added automatically</p>
      </Field>

      <Field label="Dataset">
        <div className="flex gap-2">
          {(["devices", "people"] as const).map((ds) => (
            <button
              key={ds}
              type="button"
              onClick={() => onChange("dataset", ds)}
              className={`flex-1 px-3 py-2 rounded-xl border text-xs font-semibold capitalize transition-all ${
                (config.dataset ?? "devices") === ds
                  ? "bg-indigo-500/20 border-indigo-500/60 text-indigo-300"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:border-indigo-500/40 hover:text-indigo-400"
              }`}
            >
              {ds}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          <span className="font-mono">/devices</span> — reconciled hardware endpoints &nbsp;|&nbsp;
          <span className="font-mono">/people</span> — user inventory
        </p>
      </Field>
    </>
  );
}

// ── Main editor ───────────────────────────────────────────────
export default function ConnectionEditorClient({
  connection,
  isNew,
  userId,
  isReadOnly = false,
  isAdmin = false,
  customers = [],
  agents = [],
  scopedCustomerId = null,
  returnTo = null,
}: {
  connection: EndpointConnection | null;
  isNew: boolean;
  userId: string;
  isReadOnly?: boolean;
  isAdmin?: boolean;
  customers?: CustomerOption[];
  agents?: { id: string; name: string; status: string; customer_id: string }[];
  /** When set, this user is a schedule_administrator scoped to one customer. */
  scopedCustomerId?: string | null;
  /** When "scheduler", the back button returns to /scheduler instead of /connections. */
  returnTo?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState(connection?.name ?? "");
  const [type, setType] = useState<ConnectionType>(connection?.type ?? "file");
  const [config, setConfig] = useState<Record<string, string>>(
    (connection?.config as unknown as Record<string, string>) ?? {}
  );
  const [customerId, setCustomerId] = useState<string | null>(
    scopedCustomerId ?? connection?.customer_id ?? null
  );

  const [agentId, setAgentId] = useState<string | null>(connection?.agent_id ?? null);

  // Clear agent if it no longer belongs to the selected customer
  useEffect(() => {
    if (!agentId) return;
    const match = agents.find((a) => a.id === agentId);
    if (match && customerId && match.customer_id !== customerId) setAgentId(null);
  }, [customerId, agentId, agents]);

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
      t === "dell"   ? { base_url: "https://apigtwb2c.us.dell.com", scope: "oob" } :
      t === "cdw"    ? { base_url: "https://portal.apiconnect.cdw.com" } :
      t === "azure"  ? { scope: "https://graph.microsoft.com/.default", base_url: "https://graph.microsoft.com/v1.0" } :
      t === "ivanti_neurons" ? { dataset: "devices" } :
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
        body: JSON.stringify({ type, config, agent_id: agentId }),
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
      if (isNew) {
        const payload = { name: name.trim(), type, config, created_by: userId, customer_id: customerId ?? null, agent_id: agentId ?? null };
        const { data, error } = await supabase
          .from("endpoint_connections").insert(payload).select("id").single();
        if (error) throw error;
        setSaved(true);
        setTimeout(() => router.replace(`/connections/${data.id}`), 800);
      } else {
        const updatePayload = { name: name.trim(), type, config, customer_id: customerId ?? null, agent_id: agentId ?? null };
        const { data: updated, error } = await supabase
          .from("endpoint_connections")
          .update(updatePayload)
          .eq("id", connection!.id)
          .select("id, name")
          .single();
        if (error) throw error;
        if (!updated) throw new Error("Save failed: no rows updated — check RLS or connection ID.");
        setSaved(true);
        setTimeout(() => window.location.reload(), 800);
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
  }, [name, type, config, customerId, agentId, userId, isNew, connection, supabase, router]);

  const selectedMeta = TYPE_OPTIONS.find((t) => t.value === type)!;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(20,184,166,0.05)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 shrink-0">
            <button
              onClick={() => router.push(returnTo === "scheduler" ? "/scheduler" : "/connections")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Connections
            </button>
            <span className="text-gray-700">|</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center">
                <Plug className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">
                {isNew ? "New Connection" : "Edit Connection"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
            {!isReadOnly && (
              <button
                onClick={handleSave}
                disabled={saving || testing}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg ${
                  saved
                    ? "bg-emerald-600 text-white shadow-emerald-600/20"
                    : "bg-cyan-500 hover:bg-cyan-500 disabled:opacity-60 text-white shadow-cyan-500/20"
                }`}
              >
                {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saved ? "Saved!" : saving ? "Saving…" : "Save"}
              </button>
            )}
            {isReadOnly && (
              <span className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500/10 border border-amber-500/20 text-amber-400">
                Read Only
              </span>
            )}
          </div>
        </div>
      </header>

      {saveError && (
        <div className="max-w-2xl mx-auto w-full px-6 pt-6">
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border bg-red-500/10 border-red-500/25 text-red-300 text-sm">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span className="flex-1">{saveError}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(saveError)}
              title="Copy to clipboard"
              className="shrink-0 text-red-400 hover:text-red-200 transition-colors"
            ><Copy className="w-3.5 h-3.5" /></button>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              className="shrink-0 text-red-400 hover:text-red-200 transition-colors"
            >✕</button>
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-8">

        {/* Type Selector */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Connection Type</h2>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
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

          {/* Connection Name */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Connection Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ivanti Production"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm"
            />
          </div>

          {/* Customer Assignment */}
          {scopedCustomerId ? (
            // Schedule administrators are locked to their assigned customer
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Customer</label>
              <div className="w-full bg-gray-800/50 border border-gray-700 rounded-xl px-4 py-3 text-gray-400 text-sm">
                {customers.find((c) => c.id === scopedCustomerId)?.name ?? "Assigned customer"}
              </div>
            </div>
          ) : isAdmin && customers.length > 0 ? (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Customer</label>
              <select
                value={customerId ?? ""}
                onChange={(e) => setCustomerId(e.target.value || null)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm"
              >
                <option value="">— No customer (shared) —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.company ? ` — ${c.company}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

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

          {type === "file"          && <FileForm          config={config} onChange={setConfigField} agents={agents} agentId={agentId} onAgentChange={setAgentId} customerId={customerId} />}
          {type === "cloud"         && <CloudForm         config={config} onChange={setConfigField} />}
          {type === "smtp"          && <SmtpForm          config={config} onChange={setConfigField} />}
          {type === "odbc"          && <OdbcForm          config={config} onChange={setConfigField} />}
          {type === "portal"        && <PortalForm        config={config} onChange={setConfigField} />}
          {type === "ivanti"        && <IvantiForm        config={config} onChange={setConfigField} />}
          {type === "ivanti_neurons" && <IvantiNeuronsForm config={config} onChange={setConfigField} />}
          {type === "dell"          && <DellForm          config={config} onChange={setConfigField} />}
          {type === "cdw"           && <CdwForm           config={config} onChange={setConfigField} />}
          {type === "azure"         && <AzureForm         config={config} onChange={setConfigField} />}
        </section>

        {/* Save footer */}
        <div className="flex justify-end gap-3 pb-8">
          <button
            type="button"
            onClick={() => router.push(returnTo === "scheduler" ? "/scheduler" : "/connections")}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || testing}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg ${
              saved
                ? "bg-emerald-600 text-white shadow-emerald-600/20"
                : "bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-white shadow-cyan-500/20"
            }`}
          >
            {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? "Saved\!" : saving ? "Saving\u2026" : "Save Connection"}
          </button>
        </div>
      </main>
    </div>
  );
}
