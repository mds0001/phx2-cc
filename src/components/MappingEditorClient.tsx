"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Upload,
  X,
  GitMerge,
  ArrowRight,
  ChevronDown,
  FileSpreadsheet,
  Settings2,
  Zap,
  Check,
  Info,
  Plug,
  ArrowRightLeft,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type {
  MappingProfile,
  FieldDef,
  MappingRow,
  TransformType,
  EndpointConnection,
  ConnectionType,
} from "@/lib/types";

// ── Ivanti CI preset target fields ────────────────────────────
const IVANTI_PRESET: FieldDef[] = [
  { id: "ivanti-1",  name: "Name" },
  { id: "ivanti-2",  name: "Status" },
  { id: "ivanti-3",  name: "Type" },
  { id: "ivanti-4",  name: "Owner" },
  { id: "ivanti-5",  name: "Department" },
  { id: "ivanti-6",  name: "Location" },
  { id: "ivanti-7",  name: "Manufacturer" },
  { id: "ivanti-8",  name: "Model" },
  { id: "ivanti-9",  name: "SerialNumber" },
  { id: "ivanti-10", name: "AssetTag" },
  { id: "ivanti-11", name: "IPAddress" },
  { id: "ivanti-12", name: "MACAddress" },
  { id: "ivanti-13", name: "OperatingSystem" },
  { id: "ivanti-14", name: "LastSeen" },
  { id: "ivanti-15", name: "Description" },
];

const TRANSFORMS: { value: TransformType; label: string; desc: string }[] = [
  { value: "none",      label: "None",          desc: "Pass value through unchanged" },
  { value: "uppercase", label: "Uppercase",      desc: "Convert to UPPERCASE" },
  { value: "lowercase", label: "Lowercase",      desc: "Convert to lowercase" },
  { value: "trim",      label: "Trim",           desc: "Remove leading/trailing whitespace" },
  { value: "static",    label: "Static Value",   desc: "Always output a fixed value" },
  { value: "concat",    label: "Concat Fields",  desc: "Join two source fields together" },
];

// ── Helper ─────────────────────────────────────────────────────
function uid() {
  return crypto.randomUUID();
}

// ── Props ──────────────────────────────────────────────────────
interface Props {
  profile: MappingProfile | null;
  isNew: boolean;
  userId: string;
}

// ── Component ──────────────────────────────────────────────────
export default function MappingEditorClient({ profile, isNew, userId }: Props) {
  const router = useRouter();
  const supabase = createClient();

  // Profile metadata
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");

  // Fields
  const [sourceFields, setSourceFields] = useState<FieldDef[]>(
    profile?.source_fields ?? []
  );
  const [targetFields, setTargetFields] = useState<FieldDef[]>(
    profile?.target_fields ?? []
  );
  const [mappings, setMappings] = useState<MappingRow[]>(
    profile?.mappings ?? []
  );

  // Connection assignments
  const [sourceConnectionId, setSourceConnectionId] = useState<string | null>(
    profile?.source_connection_id ?? null
  );
  const [targetConnectionId, setTargetConnectionId] = useState<string | null>(
    profile?.target_connection_id ?? null
  );
  const [connections, setConnections] = useState<EndpointConnection[]>([]);

  useEffect(() => {
    supabase
      .from("endpoint_connections")
      .select("*")
      .order("name")
      .then(({ data }) => { if (data) setConnections(data as EndpointConnection[]); });
  }, [supabase]);

  // Interaction state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [addSourceName, setAddSourceName] = useState("");
  const [addTargetName, setAddTargetName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Source field: Excel upload ───────────────────────────────
  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    const headers = (rows[0] as string[]) ?? [];
    const sample  = (rows[1] as unknown[]) ?? [];

    const fields: FieldDef[] = headers
      .filter((h) => h !== null && h !== undefined && String(h).trim() !== "")
      .map((h, i) => ({
        id: uid(),
        name: String(h).trim(),
        sample: sample[i] !== undefined ? String(sample[i]) : undefined,
      }));

    setSourceFields(fields);
    setMappings([]); // clear mappings when source changes
    setSelectedSourceId(null);
    e.target.value = "";
  }

  // ── Add source field manually ────────────────────────────────
  function addSourceField() {
    const n = addSourceName.trim();
    if (!n) return;
    if (sourceFields.some((f) => f.name === n)) return;
    setSourceFields((p) => [...p, { id: uid(), name: n }]);
    setAddSourceName("");
  }

  // ── Add target field manually ────────────────────────────────
  function addTargetField() {
    const n = addTargetName.trim();
    if (!n) return;
    if (targetFields.some((f) => f.name === n)) return;
    setTargetFields((p) => [...p, { id: uid(), name: n }]);
    setAddTargetName("");
  }

  // ── Load Ivanti preset ───────────────────────────────────────
  function loadIvantiPreset() {
    if (
      targetFields.length > 0 &&
      !confirm("This will replace your current target fields. Continue?")
    )
      return;
    setTargetFields(IVANTI_PRESET.map((f) => ({ ...f, id: uid() })));
    setMappings([]);
  }

  // ── Click-to-connect logic ───────────────────────────────────
  function handleSourceClick(fieldId: string) {
    setSelectedSourceId((prev) => (prev === fieldId ? null : fieldId));
  }

  function handleTargetClick(targetFieldId: string) {
    if (!selectedSourceId) return;

    // If this source is already mapped, update the target
    const existing = mappings.find((m) => m.sourceFieldId === selectedSourceId);
    if (existing) {
      setMappings((prev) =>
        prev.map((m) =>
          m.id === existing.id ? { ...m, targetFieldId } : m
        )
      );
    } else {
      setMappings((prev) => [
        ...prev,
        {
          id: uid(),
          sourceFieldId: selectedSourceId,
          targetFieldId,
          transform: "none",
        },
      ]);
    }
    setSelectedSourceId(null);
  }

  // ── Mapping update helpers ───────────────────────────────────
  function updateMapping(id: string, patch: Partial<MappingRow>) {
    setMappings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  }

  function removeMapping(id: string) {
    setMappings((prev) => prev.filter((m) => m.id !== id));
  }

  function removeSourceField(fieldId: string) {
    setSourceFields((p) => p.filter((f) => f.id !== fieldId));
    setMappings((p) => p.filter((m) => m.sourceFieldId !== fieldId));
    if (selectedSourceId === fieldId) setSelectedSourceId(null);
  }

  function removeTargetField(fieldId: string) {
    setTargetFields((p) => p.filter((f) => f.id !== fieldId));
    setMappings((p) => p.filter((m) => m.targetFieldId !== fieldId));
  }

  // ── Save ────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setSaveError("Profile name is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);

    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        source_fields: sourceFields,
        target_fields: targetFields,
        mappings,
        source_connection_id: sourceConnectionId ?? null,
        target_connection_id: targetConnectionId ?? null,
        created_by: userId,
      };

      if (isNew) {
        const { data, error } = await supabase
          .from("mapping_profiles")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        router.replace(`/mappings/${data.id}`);
      } else {
        const { error } = await supabase
          .from("mapping_profiles")
          .update(payload)
          .eq("id", profile!.id);
        if (error) throw error;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err);
      setSaveError(msg || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    name, description, sourceFields, targetFields, mappings,
    sourceConnectionId, targetConnectionId,
    userId, isNew, profile, supabase, router,
  ]);

  // ── Derived helpers ──────────────────────────────────────────
  const mappedSourceIds = new Set(mappings.map((m) => m.sourceFieldId));
  const mappedTargetIds = new Set(mappings.map((m) => m.targetFieldId));

  function getMappingForSource(sourceFieldId: string) {
    return mappings.find((m) => m.sourceFieldId === sourceFieldId);
  }

  function getFieldName(fields: FieldDef[], id: string) {
    return fields.find((f) => f.id === id)?.name ?? "—";
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05)_0%,_transparent_50%)] pointer-events-none" />

      {/* ── Top bar ── */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 shrink-0">
            <button
              onClick={() => router.push("/mappings")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Mappings
            </button>
            <span className="text-gray-700">|</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
                <GitMerge className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-white">
                Edit Field Mapping
              </span>
            </div>

            {/* Editable name inline */}
            <div className="hidden sm:flex items-center gap-1.5 text-gray-400">
              <span className="text-gray-600">/</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mapping name…"
                className="bg-transparent border-b border-transparent hover:border-gray-600 focus:border-indigo-500 px-1 py-0.5 text-white text-sm font-medium placeholder-gray-600 focus:outline-none transition-colors min-w-[120px] max-w-[280px]"
              />
            </div>
          </div>

          {/* Description */}
          <div className="flex-1 flex items-center min-w-0">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="hidden lg:flex w-full max-w-sm bg-transparent border-b border-transparent hover:border-gray-600 focus:border-indigo-500 px-1 py-0.5 text-gray-400 text-sm placeholder-gray-600 focus:outline-none transition-colors"
            />
          </div>

          {/* Save button */}
          <div className="flex items-center gap-2 shrink-0">
            {saveError && (
              <span className="text-red-400 text-xs max-w-xs truncate" title={saveError}>
                {saveError}
              </span>
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
              {saved ? (
                <Check className="w-4 h-4" />
              ) : saving ? (
                <Save className="w-4 h-4 animate-pulse" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saved ? "Saved!" : saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* ── Instruction banner (when nothing is mapped yet) ── */}
        {sourceFields.length > 0 && targetFields.length > 0 && mappings.length === 0 && (
          <div className="flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/25 rounded-2xl px-5 py-3">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <p className="text-sm text-indigo-300">
              Click a <span className="font-semibold text-yellow-400">source field</span> to
              select it, then click a{" "}
              <span className="font-semibold text-emerald-400">target field</span> to create a
              mapping between them.
            </p>
          </div>
        )}

        {selectedSourceId && (
          <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/25 rounded-2xl px-5 py-3">
            <Zap className="w-4 h-4 text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-300">
              Source field{" "}
              <span className="font-semibold">
                &quot;{getFieldName(sourceFields, selectedSourceId)}&quot;
              </span>{" "}
              selected — now click a{" "}
              <span className="font-semibold text-emerald-400">target field</span> to map it,
              or click the source field again to deselect.
            </p>
          </div>
        )}

        {/* ── Endpoint Connections ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <ArrowRightLeft className="w-4 h-4 text-teal-400" />
            <h3 className="text-sm font-semibold text-white">Endpoint Connections</h3>
            <span className="text-xs text-gray-500 ml-1">— link where data comes from and where it goes</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Source connection */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                Source Connection
              </label>
              <select
                value={sourceConnectionId ?? ""}
                onChange={(e) => setSourceConnectionId(e.target.value || null)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              >
                <option value="">— None (use task file) —</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.type.toUpperCase()}] {c.name}
                  </option>
                ))}
              </select>
              {sourceConnectionId && (() => {
                const c = connections.find((x) => x.id === sourceConnectionId);
                return c ? (
                  <p className="text-xs text-gray-500 flex items-center gap-1.5">
                    <Plug className="w-3 h-3 text-teal-400" />
                    {(c.config as Record<string, string>).url || (c.config as Record<string, string>).server_name || (c.config as Record<string, string>).file_name || c.type}
                  </p>
                ) : null;
              })()}
            </div>

            {/* Target connection */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                Target Connection
              </label>
              <select
                value={targetConnectionId ?? ""}
                onChange={(e) => setTargetConnectionId(e.target.value || null)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              >
                <option value="">— None (use task URL) —</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.type.toUpperCase()}] {c.name}
                  </option>
                ))}
              </select>
              {targetConnectionId && (() => {
                const c = connections.find((x) => x.id === targetConnectionId);
                return c ? (
                  <p className="text-xs text-gray-500 flex items-center gap-1.5">
                    <Plug className="w-3 h-3 text-teal-400" />
                    {(c.config as Record<string, string>).url || (c.config as Record<string, string>).server_name || (c.config as Record<string, string>).file_name || c.type}
                  </p>
                ) : null;
              })()}
            </div>
          </div>

          {connections.length === 0 && (
            <p className="text-xs text-gray-600 mt-3">
              No connections defined yet.{" "}
              <button
                type="button"
                onClick={() => router.push("/connections/new")}
                className="text-teal-400 hover:text-teal-300 underline underline-offset-2"
              >
                Create one
              </button>
            </p>
          )}
        </div>

        {/* ── Two-panel field browsers ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── SOURCE PANEL ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-sm font-semibold text-white uppercase tracking-wider">
                  Source Fields
                </span>
                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                  {sourceFields.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Excel upload */}
                <label className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium cursor-pointer transition-all">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  Import Excel
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleExcelUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Add source field */}
            <div className="px-4 py-3 border-b border-gray-800/50">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={addSourceName}
                  onChange={(e) => setAddSourceName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addSourceField()}
                  placeholder="Add source field…"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                />
                <button
                  onClick={addSourceField}
                  disabled={!addSourceName.trim()}
                  className="px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/25 text-yellow-400 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Source field list */}
            <div className="divide-y divide-gray-800/50 max-h-80 overflow-y-auto">
              {sourceFields.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <FileSpreadsheet className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                  <p className="text-gray-600 text-sm">
                    Import an Excel file or add fields manually
                  </p>
                </div>
              ) : (
                sourceFields.map((field) => {
                  const isSelected = selectedSourceId === field.id;
                  const isMapped = mappedSourceIds.has(field.id);
                  const mappingForThis = getMappingForSource(field.id);

                  return (
                    <div
                      key={field.id}
                      onClick={() => handleSourceClick(field.id)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all group ${
                        isSelected
                          ? "bg-yellow-500/10 border-l-2 border-yellow-400"
                          : isMapped
                          ? "bg-emerald-500/5 hover:bg-gray-800/50"
                          : "hover:bg-gray-800/50"
                      }`}
                    >
                      {/* Status dot */}
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isSelected
                            ? "bg-yellow-400"
                            : isMapped
                            ? "bg-emerald-400"
                            : "bg-gray-600"
                        }`}
                      />

                      {/* Field info */}
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            isSelected
                              ? "text-yellow-300"
                              : isMapped
                              ? "text-emerald-300"
                              : "text-white"
                          }`}
                        >
                          {field.name}
                        </p>
                        {field.sample !== undefined && (
                          <p className="text-xs text-gray-500 truncate">
                            e.g. &quot;{field.sample}&quot;
                          </p>
                        )}
                      </div>

                      {/* Mapped badge */}
                      {isMapped && mappingForThis && (
                        <div className="flex items-center gap-1 shrink-0">
                          <ArrowRight className="w-3 h-3 text-gray-500" />
                          <span className="text-xs text-gray-400 truncate max-w-20">
                            {getFieldName(targetFields, mappingForThis.targetFieldId)}
                          </span>
                        </div>
                      )}

                      {/* Remove */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSourceField(field.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 transition-all shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── TARGET PANEL ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm font-semibold text-white uppercase tracking-wider">
                  Target Fields
                </span>
                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                  {targetFields.length}
                </span>
              </div>
              <button
                onClick={loadIvantiPreset}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-all"
              >
                <Zap className="w-3.5 h-3.5 text-indigo-400" />
                Ivanti Preset
              </button>
            </div>

            {/* Add target field */}
            <div className="px-4 py-3 border-b border-gray-800/50">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={addTargetName}
                  onChange={(e) => setAddTargetName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTargetField()}
                  placeholder="Add target field…"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  onClick={addTargetField}
                  disabled={!addTargetName.trim()}
                  className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Target field list */}
            <div className="divide-y divide-gray-800/50 max-h-80 overflow-y-auto">
              {targetFields.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <Settings2 className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                  <p className="text-gray-600 text-sm">
                    Add target fields or load the Ivanti preset
                  </p>
                </div>
              ) : (
                targetFields.map((field) => {
                  const isMapped = mappedTargetIds.has(field.id);
                  const isArmed = selectedSourceId !== null;

                  return (
                    <div
                      key={field.id}
                      onClick={() => handleTargetClick(field.id)}
                      className={`flex items-center gap-3 px-4 py-3 transition-all group ${
                        isMapped
                          ? "bg-emerald-500/5"
                          : isArmed
                          ? "cursor-pointer hover:bg-emerald-500/10 hover:border-l-2 hover:border-emerald-400"
                          : "cursor-default"
                      }`}
                    >
                      {/* Status dot */}
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isMapped ? "bg-emerald-400" : "bg-gray-600"
                        }`}
                      />

                      {/* Field name */}
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            isMapped ? "text-emerald-300" : "text-white"
                          }`}
                        >
                          {field.name}
                        </p>
                        {isMapped && (() => {
                          const m = mappings.find(
                            (x) => x.targetFieldId === field.id
                          );
                          return m ? (
                            <p className="text-xs text-gray-500">
                              ←{" "}
                              {getFieldName(sourceFields, m.sourceFieldId)}
                            </p>
                          ) : null;
                        })()}
                      </div>

                      {isMapped && (
                        <span className="text-xs text-emerald-500 shrink-0 flex items-center gap-0.5">
                          <Check className="w-3 h-3" />
                        </span>
                      )}

                      {/* Remove */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTargetField(field.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 transition-all shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── Mapping rows ── */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-indigo-400" />
              Active Mappings
              <span className="text-xs font-normal text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                {mappings.length}
              </span>
            </h3>
          </div>

          {mappings.length === 0 ? (
            <div className="bg-gray-900 border border-dashed border-gray-700 rounded-2xl p-8 text-center">
              <GitMerge className="w-8 h-8 text-gray-700 mx-auto mb-2" />
              <p className="text-gray-600 text-sm">
                No mappings yet.{" "}
                {sourceFields.length === 0 || targetFields.length === 0
                  ? "Add source and target fields above to get started."
                  : "Click a source field, then a target field to create a mapping."}
              </p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto_180px_auto_1fr_auto] items-center gap-3 px-5 py-3 border-b border-gray-800 bg-gray-800/30">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Source Field
                </span>
                <span />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Transform
                </span>
                <span />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Target Field
                </span>
                <span />
              </div>

              {/* Mapping rows */}
              <div className="divide-y divide-gray-800/60">
                {mappings.map((mapping) => {
                  const srcName = getFieldName(sourceFields, mapping.sourceFieldId);
                  const tgtName = getFieldName(targetFields, mapping.targetFieldId);

                  return (
                    <div
                      key={mapping.id}
                      className="grid grid-cols-[1fr_auto_180px_auto_1fr_auto] items-start gap-3 px-5 py-4 hover:bg-gray-800/30 transition-colors"
                    >
                      {/* Source field chip */}
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-yellow-400 shrink-0 mt-0.5" />
                        <span className="text-sm text-yellow-300 font-medium truncate">
                          {srcName}
                        </span>
                      </div>

                      {/* Arrow */}
                      <ArrowRight className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />

                      {/* Transform section */}
                      <div className="space-y-2">
                        {/* Transform dropdown */}
                        <div className="relative">
                          <select
                            value={mapping.transform}
                            onChange={(e) =>
                              updateMapping(mapping.id, {
                                transform: e.target.value as TransformType,
                                transformValue: undefined,
                                concatFieldId: undefined,
                                concatSeparator: undefined,
                              })
                            }
                            className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-7 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                          >
                            {TRANSFORMS.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>

                        {/* Static value input */}
                        {mapping.transform === "static" && (
                          <input
                            type="text"
                            value={mapping.transformValue ?? ""}
                            onChange={(e) =>
                              updateMapping(mapping.id, {
                                transformValue: e.target.value,
                              })
                            }
                            placeholder="Fixed value…"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        )}

                        {/* Concat options */}
                        {mapping.transform === "concat" && (
                          <div className="space-y-1.5">
                            <select
                              value={mapping.concatFieldId ?? ""}
                              onChange={(e) =>
                                updateMapping(mapping.id, {
                                  concatFieldId: e.target.value || undefined,
                                })
                              }
                              className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              <option value="">+ concat with field…</option>
                              {sourceFields
                                .filter((f) => f.id !== mapping.sourceFieldId)
                                .map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                            </select>
                            <input
                              type="text"
                              value={mapping.concatSeparator ?? ""}
                              onChange={(e) =>
                                updateMapping(mapping.id, {
                                  concatSeparator: e.target.value,
                                })
                              }
                              placeholder='Separator (e.g. " ", "-")'
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                        )}
                      </div>

                      {/* Arrow */}
                      <ArrowRight className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />

                      {/* Target field chip */}
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 mt-0.5" />
                        <span className="text-sm text-emerald-300 font-medium truncate">
                          {tgtName}
                        </span>
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => removeMapping(mapping.id)}
                        className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors rounded shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
