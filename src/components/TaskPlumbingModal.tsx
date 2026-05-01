"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Panel,
  useReactFlow,
  getNodesBounds,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  X,
  Database,
  ArrowRight,
  ArrowLeft,
  Workflow,
  Maximize2,
  Minimize2,
  StretchHorizontal,
  Square,
  Search as SearchIcon,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { ScheduledTask, EndpointConnection, MappingProfile } from "@/lib/types";

interface Props {
  task: ScheduledTask;
  connections: EndpointConnection[];
  mappingProfiles: MappingProfile[];
  onClose: () => void;
}

/** Resolve which mapping profiles a task references, in display order. */
function resolveProfiles(task: ScheduledTask, mappingProfiles: MappingProfile[]): { profile: MappingProfile; label?: string }[] {
  const slots: { id: string; label?: string }[] = [];
  if (task.mapping_slots && task.mapping_slots.length > 0) {
    for (const slot of task.mapping_slots) {
      if (slot.mapping_profile_id) slots.push({ id: slot.mapping_profile_id, label: slot.label });
    }
  } else if (task.mapping_profile_id) {
    slots.push({ id: task.mapping_profile_id });
  }
  const out: { profile: MappingProfile; label?: string }[] = [];
  for (const s of slots) {
    const profile = mappingProfiles.find((p) => p.id === s.id);
    if (profile) out.push({ profile, label: s.label });
  }
  return out;
}

function resolveConnection(
  id: string | null | undefined,
  fallbackId: string | null | undefined,
  connections: EndpointConnection[],
): EndpointConnection | undefined {
  const useId = id ?? fallbackId;
  return useId ? connections.find((c) => c.id === useId) : undefined;
}

/** Compact pipeline graph: one row per mapping profile.
 *  Each row: [source connection] → [profile w/ rule count] → [target connection]. */
function buildGraph(
  task: ScheduledTask,
  connections: EndpointConnection[],
  mappingProfiles: MappingProfile[],
): { nodes: Node[]; edges: Edge[] } {
  const profiles = resolveProfiles(task, mappingProfiles);
  if (profiles.length === 0) return { nodes: [], edges: [] };

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const COL_X = { source: 0, mapping: 280, target: 640 };
  const ROW_HEIGHT = 90;

  profiles.forEach(({ profile, label }, idx) => {
    const y = idx * ROW_HEIGHT;
    const src = resolveConnection(profile.source_connection_id, task.source_connection_id, connections);
    const tgt = resolveConnection(profile.target_connection_id, task.target_connection_id, connections);

    const srcNodeId = `src-${idx}`;
    const profNodeId = `prof-${idx}`;
    const tgtNodeId = `tgt-${idx}`;

    // Source connection
    nodes.push({
      id: srcNodeId,
      position: { x: COL_X.source, y },
      width: 200,
      height: 60,
      data: {
        connectionId: src?.id,
        searchText: `${src?.name ?? ""} ${src?.type ?? ""}`.toLowerCase(),
        label: (
          <div className="text-left leading-tight">
            <div className="text-[9px] uppercase tracking-wider text-cyan-400/70">Source</div>
            <div className="font-semibold text-xs text-white truncate" title={src?.name}>{src?.name ?? "(unset)"}</div>
            <div className="text-[10px] text-gray-400">{src?.type.toUpperCase() ?? "—"}</div>
          </div>
        ),
      },
      style: {
        background: "#0f172a",
        border: "1px solid #155e75",
        borderRadius: 10,
        padding: "6px 10px",
        width: 200,
      },
      sourcePosition: "right",
      targetPosition: "left",
    } as Node);

    // Mapping profile
    const ruleCount = profile.mappings.length;
    const transforms = new Set(profile.mappings.map((m) => m.transform).filter((t) => t !== "none"));
    nodes.push({
      id: profNodeId,
      position: { x: COL_X.mapping, y },
      width: 280,
      height: 60,
      data: {
        profileId: profile.id,
        searchText: `${label ?? ""} ${profile.name}`.toLowerCase(),
        label: (
          <div className="text-left leading-tight">
            <div className="text-[9px] uppercase tracking-wider text-amber-400/70">Mapping</div>
            <div className="font-semibold text-xs text-white truncate" title={label || profile.name}>{label || profile.name}</div>
            <div className="text-[10px] text-gray-400">
              {ruleCount} rule{ruleCount !== 1 ? "s" : ""}
              {transforms.size > 0 ? ` · ${Array.from(transforms).slice(0, 3).join(", ")}` : ""}
            </div>
          </div>
        ),
      },
      style: {
        background: "#1e293b",
        border: "1px solid #b45309",
        borderRadius: 10,
        padding: "6px 10px",
        width: 280,
      },
      sourcePosition: "right",
      targetPosition: "left",
    } as Node);

    // Target connection
    nodes.push({
      id: tgtNodeId,
      position: { x: COL_X.target, y },
      width: 200,
      height: 60,
      data: {
        connectionId: tgt?.id,
        searchText: `${tgt?.name ?? ""} ${tgt?.type ?? ""} ${profile.target_business_object ?? ""}`.toLowerCase(),
        label: (
          <div className="text-left leading-tight">
            <div className="text-[9px] uppercase tracking-wider text-emerald-400/70">Target</div>
            <div className="font-semibold text-xs text-white truncate" title={tgt?.name}>{tgt?.name ?? "(unset)"}</div>
            <div className="text-[10px] text-gray-400">
              {tgt?.type.toUpperCase() ?? "—"}
              {profile.target_business_object ? ` · ${profile.target_business_object}` : ""}
            </div>
          </div>
        ),
      },
      style: {
        background: "#0f172a",
        border: "1px solid #047857",
        borderRadius: 10,
        padding: "6px 10px",
        width: 200,
      },
      sourcePosition: "right",
      targetPosition: "left",
    } as Node);

    edges.push({
      id: `e-${srcNodeId}-${profNodeId}`,
      source: srcNodeId,
      target: profNodeId,
      style: { stroke: "#06b6d4", strokeWidth: 1.5 },
    });
    edges.push({
      id: `e-${profNodeId}-${tgtNodeId}`,
      source: profNodeId,
      target: tgtNodeId,
      style: { stroke: "#10b981", strokeWidth: 1.5 },
    });
  });

  return { nodes, edges };
}

/** Detailed graph for a single profile: source connection → one node per
 *  mapping rule (showing source_field → transform → target_field) → target. */
function buildProfileGraph(
  profile: MappingProfile,
  src: EndpointConnection | undefined,
  tgt: EndpointConnection | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const COL_X = { source: 0, rule: 300, target: 720 };
  const ROW_HEIGHT = 80;
  const centerY = Math.max(0, (profile.mappings.length * ROW_HEIGHT) / 2 - 30);

  const sourceNodeId = "src-conn";
  const targetNodeId = "tgt-conn";

  nodes.push({
    id: sourceNodeId,
    position: { x: COL_X.source, y: centerY },
    width: 220,
    height: 60,
    data: {
      connectionId: src?.id,
      searchText: `${src?.name ?? ""} ${src?.type ?? ""}`.toLowerCase(),
      label: (
        <div className="text-left leading-tight">
          <div className="text-[9px] uppercase tracking-wider text-cyan-400/70">Source</div>
          <div className="font-semibold text-xs text-white truncate" title={src?.name}>{src?.name ?? "(unset)"}</div>
          <div className="text-[10px] text-gray-400">{src?.type.toUpperCase() ?? "—"}</div>
        </div>
      ),
    },
    style: { background: "#0f172a", border: "1px solid #155e75", borderRadius: 10, padding: "6px 10px", width: 220 },
    sourcePosition: "right",
    targetPosition: "left",
  } as Node);

  nodes.push({
    id: targetNodeId,
    position: { x: COL_X.target, y: centerY },
    width: 220,
    height: 60,
    data: {
      connectionId: tgt?.id,
      searchText: `${tgt?.name ?? ""} ${tgt?.type ?? ""} ${profile.target_business_object ?? ""}`.toLowerCase(),
      label: (
        <div className="text-left leading-tight">
          <div className="text-[9px] uppercase tracking-wider text-emerald-400/70">Target</div>
          <div className="font-semibold text-xs text-white truncate" title={tgt?.name}>{tgt?.name ?? "(unset)"}</div>
          <div className="text-[10px] text-gray-400">
            {tgt?.type.toUpperCase() ?? "—"}
            {profile.target_business_object ? ` · ${profile.target_business_object}` : ""}
          </div>
        </div>
      ),
    },
    style: { background: "#0f172a", border: "1px solid #047857", borderRadius: 10, padding: "6px 10px", width: 220 },
    sourcePosition: "right",
    targetPosition: "left",
  } as Node);

  profile.mappings.forEach((rule, idx) => {
    const srcField = profile.source_fields.find((f) => f.id === rule.sourceFieldId);
    const tgtField = profile.target_fields.find((f) => f.id === rule.targetFieldId);
    const srcLabel = rule.sourceFieldId === "__static__"
      ? `static: "${rule.transformValue ?? ""}"`
      : (srcField?.name ?? "(missing)");
    const tgtLabel = tgtField?.name ?? "(missing)";

    const ruleId = `rule-${rule.id}`;
    nodes.push({
      id: ruleId,
      position: { x: COL_X.rule, y: idx * ROW_HEIGHT },
      width: 360,
      height: 60,
      data: {
        profileId: profile.id,
        searchText: `${srcLabel} ${tgtLabel} ${rule.transform}`.toLowerCase(),
        label: (
          <div className="text-left leading-tight">
            <div className="text-xs text-gray-200">
              <span className="text-cyan-300">{srcLabel}</span>
              <span className="mx-1.5 text-gray-500">→</span>
              <span className="text-emerald-300">{tgtLabel}</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-amber-400/80 mt-0.5">
              {rule.transform === "none" ? "passthrough" : rule.transform}
              {rule.isKey ? " · key" : ""}
            </div>
          </div>
        ),
      },
      style: { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", width: 360 },
      sourcePosition: "right",
      targetPosition: "left",
    } as Node);

    edges.push({ id: `e-src-${ruleId}`, source: sourceNodeId, target: ruleId, style: { stroke: "#06b6d4", strokeWidth: 1.5 } });
    edges.push({ id: `e-${ruleId}-tgt`, source: ruleId, target: targetNodeId, style: { stroke: "#10b981", strokeWidth: 1.5 } });
  });

  return { nodes, edges };
}

/** Toolbar lives inside <ReactFlow> so it can use useReactFlow().
 *  Controlled component — search state is owned by the parent so it can apply
 *  highlight styling to matching nodes. */
interface ToolbarProps {
  nodes: Node[];
  search: string;
  setSearch: (s: string) => void;
  matches: Node[];
  matchIdx: number;
  setMatchIdx: (n: number) => void;
  drilledInLabel?: string | null;
  onDrillOut?: () => void;
}

function PlumbingToolbar({ nodes, search, setSearch, matches, matchIdx, setMatchIdx, drilledInLabel, onDrillOut }: ToolbarProps) {
  const flow = useReactFlow();

  // When the search-result set changes, fit the view to those matches so the
  // user can see all highlighted nodes at once. ↑/↓ then centers individuals.
  useEffect(() => {
    if (matches.length === 0) return;
    flow.fitView({
      nodes: matches.map((m) => ({ id: m.id })),
      padding: 0.3,
      duration: 350,
      maxZoom: 1.4,
    });
  }, [matches, flow]);

  function fitAll() {
    flow.fitView({ padding: 0.15, duration: 300 });
  }

  function fitWidth() {
    if (nodes.length === 0) return;
    const bounds = getNodesBounds(nodes);
    // Find the closest react-flow wrapper that contains the toolbar (avoids picking
    // a stray flow elsewhere on the page).
    const wrapper = document.querySelectorAll<HTMLElement>(".react-flow");
    // `||` (not `??`) so a wrapper that's mounted-but-not-yet-measured (clientWidth 0)
    // also falls back to a sensible default rather than zero-ing out the math.
    const cw = (wrapper[wrapper.length - 1]?.clientWidth) || 1200;
    const padX = 80; // horizontal breathing room
    const padTop = 80; // clears the floating toolbar
    const zoom = Math.min(1.5, Math.max(0.1, (cw - padX * 2) / Math.max(1, bounds.width)));
    const cx = bounds.x + bounds.width / 2;
    flow.setViewport(
      { x: cw / 2 - cx * zoom, y: -bounds.y * zoom + padTop, zoom },
      { duration: 300 },
    );
  }

  // Default to Page Width on initial mount AND on every drill-in / drill-out.
  // requestAnimationFrame waits one frame so the new graph is mounted before
  // we measure bounds.
  useEffect(() => {
    requestAnimationFrame(() => fitWidth());
  }, [drilledInLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  function gotoMatch(target: number) {
    if (matches.length === 0) return;
    const idx = ((target % matches.length) + matches.length) % matches.length;
    setMatchIdx(idx);
    const node = matches[idx];
    const w = typeof node.style?.width === "number" ? (node.style.width as number) : 200;
    flow.setCenter(node.position.x + w / 2, node.position.y + 30, { zoom: 1.3, duration: 300 });
  }

  return (
    <Panel position="top-left" className="!m-2 flex items-center gap-1.5 bg-gray-900/85 backdrop-blur border border-gray-800 rounded-xl p-1.5 shadow-lg flex-wrap">
      {drilledInLabel && (
        <>
          <button
            type="button"
            onClick={onDrillOut}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 rounded-lg text-[11px] font-medium transition-colors"
            title="Back to pipeline view"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
          <span className="text-[11px] text-gray-400 truncate max-w-[260px]" title={drilledInLabel}>
            {drilledInLabel}
          </span>
          <div className="w-px h-5 bg-gray-700 mx-1" />
        </>
      )}
      <button
        type="button"
        onClick={fitWidth}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-[11px] font-medium transition-colors"
        title="Zoom to page width"
      >
        <StretchHorizontal className="w-3 h-3 text-amber-400" />
        Page Width
      </button>
      <button
        type="button"
        onClick={fitAll}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-[11px] font-medium transition-colors"
        title="Fit all on one page"
      >
        <Square className="w-3 h-3 text-amber-400" />
        1 Page
      </button>
      <div className="w-px h-5 bg-gray-700 mx-1" />
      <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg pl-2 pr-1 py-0.5">
        <SearchIcon className="w-3 h-3 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (matches.length > 0) gotoMatch(matchIdx);
            }
          }}
          placeholder="Search…"
          className="bg-transparent border-0 outline-none text-[11px] text-white placeholder-gray-600 w-32 py-1"
        />
        {search && (
          <span className="text-[10px] text-gray-500 mr-1">
            {matches.length > 0 ? `${matchIdx + 1}/${matches.length}` : "0"}
          </span>
        )}
        <button
          type="button"
          onClick={() => gotoMatch(matchIdx - 1)}
          disabled={matches.length === 0}
          className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
          title="Previous match"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => gotoMatch(matchIdx + 1)}
          disabled={matches.length === 0}
          className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
          title="Next match"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </Panel>
  );
}

export function TaskPlumbingModal({ task, connections, mappingProfiles, onClose }: Props) {
  const router = useRouter();
  const [fullscreen, setFullscreen] = useState(false);
  const [search, setSearch] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [drilledIdx, setDrilledIdx] = useState<number | null>(null);

  const profiles = useMemo(
    () => resolveProfiles(task, mappingProfiles),
    [task, mappingProfiles],
  );

  const { nodes: baseNodes, edges } = useMemo(() => {
    if (drilledIdx !== null && profiles[drilledIdx]) {
      const { profile } = profiles[drilledIdx];
      const src = resolveConnection(profile.source_connection_id, task.source_connection_id, connections);
      const tgt = resolveConnection(profile.target_connection_id, task.target_connection_id, connections);
      return buildProfileGraph(profile, src, tgt);
    }
    return buildGraph(task, connections, mappingProfiles);
  }, [task, connections, mappingProfiles, drilledIdx, profiles]);

  // Reset search and match index when drill-in changes (different node universe).
  useEffect(() => {
    setSearch("");
    setMatchIdx(0);
  }, [drilledIdx]);

  const drilledLabel = drilledIdx !== null && profiles[drilledIdx]
    ? (profiles[drilledIdx].label || profiles[drilledIdx].profile.name)
    : null;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return baseNodes.filter((n) => {
      const text = (n.data as { searchText?: string })?.searchText;
      return !!text && text.includes(q);
    });
  }, [baseNodes, search]);

  // Apply highlight styling to matched nodes; current match gets a brighter ring.
  const nodes = useMemo(() => {
    if (matches.length === 0) return baseNodes;
    const matchIds = new Set(matches.map((m) => m.id));
    const currentId = matches[matchIdx % matches.length]?.id;
    return baseNodes.map((n) => {
      if (!matchIds.has(n.id)) return n;
      const isCurrent = n.id === currentId;
      return {
        ...n,
        style: {
          ...n.style,
          boxShadow: isCurrent
            ? "0 0 0 2px #fbbf24, 0 0 18px rgba(251, 191, 36, 0.6)"
            : "0 0 0 2px rgba(251, 191, 36, 0.55)",
        },
      };
    });
  }, [baseNodes, matches, matchIdx]);

  const totalRules = profiles.reduce((sum, p) => sum + p.profile.mappings.length, 0);

  return (
    <div
      className={`fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center ${fullscreen ? "p-0" : "p-6"}`}
      onClick={onClose}
    >
      <div
        className={`bg-gray-900 border border-gray-800 shadow-2xl w-full flex flex-col overflow-hidden ${
          fullscreen ? "max-w-none h-screen rounded-none border-0" : "max-w-6xl h-[80vh] rounded-2xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Workflow className="w-5 h-5 text-amber-400" />
            <div>
              <div className="text-sm font-semibold text-white">{task.task_name}</div>
              <div className="text-xs text-gray-500">
                {profiles.length === 0 ? (
                  "No mapping profile attached"
                ) : (
                  <>
                    {profiles.length} mapping profile{profiles.length !== 1 ? "s" : ""}
                    {" · "}
                    {totalRules} field rule{totalRules !== 1 ? "s" : ""}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFullscreen((v) => !v)}
              className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              title={fullscreen ? "Exit full screen" : "Full screen"}
            >
              {fullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Graph */}
        <div className="flex-1 bg-gray-950" style={{ minHeight: 0 }}>
          {nodes.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Database className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <div className="text-sm">No mapping profile to render.</div>
                <div className="text-xs mt-1">Attach a mapping profile to this task to see its plumbing.</div>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
              onNodeClick={(_evt, node) => {
                // Source/target connection nodes navigate to the endpoint editor
                // in the same tab. Works in both pipeline and drilled-in views
                // (covers ids like "src-0", "tgt-1", "src-conn", "tgt-conn").
                if (node.id.startsWith("src-") || node.id.startsWith("tgt-")) {
                  const d = node.data as { connectionId?: string };
                  if (d.connectionId) router.push(`/connections/${d.connectionId}`);
                  return;
                }
                if (drilledIdx !== null) return; // already drilled in
                if (!node.id.startsWith("prof-")) return;
                const idx = parseInt(node.id.replace("prof-", ""), 10);
                if (!Number.isNaN(idx)) setDrilledIdx(idx);
              }}
              onNodeDoubleClick={(_evt, node) => {
                const d = node.data as { profileId?: string; connectionId?: string };
                if (d.profileId) {
                  window.open(`/mappings/${d.profileId}`, "_blank", "noopener,noreferrer");
                } else if (d.connectionId) {
                  window.open(`/connections/${d.connectionId}`, "_blank", "noopener,noreferrer");
                }
              }}
            >
              <PlumbingToolbar
                nodes={baseNodes}
                search={search}
                setSearch={(s) => { setSearch(s); setMatchIdx(0); }}
                matches={matches}
                matchIdx={matchIdx}
                setMatchIdx={setMatchIdx}
                drilledInLabel={drilledLabel}
                onDrillOut={() => setDrilledIdx(null)}
              />
              <Background color="#1f2937" gap={24} />
            </ReactFlow>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-6 py-2.5 border-t border-gray-800 text-[11px] text-gray-500 flex items-center gap-2">
          <ArrowRight className="w-3 h-3" />
          {drilledIdx === null
            ? "Drag to pan · scroll to zoom · click Source/Target to open the connection · click a Mapping node to drill in · double-click to open in a new tab"
            : "Drag to pan · scroll to zoom · click Source/Target to open the connection · double-click to open in a new tab · use Back to return"}
        </div>
      </div>
    </div>
  );
}
