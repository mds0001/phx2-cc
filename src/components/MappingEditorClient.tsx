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
  Sparkles,
  BrainCircuit,
  Filter,
  AlertCircle,
  RefreshCw,
  ChevronUp,
  ChevronDown as ChevronDownIcon,
  FileArchive,
  GripVertical,
  PenLine,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { validateFilterExpression } from "@/lib/filterExpression";
import { listZipFiles } from "@/lib/zip";
import type { CustomerOption } from "@/components/CustomerSwitcher";
import type {
  MappingProfile,
  ZipFileEntry,
  FieldDef,
  MappingRow,
  TransformType,
  EndpointConnection,
  ConnectionType,
  IvantiConfig,
} from "@/lib/types";

// ── Ivanti CI preset destination fields ────────────────────────────
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
  { value: "none",       label: "None",           desc: "Pass value through unchanged" },
  { value: "uppercase",  label: "Uppercase",       desc: "Convert to UPPERCASE" },
  { value: "lowercase",  label: "Lowercase",       desc: "Convert to lowercase" },
  { value: "trim",       label: "Trim",            desc: "Remove leading/trailing whitespace" },
  { value: "static",     label: "Static Value",    desc: "Always output a fixed value" },
  { value: "expression", label: "Expression",      desc: "Template with {FieldName} placeholders" },
  { value: "concat",     label: "Concat Fields",   desc: "Join two source fields together" },
  { value: "ai_lookup",  label: "AI Lookup",       desc: "Classify using Claude AI from multiple source fields" },
  { value: "ai_guess",   label: "AI Guess",        desc: "Let Claude infer the value from source context (optionally constrained to valid values)" },
];

// ── Helper ─────────────────────────────────────────────────────
function uid() {
  return crypto.randomUUID();
}

interface FilterRule {
  id: string;
  field: string;
  operator: string;
  value: string;
  logic: "AND" | "OR";
}

const FILTER_OPS = [
  { value: "==",           label: "equals" },
  { value: "!=",           label: "not equals" },
  { value: ">",            label: "greater than" },
  { value: "<",            label: "less than" },
  { value: ">=",           label: ">=" },
  { value: "<=",           label: "<=" },
  { value: "contains",     label: "contains" },
  { value: "starts_with",  label: "starts with" },
  { value: "ends_with",    label: "ends with" },
  { value: "is_empty",     label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
] as const;

const NO_VALUE_OPS = ["is_empty", "is_not_empty"];

function rulesToExpression(rules: FilterRule[]): string {
  if (rules.length === 0) return "";
  return rules.map((r, i) => {
    const field = r.field.includes(" ") ? `\`${r.field}\`` : r.field;
    const rhs = NO_VALUE_OPS.includes(r.operator) ? "" : ` "${r.value}"`;
    const cond = `${field} ${r.operator}${rhs}`;
    return i === 0 ? cond : ` ${r.logic} ${cond}`;
  }).join("");
}

// ── Props ──────────────────────────────────────────────────────

const sortByName = <T extends { name: string }>(arr: T[]): T[] =>
  [...arr].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
interface Props {
  profile: MappingProfile | null;
  isNew: boolean;
  userId: string;
  returnTo?: string | null;
  returnMode?: string | null;
  returnTaskId?: string | null;
  isReadOnly?: boolean;
  isAdmin?: boolean;
  customers?: CustomerOption[];
  scopedCustomerId?: string | null;
}

// ── Component ──────────────────────────────────────────────────
export default function MappingEditorClient({ profile, isNew, userId, returnTo, returnMode, returnTaskId, isReadOnly = false, isAdmin = false, customers = [], scopedCustomerId = null }: Props) {
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
  const [targetBusinessObject, setTargetBusinessObject] = useState<string>(
    profile?.target_business_object ?? ""
  );
  const [filterExpression, setFilterExpression] = useState<string>(
    profile?.filter_expression ?? ""
  );
  const [filterError, setFilterError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"builder" | "expression">(
    profile?.filter_expression ? "expression" : "builder"
  );
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [connections, setConnections] = useState<EndpointConnection[]>([]);
  const [allProfiles, setAllProfiles] = useState<{ id: string; name: string }[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(
    scopedCustomerId ?? profile?.customer_id ?? null
  );

  // ── Zip File Order ───────────────────────────────────────────
  const [zipFileOrder, setZipFileOrder] = useState<ZipFileEntry[]>(
    (profile?.zip_file_order ?? []) as ZipFileEntry[]
  );
  const [zipLoading, setZipLoading] = useState(false);
  const [zipLoadError, setZipLoadError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("endpoint_connections")
      .select("*")
      .order("name")
      .then(({ data }) => { if (data) setConnections(data as EndpointConnection[]); });
    supabase
      .from("mapping_profiles")
      .select("id, name")
      .order("name")
      .then(({ data }) => { if (data) setAllProfiles(data as { id: string; name: string }[]); });
  }, [supabase]);

  const [enumeratingSource, setEnumeratingSource] = useState(false);
  const [enumeratingTarget, setEnumeratingTarget] = useState(false);

  async function enumerateFields(connectionId: string, side: "source" | "target") {
    const conn = connections.find((x) => x.id === connectionId);
    if (!conn) return;
    const setEnumerating = side === "source" ? setEnumeratingSource : setEnumeratingTarget;
    setEnumerating(true);
    try {
      if (conn.type === "ivanti") {
        const cfg = conn.config as { url?: string; api_key?: string; business_object?: string; tenant_id?: string };
        const res = await fetch("/api/ivanti-proxy", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ivantiUrl: cfg.url, apiKey: cfg.api_key, businessObject: cfg.business_object, tenantId: cfg.tenant_id, top: 100 }),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({})) as { error?: string };
          if (res.status === 422) {
            throw new Error(
              "Schema discovery failed. " + (errJson.error ?? "No details returned.")
            );
          }
          throw new Error(`Ivanti fetch failed (HTTP ${res.status}): ${errJson.error ?? res.statusText}`);
        }
        const { rows } = await res.json() as { rows: Record<string, unknown>[] };
        if (!rows?.length) throw new Error("Ivanti returned 0 records — cannot enumerate fields. Make sure the Business Object has at least one record.");
        if (rows?.length) {
          // Union keys across all sampled rows — Ivanti omits null fields, so one
          // record alone misses any field that happened to be empty in that row.
          const keySet = new Set<string>();
          for (const row of rows) { for (const k of Object.keys(row)) keySet.add(k); }
          const fields: FieldDef[] = Array.from(keySet).sort().map((k) => ({ id: uid(), name: k }));
          if (side === "source") {
            // Preserve existing mapping references: reuse IDs for fields whose names match
            // existing source fields so that saved mappings remain valid after re-enumeration.
            const existingByName = new Map(sourceFields.map((f) => [f.name, f.id]));
            const mergedFields = fields.map((f) => ({ ...f, id: existingByName.get(f.name) ?? f.id }));
            setSourceFields(mergedFields);
            // Only drop mapping rows for source fields that no longer exist.
            const validSourceIds = new Set(mergedFields.map((f) => f.id));
            setMappings((prev) => prev.filter((m) => validSourceIds.has(m.sourceFieldId)));
            setSelectedSourceId(null);
          } else {
            // Same treatment for target: reuse existing IDs for name-matched fields so
            // saved mapping rows (which reference targetFieldId) remain valid.
            const existingByName = new Map(targetFields.map((f) => [f.name, f.id]));
            const mergedFields = fields.map((f) => ({ ...f, id: existingByName.get(f.name) ?? f.id }));
            setTargetFields(mergedFields);
            // Only drop mapping rows for target fields that no longer exist.
            const validTargetIds = new Set(mergedFields.map((f) => f.id));
            setMappings((prev) => prev.filter((m) => validTargetIds.has(m.targetFieldId)));
          }
        }
      } else if (conn.type === "file") {
        const cfg = conn.config as { file_path?: string; file_mode?: string; zip_mode?: boolean; file_name?: string };
        if (!cfg.file_path) throw new Error("No file path configured on this connection.");
        if (cfg.file_mode === "directory") throw new Error("Directory-mode connections cannot be enumerated. Set the connection to file mode with a specific file selected.");
        if (cfg.zip_mode) throw new Error("ZIP-mode connections cannot be enumerated from the mapping screen. Configure field mappings manually or use a non-ZIP source connection.");
        const { data: fileData, error: dlErr } = await supabase.storage.from("task_files").download(cfg.file_path);
        if (dlErr || !fileData) throw new Error("Failed to download file: " + dlErr?.message);
        const buf = await fileData.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const xlRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
        const headers = (xlRows[0] as string[]) ?? [];
        const sample  = (xlRows[1] as unknown[]) ?? [];
        const fields: FieldDef[] = headers
          .filter((h) => h !== null && h !== undefined && String(h).trim() !== "")
          .map((h, i) => ({
            id: uid(),
            name: String(h).trim(),
            sample: sample[i] !== undefined ? String(sample[i]) : undefined,
          }));
        if (side === "source") {
          // Preserve existing mapping references: reuse IDs for fields whose names match
          // existing source fields so that saved mappings remain valid after re-enumeration.
          const existingByName = new Map(sourceFields.map((f) => [f.name, f.id]));
          const mergedFields = fields.map((f) => ({ ...f, id: existingByName.get(f.name) ?? f.id }));
          setSourceFields(mergedFields);
          // Only drop mapping rows for source fields that no longer exist.
          const validSourceIds = new Set(mergedFields.map((f) => f.id));
          setMappings((prev) => prev.filter((m) => validSourceIds.has(m.sourceFieldId)));
          setSelectedSourceId(null);
          } else { setTargetFields(fields); }
      } else {
        alert(`Auto field enumeration is not supported for ${conn.type.toUpperCase()} connections.`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Enumeration failed");
    } finally {
      setEnumerating(false);
    }
  }

  // Interaction state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [destSearch, setDestSearch] = useState("");
  const [addSourceName, setAddSourceName] = useState("");
  const [addTargetName, setAddTargetName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(() => filterRules.length > 0 || filterExpression.length > 0);

  // ── Auto-Map wizard state ────────────────────────────────────
  const [autoMapOpen, setAutoMapOpen] = useState(false);
  const [autoMapStep, setAutoMapStep] = useState<1 | 2 | 3>(1);
  const [autoMapFile, setAutoMapFile] = useState<File | null>(null);
  const [autoMapColumns, setAutoMapColumns] = useState<string[]>([]);
  const [autoMapSamples, setAutoMapSamples] = useState<Record<string, unknown>[]>([]);
  const [autoMapBoName, setAutoMapBoName] = useState("");
  const [autoMapConnId, setAutoMapConnId] = useState("");
  const [autoMapBoUrl, setAutoMapBoUrl] = useState("");
  const [autoMapBoList, setAutoMapBoList] = useState<{ name: string; url: string }[]>([]);
  const [autoMapBoListLive, setAutoMapBoListLive] = useState(false);
  const [autoMapBoListLoading, setAutoMapBoListLoading] = useState(false);
  const [autoMapBoDropdownOpen, setAutoMapBoDropdownOpen] = useState(false);
  const [autoMapBoHighlight, setAutoMapBoHighlight] = useState(0);
  const [autoMapLoading, setAutoMapLoading] = useState(false);
  const [autoMapError, setAutoMapError] = useState<string | null>(null);
  const [autoMapSuggestions, setAutoMapSuggestions] = useState<{
    sourceField: string; targetField: string; confidence: "high" | "medium" | "low"; reason: string;
  }[]>([]);
  const [autoMapTargetFields, setAutoMapTargetFields] = useState<string[]>([]);
  const [autoMapSkipped, setAutoMapSkipped] = useState<Set<string>>(new Set());
  const [autoMapWarning, setAutoMapWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!autoMapConnId) { setAutoMapBoList([]); return; }
    setAutoMapBoListLoading(true);
    setAutoMapBoList([]);
    setAutoMapBoName("");
    setAutoMapBoUrl("");
    fetch("/api/ivanti-bo-list?connectionId=" + autoMapConnId)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.bos)) { setAutoMapBoList(d.bos); setAutoMapBoListLive(d.live === true); } })
      .catch(() => {})
      .finally(() => setAutoMapBoListLoading(false));
  }, [autoMapConnId]);

  async function handleAutoMapFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAutoMapFile(file);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
    setAutoMapColumns(cols);
    setAutoMapSamples(rows.slice(0, 3));
    e.target.value = "";
  }

  async function runAutoMap() {
    setAutoMapLoading(true);
    setAutoMapError(null);
    try {
      const res = await fetch("/api/auto-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: autoMapConnId,
          boName: autoMapBoName,
          boUrl: autoMapBoUrl || undefined,
          sourceColumns: autoMapColumns,
          sampleRows: autoMapSamples,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Auto-map failed");
      setAutoMapSuggestions(data.suggestions ?? []);
      setAutoMapTargetFields(data.targetFields ?? []);
      setAutoMapSkipped(new Set());
      setAutoMapWarning(data.warning ?? null);
      setAutoMapStep(3);
    } catch (err) {
      setAutoMapError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoMapLoading(false);
    }
  }

  async function applyAutoMap() {
    const activeSuggestions = autoMapSuggestions.filter(s => !autoMapSkipped.has(s.sourceField));
    const newSourceFields: FieldDef[] = autoMapColumns.map(col => ({ id: uid(), name: col }));
    const newTargetFields: FieldDef[] = autoMapTargetFields.map(f => ({ id: uid(), name: f }));
    const newMappings: MappingRow[] = activeSuggestions.map(s => {
      const srcId = newSourceFields.find(f => f.name === s.sourceField)?.id ?? uid();
      const tgtId = newTargetFields.find(f => f.name === s.targetField)?.id ?? uid();
      return { id: uid(), sourceFieldId: srcId, targetFieldId: tgtId, transform: "none", staticValue: "", concatFields: [], concatSeparator: "", aiLookupField: "" };
    });
    setSourceFields(newSourceFields);
    setTargetFields(newTargetFields);
    setMappings(newMappings);

    // Upload the source file and create/update a file endpoint connection named after this profile
    if (autoMapFile) {
      try {
        const ext = autoMapFile.name.split(".").pop()?.toLowerCase() ?? "xlsx";
        const safeName = autoMapFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = "connections/" + Date.now() + "_" + safeName;
        const { error: uploadErr } = await supabase.storage.from("task_files").upload(storagePath, autoMapFile, { upsert: true });
        if (!uploadErr) {
          const fileConfig = { file_type: ext, file_mode: "file", file_path: storagePath, file_name: autoMapFile.name };
          const connName = name.trim() || "Profile";
          const existingFileConn = sourceConnectionId
            ? connections.find((c) => c.id === sourceConnectionId && c.type === "file")
            : null;
          if (existingFileConn) {
            await supabase.from("endpoint_connections").update({ name: connName, config: fileConfig }).eq("id", existingFileConn.id);
          } else {
            const { data: newConn } = await supabase
              .from("endpoint_connections")
              .insert({ name: connName, type: "file", config: fileConfig })
              .select("id")
              .single();
            if (newConn) setSourceConnectionId(newConn.id);
          }
        }
      } catch { /* non-fatal — mappings still applied */ }
    }

    setAutoMapOpen(false);
    setAutoMapStep(1);
    setAutoMapFile(null);
    setAutoMapColumns([]);
    setAutoMapSuggestions([]);
  }

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

  // ── Add destination field manually ────────────────────────────────
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
      !confirm("This will replace your current destination fields. Continue?")
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

    // Always create a new mapping row — a source field may map to multiple targets
    // (e.g. SerialNumber → Name AND SerialNumber → SerialNumber).
    setMappings((prev) => [
      ...prev,
      {
        id: uid(),
        sourceFieldId: selectedSourceId,
        targetFieldId,
        transform: "none",
      },
    ]);
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

  // ── Zip File Order helpers ───────────────────────────────────
  async function loadZipFiles() {
    const srcConn = connections.find((c) => c.id === sourceConnectionId);
    if (!srcConn || srcConn.type !== "file") {
      setZipLoadError("Source connection is not a file endpoint.");
      return;
    }
    const cfg = srcConn.config as { zip_mode?: string; zip_file_filter?: string; file_path?: string };
    if (cfg.zip_mode !== "true") {
      setZipLoadError("Source file endpoint does not have ZIP mode enabled.");
      return;
    }
    if (!cfg.file_path) {
      setZipLoadError("No ZIP file uploaded on the source connection yet.");
      return;
    }
    setZipLoading(true);
    setZipLoadError(null);
    try {
      const { data, error } = await supabase.storage.from("task_files").download(cfg.file_path);
      if (error || !data) throw new Error(error?.message ?? "Download failed");
      const buf = await data.arrayBuffer();
      const files = listZipFiles(buf, cfg.zip_file_filter ?? "*.xlsx");
      // Merge: keep existing entries (preserving target overrides), append new ones, drop removed
      const existingPaths = new Set(zipFileOrder.map((e) => e.path));
      const incomingPaths = new Set(files);
      const existingByPath = new Map(zipFileOrder.map((e) => [e.path, e]));
      const merged: ZipFileEntry[] = [
        ...zipFileOrder.filter((e) => incomingPaths.has(e.path)), // keep ordered, preserve overrides
        ...files.filter((f) => !existingPaths.has(f)).map((f) => ({ path: f })), // append new
      ];
      setZipFileOrder(merged);
    } catch (err: unknown) {
      setZipLoadError(err instanceof Error ? err.message : "Failed to read ZIP");
    } finally {
      setZipLoading(false);
    }
  }

  function moveZipFile(index: number, direction: -1 | 1) {
    const next = [...zipFileOrder];
    const swap = index + direction;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    setZipFileOrder(next);
  }

  function removeZipFile(index: number) {
    setZipFileOrder((p) => p.filter((_, i) => i !== index));
  }

  function setZipFileTarget(index: number, targetConnId: string | null) {
    setZipFileOrder((p) =>
      p.map((e, i) => i === index ? { ...e, target_connection_id: targetConnId || null } : e)
    );
  }

  function setZipFileMapping(index: number, mappingProfileId: string | null) {
    setZipFileOrder((p) =>
      p.map((e, i) => i === index ? { ...e, mapping_profile_id: mappingProfileId || null } : e)
    );
  }

  // ── Mapping row helpers ────────────────────────────────────
  function addMapping() {
    const unmappedSrc = sourceFields.find(
      (f) => !mappings.some((m) => m.sourceFieldId === f.id)
    );
    const unmappedTgt = targetFields.find(
      (f) => !mappings.some((m) => m.targetFieldId === f.id)
    );
    if (unmappedSrc && unmappedTgt) {
      setMappings((prev) => [
        ...prev,
        { id: uid(), sourceFieldId: unmappedSrc.id, targetFieldId: unmappedTgt.id, transform: "none" },
      ]);
    }
  }

  // ── Filter rule helpers ────────────────────────────────────
  function addFilterRule() {
    setFilterRules((p) => [
      ...p,
      { id: uid(), field: "", operator: "==", value: "", logic: "AND" },
    ]);
  }

  function removeFilterRule(index: number) {
    setFilterRules((p) => p.filter((_, i) => i !== index));
    setFilterExpression("");
  }

  function updateFilterRule(index: number, patch: Partial<FilterRule>) {
    setFilterRules((p) => {
      const next = p.map((r, i) => i === index ? { ...r, ...patch } : r);
      setFilterExpression(rulesToExpression(next));
      return next;
    });
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
        target_business_object: targetBusinessObject.trim() || null,
        filter_expression: filterExpression.trim() || null,
        zip_file_order: zipFileOrder,
        created_by: userId,
        customer_id: customerId ?? null,
      };

      if (isNew) {
        const { data, error } = await supabase
          .from("mapping_profiles")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        if (returnTo === "scheduler") {
          const params = new URLSearchParams({ selectMapping: data.id, returnMode: returnMode ?? "create" });
          if (returnTaskId) params.set("returnTaskId", returnTaskId);
          router.replace(`/scheduler?${params.toString()}`);
        } else {
          router.replace(`/mappings/${data.id}`);
        }
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
      console.error("[MappingEditor] save error:", err);
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
    sourceConnectionId, targetConnectionId, filterExpression, zipFileOrder,
    userId, isNew, profile, supabase, router, targetBusinessObject, customerId,
  ]);

  // ── AI Guess: loading state for "Fetch from Ivanti" ─────────────────────────
  const [fetchingValidValues, setFetchingValidValues] = useState<Set<string>>(new Set());

  // ── Add AI Guess row ─────────────────────────────────────────────────────────
  function addAiGuessRow() {
    setMappings((prev) => [
      ...prev,
      {
        id: uid(),
        sourceFieldId: "__ai__",       // sentinel — no single source field
        targetFieldId: targetFields[0]?.id ?? "",
        transform: "ai_guess",
        aiGuessSourceFields: [],       // empty = use all source fields
        aiGuessValidValues: [],
        aiGuessPrompt: "",
      },
    ]);
  }

  // ── Fetch valid values for an ai_guess mapping from Ivanti ───────────────────
  // picklistBo: if supplied, queries that BO instead of the target connection's BO.
  //   e.g. CIType is backed by "CIStatusCIType", not "CI__Computers".
  async function fetchValidValuesForMapping(mappingId: string, fieldName: string, picklistBo?: string, picklistField?: string) {
    const tgtConn = connections.find((c) => c.id === targetConnectionId);
    if (!tgtConn || (tgtConn.type !== "ivanti" && tgtConn.type !== "ivanti_neurons")) {
      alert("No Ivanti target connection selected — cannot fetch valid values.");
      return;
    }
    const cfg = tgtConn.config as IvantiConfig;
    setFetchingValidValues((prev) => new Set(prev).add(mappingId));
    try {
      const res = await fetch("/api/ivanti-valid-values", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ivantiUrl:       cfg.url,
          apiKey:          cfg.api_key,
          tenantId:        cfg.tenant_id ?? undefined,
          // Use the explicit picklist BO if provided; fall back to the connection's BO.
          businessObject:  picklistBo?.trim() || cfg.business_object,
          fieldName: picklistField?.trim() || fieldName,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: res.statusText }));
        alert(`Failed to fetch valid values: ${error}`);
        return;
      }
      const json = await res.json() as { values: string[]; notFound?: boolean; businessObject?: string; triedUrls?: string[] };
      if (json.notFound) {
        const urlList = json.triedUrls?.join("\n  ") ?? "(unknown)";
        alert(
          `Could not find "${json.businessObject}" at any of these endpoints:\n\n  ${urlList}\n\n` +
          `Check the BO name matches exactly what Ivanti uses in its OData/REST API ` +
          `(case-sensitive). You can verify by opening one of the URLs above in your browser.`
        );
        return;
      }
      updateMapping(mappingId, { aiGuessValidValues: json.values });
    } catch (e) {
      alert(`Fetch error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFetchingValidValues((prev) => {
        const next = new Set(prev);
        next.delete(mappingId);
        return next;
      });
    }
  }

  // ── Add Static / Expression row ───────────────────────────────
  function addStaticRow() {
    setMappings((prev) => [
      ...prev,
      {
        id: uid(),
        sourceFieldId: "__static__",     // sentinel — no source field needed
        targetFieldId: targetFields[0]?.id ?? "",
        transform: "static",
        transformValue: "",
      },
    ]);
  }

  // ── Derived helpers ──────────────────────────────────────────
  // Exclude sentinels so they don't mark real source fields as "mapped"
  const mappedSourceIds = new Set(
    mappings
      .filter((m) => m.sourceFieldId !== "__ai__" && m.sourceFieldId !== "__static__")
      .map((m) => m.sourceFieldId)
  );
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

            {name && (
              <div className="hidden sm:flex items-center gap-1.5 text-gray-400">
                <span className="text-gray-600">/</span>
                <span className="text-white text-sm font-medium truncate max-w-[280px]">{name}</span>
              </div>
            )}
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-2 shrink-0">
            {!isReadOnly && (
              <>
                <button
                  onClick={() => { setAutoMapOpen(true); setAutoMapStep(1); setAutoMapError(null); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300"
                >
                  <BrainCircuit className="w-4 h-4" />
                  Auto Map
                </button>
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
              </>
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
        <div className="bg-red-500/10 border-b border-red-500/30 px-6 py-3 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-red-300 text-sm flex-1">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-red-500 hover:text-red-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* ── Instruction banner (when nothing is mapped yet) ── */}
        {sourceFields.length > 0 && targetFields.length > 0 && mappings.length === 0 && (
          <div className="flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/25 rounded-2xl px-5 py-3">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <p className="text-sm text-indigo-300">
              Click a <span className="font-semibold text-yellow-400">source field</span> to
              select it, then click a{" "}
              <span className="font-semibold text-emerald-400">destination field</span> to create a
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
              <span className="font-semibold text-emerald-400">destination field</span> to map it,
              or click the source field again to deselect.
            </p>
          </div>
        )}

        {/* ── Mapping Details ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Mapping Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ivanti CI → Excel Export"
                className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-600"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Description <span className="text-gray-600 font-normal normal-case">(optional)</span></label>
              <input
                type="text"
                value={description ?? ""}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this mapping do?"
                className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-600"
              />
            </div>
            {scopedCustomerId ? (
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Customer</label>
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl px-4 py-3 text-gray-400 text-sm">
                  {customers.find((c) => c.id === scopedCustomerId)?.name ?? "Assigned customer"}
                </div>
              </div>
            ) : isAdmin && customers.length > 0 ? (
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Customer</label>
                <select
                  value={customerId ?? ""}
                  onChange={(e) => setCustomerId(e.target.value || null)}
                  className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
          </div>
        </div>

        {/* ── Endpoint Connections ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <ArrowRightLeft className="w-4 h-4 text-cyan-400" />
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
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              >
                <option value="">— None (use task file) —</option>
                {[...connections].sort((a,b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.type.toUpperCase()}] {c.name}
                  </option>
                ))}
              </select>
              {sourceConnectionId && (() => {
                const c = connections.find((x) => x.id === sourceConnectionId);
                return c ? (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 flex items-center gap-1.5">
                      <Plug className="w-3 h-3 text-cyan-400" />
                      {(c.config as unknown as Record<string, string>).url || (c.config as unknown as Record<string, string>).server_name || (c.config as unknown as Record<string, string>).file_name || c.type}
                    </p>
                    <button
                      type="button"
                      disabled={enumeratingSource}
                      onClick={() => enumerateFields(sourceConnectionId!, "source")}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/25 text-yellow-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${enumeratingSource ? "animate-spin" : ""}`} />
                      {enumeratingSource ? "Loading…" : "Load Fields"}
                    </button>
                  </div>
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
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              >
                <option value="">— None (use task URL) —</option>
                {[...connections].sort((a,b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.type.toUpperCase()}] {c.name}
                  </option>
                ))}
              </select>
              {targetConnectionId && (() => {
                const c = connections.find((x) => x.id === targetConnectionId);
                return c ? (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 flex items-center gap-1.5">
                      <Plug className="w-3 h-3 text-cyan-400" />
                      {(c.config as unknown as Record<string, string>).url || (c.config as unknown as Record<string, string>).server_name || (c.config as unknown as Record<string, string>).file_name || c.type}
                    </p>
                    <button
                      type="button"
                      disabled={enumeratingTarget}
                      onClick={() => enumerateFields(targetConnectionId!, "target")}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${enumeratingTarget ? "animate-spin" : ""}`} />
                      {enumeratingTarget ? "Loading…" : "Load Fields"}
                    </button>
                  </div>
                ) : null;
              })()}

              {/* Target Business Object — required for Ivanti targets, no default */}
              {targetConnectionId && (() => {
                const c = connections.find((x) => x.id === targetConnectionId);
                if (!c || (c.type !== "ivanti" && c.type !== "ivanti_neurons")) return null;
                return (
                  <div className="flex flex-col gap-1.5 mt-1">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      Business Object
                      {!targetBusinessObject.trim() && (
                        <span className="text-red-400 font-normal normal-case">— required</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={targetBusinessObject}
                      onChange={(e) => setTargetBusinessObject(e.target.value)}
                      placeholder="e.g. Location, Vendor, CI__Computers"
                      className={`w-full bg-gray-800 border rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-600 ${!targetBusinessObject.trim() ? "border-red-500/50" : "border-gray-700"}`}
                    />
                    <p className="text-xs text-gray-500">The Ivanti business object this profile writes to. Must be set explicitly — no default is used.</p>
                  </div>
                );
              })()}
            </div>
          </div>

          {connections.length === 0 && (
            <p className="text-xs text-gray-600 mt-3">
              No connections defined yet.{" "}
              <button
                type="button"
                onClick={() => router.push("/connections/new")}
                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
              >
                Create one
              </button>
            </p>
          )}
        </div>

        {/* ── Row Filter ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-white">Row Filter</h3>
              <span className="text-xs text-gray-500">— skip rows that don&apos;t match</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterMode("builder")}
                  className={`px-3 py-1.5 font-medium transition-colors ${filterMode === "builder" ? "bg-violet-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
                >
                  Visual Builder
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("expression")}
                  className={`px-3 py-1.5 font-medium transition-colors ${filterMode === "expression" ? "bg-violet-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
                >
                  Expression
                </button>
              </div>
              <button
                type="button"
                onClick={() => setFilterOpen((o) => !o)}
                className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${filterOpen ? "" : "-rotate-90"}`} />
              </button>
            </div>
          </div>

          {filterOpen && (
          <div>
          {filterMode === "builder" ? (
            <div className="space-y-2">
              {filterRules.length === 0 ? (
                <div className="text-center py-6 text-gray-600 text-sm border border-dashed border-gray-800 rounded-xl">
                  No conditions — all rows will be included
                </div>
              ) : (
                filterRules.map((rule, i) => (
                  <div key={rule.id}>
                    {i > 0 && (
                      <div className="flex items-center gap-1 my-2 pl-1">
                        {(["AND", "OR"] as const).map((l) => (
                          <button
                            key={l}
                            type="button"
                            onClick={() => {
                              setFilterRules((prev) => {
                                const next = prev.map((r) => r.id === rule.id ? { ...r, logic: l } : r);
                                const expr = rulesToExpression(next);
                                setFilterExpression(expr);
                                setFilterError(validateFilterExpression(expr));
                                return next;
                              });
                            }}
                            className={`px-2.5 py-0.5 rounded text-xs font-bold transition-colors ${rule.logic === l ? "bg-violet-600 text-white" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <select
                        value={rule.field}
                        onChange={(e) => {
                          setFilterRules((prev) => {
                            const next = prev.map((r) => r.id === rule.id ? { ...r, field: e.target.value } : r);
                            const expr = rulesToExpression(next);
                            setFilterExpression(expr);
                            setFilterError(validateFilterExpression(expr));
                            return next;
                          });
                        }}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                      >
                        <option value="">— select field —</option>
                        {sortByName(sourceFields).map((f) => (
                          <option key={f.id} value={f.name}>{f.name}</option>
                        ))}
                      </select>
                      <select
                        value={rule.operator}
                        onChange={(e) => {
                          setFilterRules((prev) => {
                            const next = prev.map((r) => r.id === rule.id ? { ...r, operator: e.target.value } : r);
                            const expr = rulesToExpression(next);
                            setFilterExpression(expr);
                            setFilterError(validateFilterExpression(expr));
                            return next;
                          });
                        }}
                        className="w-36 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                      >
                        {FILTER_OPS.map((op) => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>
                      {!NO_VALUE_OPS.includes(rule.operator) && (
                        <input
                          type="text"
                          value={rule.value}
                          onChange={(e) => {
                            setFilterRules((prev) => {
                              const next = prev.map((r) => r.id === rule.id ? { ...r, value: e.target.value } : r);
                              const expr = rulesToExpression(next);
                              setFilterExpression(expr);
                              setFilterError(validateFilterExpression(expr));
                              return next;
                            });
                          }}
                          placeholder="value…"
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setFilterRules((prev) => {
                            const next = prev.filter((r) => r.id !== rule.id);
                            const expr = rulesToExpression(next);
                            setFilterExpression(expr);
                            setFilterError(validateFilterExpression(expr));
                            return next;
                          });
                        }}
                        className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
              <button
                type="button"
                onClick={() => {
                  const newRule: FilterRule = { id: uid(), field: sourceFields[0]?.name ?? "", operator: "==", value: "", logic: "AND" };
                  setFilterRules((prev) => {
                    const next = [...prev, newRule];
                    const expr = rulesToExpression(next);
                    setFilterExpression(expr);
                    setFilterError(validateFilterExpression(expr));
                    return next;
                  });
                }}
                className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-violet-500/40 text-gray-400 hover:text-violet-300 rounded-lg text-xs font-medium transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Add condition
              </button>
              {filterRules.length > 0 && (
                <div className={`mt-2 px-3 py-2 rounded-lg border text-xs font-mono flex items-center gap-2 ${filterError ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-gray-800/60 border-gray-700 text-violet-300"}`}>
                  {filterError
                    ? <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    : <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />}
                  <span className="truncate">{filterExpression || "(empty)"}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <textarea
                  value={filterExpression}
                  onChange={(e) => {
                    setFilterExpression(e.target.value);
                    setFilterError(validateFilterExpression(e.target.value));
                  }}
                  placeholder={`Status == "Active"\nManufacturer == "Dell" AND Type != "Monitor"\n\`Asset Tag\` is_not_empty`}
                  rows={3}
                  spellCheck={false}
                  className={`w-full font-mono text-sm bg-gray-800 border rounded-xl px-4 py-3 text-violet-300 placeholder-gray-600 focus:outline-none focus:ring-2 resize-none leading-relaxed ${filterError ? "border-red-500/60 focus:ring-red-500" : "border-gray-700 focus:ring-violet-500"}`}
                />
                {filterExpression.trim() !== "" && !filterError && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 text-emerald-400 text-xs">
                    <Check className="w-3 h-3" />
                    valid
                  </div>
                )}
              </div>
              {filterError && (
                <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {filterError}
                </div>
              )}
              {sourceFields.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-xs text-gray-600 self-center">Insert field:</span>
                  {sortByName(sourceFields).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        const token = f.name.includes(" ") ? `\`${f.name}\`` : f.name;
                        const next = filterExpression ? filterExpression + " " + token : token;
                        setFilterExpression(next);
                        setFilterError(validateFilterExpression(next));
                      }}
                      className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-violet-500/50 text-gray-400 hover:text-violet-300 rounded-lg text-xs font-mono transition-all"
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              <details className="group mt-1">
                <summary className="text-xs text-gray-600 hover:text-gray-400 cursor-pointer select-none list-none flex items-center gap-1">
                  <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
                  Expression syntax reference
                </summary>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="bg-gray-800/60 rounded-xl p-3 space-y-1.5">
                    <p className="text-gray-400 font-semibold mb-2">Operators</p>
                    {[["==","equals"],["!=","not equals"],[">  <  >=  <=","numeric compare"],["contains","substring match"],["starts_with","prefix match"],["ends_with","suffix match"],["is_empty","null / blank"],["is_not_empty","has a value"]].map(([op,desc]) => (
                      <div key={op} className="flex gap-2">
                        <code className="text-violet-400 w-28 shrink-0">{op}</code>
                        <span className="text-gray-500">{desc}</span>
                      </div>
                    ))}
                  </div>
                  <div className="bg-gray-800/60 rounded-xl p-3 space-y-2">
                    <p className="text-gray-400 font-semibold mb-2">Examples</p>
                    {[`Status == "Active"`,`Type != "Monitor"`,`Price >= 500`,`Description contains "server"`,"`Asset Tag` is_not_empty"].map((ex) => (
                      <code key={ex} className="block text-violet-300 bg-gray-900 rounded-lg px-2 py-1 cursor-pointer hover:bg-gray-950 transition-colors truncate" title={ex}
                        onClick={() => { setFilterExpression(ex); setFilterError(validateFilterExpression(ex)); }}
                      >{ex}</code>
                    ))}
                  </div>
                </div>
              </details>
            </div>
          )}
          </div>
          )}
        </div>

        {/* ── Zip File Order ── */}
        {(() => {
          const srcConn = connections.find((c) => c.id === sourceConnectionId);
          const cfg = srcConn?.config as { zip_mode?: string; zip_file_filter?: string } | undefined;
          if (srcConn?.type !== "file" || cfg?.zip_mode !== "true") return null;
          return (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                    <FileArchive className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Zip File Execution Order</h3>
                    <p className="text-xs text-gray-500">
                      Files matching <code className="text-amber-300/80">{cfg?.zip_file_filter ?? "*.xlsx"}</code> will be processed in this order
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadZipFiles}
                  disabled={zipLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${zipLoading ? "animate-spin" : ""}`} />
                  {zipLoading ? "Loading…" : "Load from ZIP"}
                </button>
              </div>

              {zipLoadError && (
                <p className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {zipLoadError}
                </p>
              )}

              {zipFileOrder.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center border border-dashed border-gray-700 rounded-xl">
                  <GripVertical className="w-6 h-6 text-gray-600" />
                  <p className="text-sm text-gray-500">No files ordered yet.</p>
                  <p className="text-xs text-gray-600">Click &quot;Load from ZIP&quot; to read the file list from the source connection&apos;s uploaded ZIP.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {zipFileOrder.map((entry, idx) => (
                    <div
                      key={entry.path}
                      className="flex flex-col gap-2 px-3 py-2.5 bg-gray-800 border border-gray-700/60 rounded-xl group"
                    >
                      {/* Top row: index + path + reorder + remove */}
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-gray-700 flex items-center justify-center text-xs text-gray-400 font-mono shrink-0">
                          {idx + 1}
                        </span>
                        <GripVertical className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                        <span className="flex-1 text-sm text-gray-200 font-mono truncate" title={entry.path}>
                          {entry.path}
                        </span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={() => moveZipFile(idx, -1)} disabled={idx === 0}
                            className="p-1 text-gray-500 hover:text-white disabled:opacity-20 transition-colors" title="Move up">
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => moveZipFile(idx, 1)} disabled={idx === zipFileOrder.length - 1}
                            className="p-1 text-gray-500 hover:text-white disabled:opacity-20 transition-colors" title="Move down">
                            <ChevronDownIcon className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => removeZipFile(idx)}
                            className="p-1 text-gray-600 hover:text-red-400 transition-colors ml-1" title="Remove">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {/* Target endpoint row */}
                      <div className="flex items-center gap-2 pl-7">
                        <Plug className="w-3 h-3 text-gray-500 shrink-0" />
                        <select
                          value={entry.target_connection_id ?? ""}
                          onChange={(e) => setZipFileTarget(idx, e.target.value || null)}
                          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-amber-500/50 appearance-none"
                        >
                          <option value="">— Use profile default target —</option>
                          {connections.map((c) => (
                            <option key={c.id} value={c.id}>
                              [{c.type.toUpperCase()}] {c.name}
                            </option>
                          ))}
                        </select>
                        {entry.target_connection_id && (
                          <span className="text-xs text-amber-400 shrink-0">override</span>
                        )}
                      </div>
                      {/* Mapping profile row */}
                      <div className="flex items-center gap-2 pl-7">
                        <GitMerge className="w-3 h-3 text-gray-500 shrink-0" />
                        <select
                          value={entry.mapping_profile_id ?? ""}
                          onChange={(e) => setZipFileMapping(idx, e.target.value || null)}
                          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500/50 appearance-none"
                        >
                          <option value="">— Use this profile&apos;s mappings —</option>
                          {allProfiles
                            .filter((p) => p.id !== profile?.id)
                            .map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        {entry.mapping_profile_id && (
                          <span className="text-xs text-purple-400 shrink-0">override</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

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
            <button
              type="button"
              onClick={addStaticRow}
              disabled={targetFields.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-400 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
              title="Add a static value or expression row (no source field required)"
            >
              <PenLine className="w-3.5 h-3.5" />
              Add Static / Expression
            </button>
            <button
              type="button"
              onClick={addAiGuessRow}
              disabled={targetFields.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/25 text-teal-400 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
              title="Add an AI Guess row — Claude infers the value from source context"
            >
              <BrainCircuit className="w-3.5 h-3.5" />
              Add AI Guess
            </button>
          </div>

          {mappings.length === 0 ? (
            <div className="bg-gray-900 border border-dashed border-gray-700 rounded-2xl p-8 text-center">
              <GitMerge className="w-8 h-8 text-gray-700 mx-auto mb-2" />
              <p className="text-gray-600 text-sm">
                No mappings yet.{" "}
                {sourceFields.length === 0 || targetFields.length === 0
                  ? "Add source and destination fields above to get started."
                  : "Click a source field, then a destination field to create a mapping."}
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
                  Destination Field
                </span>
                <span />
              </div>

              {/* Mapping rows */}
              <div className="divide-y divide-gray-800/60">
                {mappings.map((mapping) => {
                  const isAiLookup = mapping.transform === "ai_lookup";
                  const isAiGuess  = mapping.transform === "ai_guess";
                  const isStaticRow = mapping.sourceFieldId === "__static__";

                  // ── Static / Expression row ───────────────
                  if (isStaticRow) {
                    const isExpr = mapping.transform === "expression";
                    return (
                      <div
                        key={mapping.id}
                        className="px-5 py-4 hover:bg-gray-800/30 transition-colors bg-amber-500/5 border-l-2 border-amber-500/40"
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <PenLine className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                            Static / Expression
                          </span>
                          <button
                            onClick={() => removeMapping(mapping.id)}
                            className="ml-auto w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {/* Mode + value */}
                          <div className="md:col-span-2 flex flex-col gap-2">
                            {/* Mode toggle */}
                            <div className="flex gap-2">
                              {(["static", "expression"] as const).map((mode) => (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => updateMapping(mapping.id, { transform: mode })}
                                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                                    mapping.transform === mode
                                      ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                                  }`}
                                >
                                  {mode === "static" ? "Static Value" : "Expression"}
                                </button>
                              ))}
                            </div>

                            {/* Value input */}
                            <input
                              type="text"
                              value={mapping.transformValue ?? ""}
                              onChange={(e) =>
                                updateMapping(mapping.id, { transformValue: e.target.value })
                              }
                              placeholder={
                                isExpr
                                  ? 'e.g. {SerialNumber} - {Model}'
                                  : 'e.g. Active'
                              }
                              className="bg-gray-800 border border-amber-500/30 rounded-lg px-3 py-1.5 text-xs text-white placeholder-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />

                            {/* Expression: clickable field chips */}
                            {isExpr && sourceFields.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                <span className="text-xs text-gray-600 self-center mr-1">Insert:</span>
                                {sortByName(sourceFields).map((f) => (
                                  <button
                                    key={f.id}
                                    type="button"
                                    onClick={() =>
                                      updateMapping(mapping.id, {
                                        transformValue: (mapping.transformValue ?? "") + "{" + f.name + "}",
                                      })
                                    }
                                    className="px-2 py-0.5 rounded text-xs bg-gray-800 border border-gray-700 text-gray-400 hover:border-amber-500/50 hover:text-amber-300 transition-all"
                                  >
                                    {"{" + f.name + "}"}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Destination field */}
                          <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                              Destination Field
                            </p>
                            <div className="relative">
                              <select
                                value={mapping.targetFieldId}
                                onChange={(e) =>
                                  updateMapping(mapping.id, { targetFieldId: e.target.value })
                                }
                                className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-7 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              >
                                <option value="">— Select destination field —</option>
                                {sortByName(targetFields).map((f) => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>

                            {/* Key Field + Link Field toggles */}
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={!!mapping.isKey}
                                  onChange={(e) => updateMapping(mapping.id, { isKey: e.target.checked })}
                                  className="w-3 h-3 rounded accent-amber-500 cursor-pointer"
                                />
                                <span className={`text-xs ${mapping.isKey ? "text-amber-400 font-medium" : "text-gray-500"}`}>
                                  Key Field
                                </span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={!!mapping.isLinkField}
                                  onChange={(e) => updateMapping(mapping.id, { isLinkField: e.target.checked })}
                                  className="w-3 h-3 rounded accent-indigo-500 cursor-pointer"
                                />
                                <span className={`text-xs ${mapping.isLinkField ? "text-indigo-400" : "text-gray-500"}`}>
                                  Link Field
                                </span>
                              </label>
                              {mapping.isLinkField && (
                                <>
                                  <input
                                    type="text"
                                    value={mapping.linkFieldBoName ?? ""}
                                    onChange={(e) => updateMapping(mapping.id, { linkFieldBoName: e.target.value || undefined })}
                                    placeholder="BO name (e.g. Vendor)"
                                    className="flex-1 min-w-[120px] bg-gray-800 border border-indigo-500/30 rounded px-2 py-0.5 text-xs text-indigo-300 placeholder-indigo-500/40 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  />
                                  <input
                                    type="text"
                                    value={mapping.linkFieldLookupField ?? ""}
                                    onChange={(e) => updateMapping(mapping.id, { linkFieldLookupField: e.target.value || undefined })}
                                    placeholder="Lookup field (e.g. Name)"
                                    className="flex-1 min-w-[120px] bg-gray-800 border border-indigo-500/30 rounded px-2 py-0.5 text-xs text-indigo-300 placeholder-indigo-500/40 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── AI Lookup row ──────────────────────────
                  if (isAiLookup) {
                    const selectedAiSources = mapping.aiSourceFields ?? [];
                    return (
                      <div
                        key={mapping.id}
                        className="px-5 py-4 hover:bg-gray-800/30 transition-colors bg-violet-500/5 border-l-2 border-violet-500/40"
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <BrainCircuit className="w-4 h-4 text-violet-400 shrink-0" />
                          <span className="text-xs font-semibold text-violet-300 uppercase tracking-wider">AI Lookup</span>
                          <button
                            onClick={() => removeMapping(mapping.id)}
                            className="ml-auto w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {/* Source fields multi-select */}
                          <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                              Source Fields
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {sortByName(sourceFields).map((f) => {
                                const active = selectedAiSources.includes(f.id);
                                return (
                                  <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => {
                                      const next = active
                                        ? selectedAiSources.filter((id) => id !== f.id)
                                        : [...selectedAiSources, f.id];
                                      updateMapping(mapping.id, { aiSourceFields: next });
                                    }}
                                    className={`px-2 py-1 rounded-lg text-xs font-medium border transition-all ${
                                      active
                                        ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300"
                                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                                    }`}
                                  >
                                    {active && <Check className="w-2.5 h-2.5 inline mr-1" />}
                                    {f.name}
                                  </button>
                                );
                              })}
                              {sourceFields.length === 0 && (
                                <p className="text-xs text-gray-600">Add source fields above</p>
                              )}
                            </div>
                          </div>

                          {/* AI output key */}
                          <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-violet-400" />
                              Output Key
                            </p>
                            <input
                              type="text"
                              value={mapping.aiOutputKey ?? ""}
                              onChange={(e) =>
                                updateMapping(mapping.id, { aiOutputKey: e.target.value })
                              }
                              placeholder="e.g. device_type"
                              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                            />
                            <p className="text-xs text-gray-600">Key name in the AI JSON response</p>
                            <textarea
                              value={mapping.aiPrompt ?? ""}
                              onChange={(e) =>
                                updateMapping(mapping.id, { aiPrompt: e.target.value })
                              }
                              placeholder="Custom AI instruction (optional) — e.g. 'Classify using ITIL taxonomy. Device types: Laptop, Desktop, Server, Printer, Network Device.'"
                              rows={2}
                              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none mt-1"
                            />
                          </div>

                          {/* Destination field */}
                          <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                              Destination Field
                            </p>
                            <div className="relative">
                              <select
                                value={mapping.targetFieldId}
                                onChange={(e) =>
                                  updateMapping(mapping.id, { targetFieldId: e.target.value })
                                }
                                className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-7 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              >
                                <option value="">— Select destination field —</option>
                                {sortByName(targetFields).map((f) => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── AI Guess row ───────────────────────────
                  if (isAiGuess) {
                    const selectedGuessSources = mapping.aiGuessSourceFields ?? [];
                    const validValues = mapping.aiGuessValidValues ?? [];
                    const isFetching = fetchingValidValues.has(mapping.id);
                    const tgtFieldName =
                      targetFields.find((f) => f.id === mapping.targetFieldId)?.name ?? "";
                    const canFetch = !!targetConnectionId &&
                      connections.find((c) => c.id === targetConnectionId)?.type === "ivanti" &&
                      !!tgtFieldName;
                    return (
                      <div
                        key={mapping.id}
                        className="px-5 py-4 hover:bg-gray-800/30 transition-colors bg-teal-500/5 border-l-2 border-teal-500/40"
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <BrainCircuit className="w-4 h-4 text-teal-400 shrink-0" />
                          <span className="text-xs font-semibold text-teal-300 uppercase tracking-wider">AI Guess</span>
                          <button
                            onClick={() => removeMapping(mapping.id)}
                            className="ml-auto w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {/* Source fields context (empty = all fields) */}
                          <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                              Context Fields
                              <span className="text-gray-600 normal-case font-normal ml-1">(empty&nbsp;=&nbsp;all)</span>
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {sortByName(sourceFields).map((f) => {
                                const active = selectedGuessSources.length === 0 || selectedGuessSources.includes(f.id);
                                const pinned = selectedGuessSources.includes(f.id);
                                return (
                                  <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => {
                                      const next = pinned
                                        ? selectedGuessSources.filter((id) => id !== f.id)
                                        : [...selectedGuessSources, f.id];
                                      updateMapping(mapping.id, { aiGuessSourceFields: next });
                                    }}
                                    className={`px-2 py-1 rounded-lg text-xs font-medium border transition-all ${
                                      pinned
                                        ? "bg-teal-500/20 border-teal-500/40 text-teal-300"
                                        : active
                                          ? "bg-gray-800 border-gray-700 text-gray-400 opacity-60 hover:opacity-100"
                                          : "bg-gray-800 border-gray-700 text-gray-500"
                                    }`}
                                  >
                                    {pinned && <Check className="w-2.5 h-2.5 inline mr-1" />}
                                    {f.name}
                                  </button>
                                );
                              })}
                              {sourceFields.length === 0 && (
                                <p className="text-xs text-gray-600">Add source fields above</p>
                              )}
                            </div>
                          </div>

                          {/* Valid values */}
                          <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-teal-400" />
                              Valid Values
                              <span className="text-gray-600 normal-case font-normal ml-1">(optional constraint)</span>
                            </p>

                            {/* Chips */}
                            {validValues.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-1">
                                {validValues.map((v) => (
                                  <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-900/40 border border-teal-700/50 rounded text-xs text-teal-300">
                                    {v}
                                    <button
                                      type="button"
                                      onClick={() => updateMapping(mapping.id, { aiGuessValidValues: validValues.filter((x) => x !== v) })}
                                      className="text-teal-500 hover:text-teal-300"
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Picklist BO override + Fetch button */}
                            <div className="flex gap-1.5 items-center">
                              <input
                                type="text"
                                value={mapping.aiGuessPicklistBo ?? ""}
                                onChange={(e) => updateMapping(mapping.id, { aiGuessPicklistBo: e.target.value || undefined })}
                                placeholder="Picklist BO"
                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
                                title="Optional: Ivanti BO that backs the picklist (e.g. ivnt_AssetSubType)"
                              />
                              <input
                                type="text"
                                value={mapping.aiGuessPicklistField ?? ""}
                                onChange={(e) => updateMapping(mapping.id, { aiGuessPicklistField: e.target.value || undefined })}
                                placeholder="Value field"
                                className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
                                title="Field in the picklist BO that holds the values (e.g. ivnt_SubType). Leave blank to auto-detect."
                              />
                              <button
                                type="button"
                                disabled={!canFetch || isFetching}
                                onClick={() => fetchValidValuesForMapping(mapping.id, tgtFieldName, mapping.aiGuessPicklistBo, mapping.aiGuessPicklistField)}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border border-teal-700/40 text-teal-400 bg-teal-900/20 hover:bg-teal-900/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                                title={canFetch ? `Fetch valid values for "${tgtFieldName}" from Ivanti` : "Select an Ivanti target connection and destination field first"}
                              >
                              {isFetching
                                ? <RefreshCw className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />
                              }
                              {isFetching ? "Fetching…" : "Fetch from Ivanti"}
                              </button>
                            </div>

                            {/* Manual entry */}
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                id={`guess-val-input-${mapping.id}`}
                                placeholder="Add value manually…"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const input = e.currentTarget;
                                    const v = input.value.trim();
                                    if (v && !validValues.includes(v)) {
                                      updateMapping(mapping.id, { aiGuessValidValues: [...validValues, v] });
                                    }
                                    input.value = "";
                                  }
                                }}
                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const input = document.getElementById(`guess-val-input-${mapping.id}`) as HTMLInputElement | null;
                                  if (!input) return;
                                  const v = input.value.trim();
                                  if (v && !validValues.includes(v)) {
                                    updateMapping(mapping.id, { aiGuessValidValues: [...validValues, v] });
                                  }
                                  input.value = "";
                                }}
                                className="px-2 py-1 bg-teal-700/30 hover:bg-teal-700/50 border border-teal-700/40 rounded-lg text-xs text-teal-300 transition-all"
                              >
                                Add
                              </button>
                            </div>

                            {/* Custom prompt */}
                            <textarea
                              value={mapping.aiGuessPrompt ?? ""}
                              onChange={(e) => updateMapping(mapping.id, { aiGuessPrompt: e.target.value })}
                              placeholder="Custom AI instruction (optional) — e.g. 'Use ITIL taxonomy.'"
                              rows={2}
                              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none mt-1"
                            />
                          </div>

                          {/* Destination field */}
                          <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                              Destination Field
                            </p>
                            <div className="relative">
                              <select
                                value={mapping.targetFieldId}
                                onChange={(e) =>
                                  updateMapping(mapping.id, { targetFieldId: e.target.value })
                                }
                                className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-7 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              >
                                <option value="">— Select destination field —</option>
                                {sortByName(targetFields).map((f) => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                            </div>
                            {validValues.length === 0 && (
                              <p className="text-xs text-gray-600">No constraint — AI will infer freely</p>
                            )}
                            {validValues.length > 0 && (
                              <p className="text-xs text-teal-600">AI must pick from {validValues.length} value{validValues.length !== 1 ? "s" : ""}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── Regular mapping row ────────────────────
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
                            {TRANSFORMS.filter((t) => t.value !== "ai_lookup" && t.value !== "ai_guess").map((t) => (
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
                            placeholder="Value only, no quotes\u2026"
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
                              <option value="">+ concat with field\u2026</option>
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
                              placeholder="separator"
                              className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-600"
                            />
                          </div>
                        )}
                        {mapping.transform === "ai_lookup" && (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <BrainCircuit className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                              <span className="text-xs text-purple-300 font-medium">AI Lookup Configuration</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(mapping.aiSourceFields ?? []).map((sfId) => {
                                const sf = sourceFields.find((f) => f.id === sfId);
                                return sf ? (
                                  <span key={sfId} className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-900/40 border border-purple-700/50 rounded text-xs text-purple-300">
                                    {sf.name}
                                    <button type="button" onClick={() => updateMapping(mapping.id, { aiSourceFields: (mapping.aiSourceFields ?? []).filter((x) => x != sfId) })} className="text-purple-500 hover:text-purple-300">
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                ) : null;
                              })}
                              <select
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) updateMapping(mapping.id, { aiSourceFields: [...(mapping.aiSourceFields ?? []), e.target.value] });
                                }}
                                className="appearance-none bg-gray-800 border border-gray-700 rounded-lg px-2 py-0.5 text-xs text-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                              >
                                <option value="">+ add source field</option>
                                {sourceFields.filter((f) => !(mapping.aiSourceFields ?? []).includes(f.id)).map((f) => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                            </div>
                            <input
                              type="text"
                              value={mapping.aiOutputKey ?? ""}
                              onChange={(e) => updateMapping(mapping.id, { aiOutputKey: e.target.value })}
                              placeholder="Output key (e.g. device_type)"
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-gray-600"
                            />
                            <textarea
                              value={mapping.aiPrompt ?? ""}
                              onChange={(e) => updateMapping(mapping.id, { aiPrompt: e.target.value })}
                              placeholder="Custom AI prompt (optional)"
                              rows={2}
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-gray-600 resize-none"
                            />
                          </div>
                        )}
                      </div>

                      {/* Arrow to destination */}
                      <ArrowRight className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />

                      {/* Destination field + link-field checkbox */}
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="relative">
                          <select
                            value={mapping.targetFieldId}
                            onChange={(e) =>
                              updateMapping(mapping.id, { targetFieldId: e.target.value })
                            }
                            className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-7 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                          >
                            <option value="">&#x2014; Select destination field &#x2014;</option>
                            {sortByName(targetFields).map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!mapping.isKey}
                              onChange={(e) => updateMapping(mapping.id, { isKey: e.target.checked })}
                              className="w-3 h-3 rounded accent-amber-500 cursor-pointer"
                            />
                            <span className={`text-xs ${mapping.isKey ? "text-amber-400 font-medium" : "text-gray-500"}`}>
                              Key Field
                            </span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!mapping.isLinkField}
                              onChange={(e) => updateMapping(mapping.id, { isLinkField: e.target.checked })}
                              className="w-3 h-3 rounded accent-indigo-500 cursor-pointer"
                            />
                            <span className={`text-xs ${mapping.isLinkField ? "text-indigo-400" : "text-gray-500"}`}>
                              Link Field
                            </span>
                          </label>
                          {mapping.isLinkField && (
                            <>
                              <input
                                type="text"
                                value={mapping.linkFieldBoName ?? ""}
                                onChange={(e) => updateMapping(mapping.id, { linkFieldBoName: e.target.value || undefined })}
                                placeholder="BO name (e.g. Vendor)"
                                className="flex-1 min-w-[120px] bg-gray-800 border border-indigo-500/30 rounded px-2 py-0.5 text-xs text-indigo-300 placeholder-indigo-500/40 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                              <input
                                type="text"
                                value={mapping.linkFieldLookupField ?? ""}
                                onChange={(e) => updateMapping(mapping.id, { linkFieldLookupField: e.target.value || undefined })}
                                placeholder="Lookup field (e.g. Name)"
                                className="flex-1 min-w-[120px] bg-gray-800 border border-indigo-500/30 rounded px-2 py-0.5 text-xs text-indigo-300 placeholder-indigo-500/40 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </>
                          )}
                        </div>
                      </div>

                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={() => removeMapping(mapping.id)}
                        className="w-7 h-7 flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add mapping button */}
              <button
                type="button"
                onClick={addMapping}
                disabled={sourceFields.length === 0 || targetFields.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-gray-700 hover:border-indigo-500/50 rounded-2xl text-sm text-gray-500 hover:text-indigo-400 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                Add Field Mapping
              </button>
            </div>
          )}
        </div>

        {/* ── Two-panel field browsers ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── SOURCE PANEL ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-white uppercase tracking-wider">
                    Source Fields
                  </span>
                  {sourceConnectionId ? (() => {
                    const sc = connections.find((x) => x.id === sourceConnectionId);
                    return sc ? (
                      <span className="text-xs text-yellow-400/80 truncate font-medium">
                        [{sc.type.toUpperCase()}] {sc.name}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600 italic">loading connection…</span>
                    );
                  })() : (
                    <span className="text-xs text-gray-600 italic">no connection set</span>
                  )}
                </div>
                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full shrink-0">
                  {sourceFields.length}
                </span>
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

            {/* Source field search */}
            {sourceFields.length > 3 && (
              <div className="px-4 py-2 border-b border-gray-800/50">
                <input
                  type="text"
                  value={sourceSearch}
                  onChange={(e) => setSourceSearch(e.target.value)}
                  placeholder="Filter source fields…"
                  className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                />
              </div>
            )}

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
                sortByName(sourceFields)
                .filter((field) => !sourceSearch || field.name.toLowerCase().includes(sourceSearch.toLowerCase()))
                .map((field) => {
                  const isSelected = selectedSourceId === field.id;
                  const isMapped = mappedSourceIds.has(field.id);
                  const mappingsForThis = mappings.filter((m) => m.sourceFieldId === field.id);

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
                      {isMapped && mappingsForThis.length > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
                          <ArrowRight className="w-3 h-3 text-gray-500" />
                          <span className="text-xs text-gray-400 truncate max-w-24">
                            {mappingsForThis.length === 1
                              ? getFieldName(targetFields, mappingsForThis[0].targetFieldId)
                              : `${mappingsForThis.length} fields`}
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
                sortByName(targetFields).map((field) => {
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
                            <p className="text-xs text-indigo-400 truncate">
                              {m.transform === "ai_lookup"
                                ? `AI \u2192 ${m.aiOutputKey || "?"}`
                                : m.transform === "ai_guess"
                                  ? "AI Guess"
                                  : m.transform === "static"
                                    ? `"${m.transformValue ?? ""}"`
                                    : m.transform}
                            </p>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Auto-Map Wizard Modal */}
      {autoMapOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
                  <BrainCircuit className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Auto-Map Wizard</h2>
                  <p className="text-xs text-gray-500">Step {autoMapStep} of 3</p>
                </div>
              </div>
              <button
                onClick={() => { setAutoMapOpen(false); setAutoMapStep(1); setAutoMapFile(null); setAutoMapColumns([]); setAutoMapError(null); }}
                className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step progress bar */}
            <div className="flex gap-1 px-6 pt-4">
              {[1, 2, 3].map((step) => (
                <div key={step} className={`h-1 flex-1 rounded-full transition-all ${autoMapStep >= step ? "bg-violet-500" : "bg-gray-700"}`} />
              ))}
            </div>

            <div className="px-6 py-5">

              {/* Step 1: Upload file */}
              {autoMapStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">Upload your data file</h3>
                    <p className="text-xs text-gray-400">Upload the Excel file you want to import. We&apos;ll read the column headers to suggest a mapping.</p>
                  </div>

                  <label
                    className="flex flex-col items-center justify-center gap-3 w-full h-32 border-2 border-dashed border-gray-700 hover:border-violet-500 rounded-xl cursor-pointer transition-colors bg-gray-800/50 hover:bg-violet-500/5"
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files?.[0];
                      if (!file) return;
                      handleAutoMapFileUpload({ target: { files: e.dataTransfer.files, value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>);
                    }}
                  >
                    <FileSpreadsheet className="w-8 h-8 text-gray-600" />
                    <span className="text-sm text-gray-400">{autoMapFile ? autoMapFile.name : "Click or drag an .xlsx / .xls file here"}</span>
                    <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleAutoMapFileUpload} />
                  </label>

                  {autoMapColumns.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-2">Detected {autoMapColumns.length} columns:</p>
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                        {autoMapColumns.map((col) => (
                          <span key={col} className="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/25 text-yellow-300 text-xs rounded-lg">{col}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={() => setAutoMapStep(2)}
                      disabled={autoMapColumns.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-all"
                    >
                      Next <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Pick connection + BO name */}
              {autoMapStep === 2 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">Choose your target system</h3>
                    <p className="text-xs text-gray-400">Select the Ivanti connection and enter the Business Object name to map into.</p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ivanti Connection</label>
                    <select
                      value={autoMapConnId}
                      onChange={(e) => setAutoMapConnId(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="">— Select a connection —</option>
                      {connections
                        .filter((c) => c.type === "ivanti" || (c.type as string) === "ivanti_neurons")
                        .map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      Business Object Name
                      {autoMapBoListLoading && <span className="ml-2 text-gray-500 normal-case font-normal">Loading…</span>}
                    </label>
                    <div className="relative">
                      {(() => {
                        const q = autoMapBoName.toLowerCase();
                        const filtered = autoMapBoList.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 50);
                        const accept = (idx: number) => {
                          const bo = filtered[idx];
                          if (bo) { setAutoMapBoName(bo.name); setAutoMapBoUrl(bo.url); }
                          setAutoMapBoDropdownOpen(false);
                        };
                        return (
                          <>
                            <input
                              type="text"
                              value={autoMapBoName}
                              onChange={(e) => { setAutoMapBoName(e.target.value); setAutoMapBoDropdownOpen(true); setAutoMapBoHighlight(0); }}
                              onFocus={() => { setAutoMapBoDropdownOpen(true); setAutoMapBoHighlight(0); }}
                              onBlur={() => setTimeout(() => setAutoMapBoDropdownOpen(false), 150)}
                              onKeyDown={(e) => {
                                if (!autoMapBoDropdownOpen || filtered.length === 0) return;
                                if (e.key === "ArrowDown") { e.preventDefault(); setAutoMapBoHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
                                else if (e.key === "ArrowUp") { e.preventDefault(); setAutoMapBoHighlight((h) => Math.max(h - 1, 0)); }
                                else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(autoMapBoHighlight); }
                                else if (e.key === "Escape") { setAutoMapBoDropdownOpen(false); }
                              }}
                              placeholder={autoMapBoListLoading ? "Loading…" : autoMapBoList.length > 0 ? "Type to search…" : "e.g. Location, Vendor, CI__Computers"}
                              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-600"
                            />
                            {autoMapBoDropdownOpen && filtered.length > 0 && (
                              <ul className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto bg-gray-800 border border-gray-700 rounded-xl shadow-xl text-sm">
                                {filtered.map((bo, i) => (
                                  <li
                                    key={bo.name}
                                    onMouseDown={() => accept(i)}
                                    className={"px-4 py-2 cursor-pointer text-white " + (i === autoMapBoHighlight ? "bg-violet-600/30" : "hover:bg-violet-600/20")}
                                  >
                                    {bo.name}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <p className="text-xs text-gray-500">
                      {autoMapBoList.length > 0
                        ? autoMapBoListLive
                          ? autoMapBoList.length + " business objects from your Ivanti instance."
                          : "Showing common Ivanti BOs — type a custom name if yours isn\u0027t listed."
                        : "Enter the Ivanti OData business object name."}
                    </p>
                  </div>

                  {autoMapError && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/25 rounded-xl">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-300">{autoMapError}</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => { setAutoMapStep(1); setAutoMapError(null); }}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-xl transition-all"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      onClick={runAutoMap}
                      disabled={autoMapLoading || !autoMapConnId || !autoMapBoName.trim()}
                      className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-all"
                    >
                      {autoMapLoading ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing&hellip;</>
                      ) : (
                        <><Sparkles className="w-4 h-4" /> Analyze</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Review suggestions */}
              {autoMapStep === 3 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">Review suggestions</h3>
                    <p className="text-xs text-gray-400">
                      AI found {autoMapSuggestions.length} mapping suggestions. Uncheck any you don&apos;t want, then click Apply.
                    </p>
                  </div>

                  {autoMapWarning && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                      <span className="mt-0.5">⚠</span>
                      <span>{autoMapWarning}</span>
                    </div>
                  )}

                  <div className="rounded-xl border border-gray-700 overflow-hidden">
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0">
                          <tr className="bg-gray-800 text-gray-400">
                            <th className="text-left px-3 py-2 font-semibold">Source Column</th>
                            <th className="text-left px-3 py-2 font-semibold">Target Field</th>
                            <th className="text-left px-3 py-2 font-semibold">Confidence</th>
                            <th className="text-center px-3 py-2 font-semibold">Use</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {autoMapSuggestions.map((s) => {
                            const skipped = autoMapSkipped.has(s.sourceField);
                            const confColor =
                              s.confidence === "high"
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                                : s.confidence === "medium"
                                ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/25"
                                : "text-red-400 bg-red-500/10 border-red-500/25";
                            return (
                              <tr
                                key={s.sourceField}
                                className={`transition-colors ${skipped ? "opacity-40" : "hover:bg-gray-800/50"}`}
                              >
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 rounded">{s.sourceField}</span>
                                </td>
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded">{s.targetField}</span>
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`px-2 py-0.5 border rounded-full text-xs font-medium ${confColor}`}>
                                    {s.confidence}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <button
                                    onClick={() =>
                                      setAutoMapSkipped((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(s.sourceField)) next.delete(s.sourceField);
                                        else next.add(s.sourceField);
                                        return next;
                                      })
                                    }
                                    className={`w-5 h-5 rounded border transition-all flex items-center justify-center mx-auto ${
                                      skipped ? "border-gray-600 bg-transparent" : "border-emerald-500 bg-emerald-500"
                                    }`}
                                  >
                                    {!skipped && <Check className="w-3 h-3 text-white" />}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
