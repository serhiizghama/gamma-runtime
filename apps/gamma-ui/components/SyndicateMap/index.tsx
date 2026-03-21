/**
 * SyndicateMap — React Flow canvas for the agent hierarchy graph.
 *
 * Connects to the Zustand syndicate store for live agent data.
 * Builds nodes from SyndicateAgent[], edges from supervisorId hierarchy,
 * and overlays IPC flash animations on inter-agent communication.
 *
 * Layout strategy:
 *  - Dagre re-layout ONLY when the graph topology changes (agents added/removed,
 *    supervisor links changed). A "topology fingerprint" (sorted agent IDs +
 *    supervisorIds) gates re-layout.
 *  - Status/flash/data changes update node.data and edge.data in-place,
 *    preserving existing positions so nodes don't jump.
 */

import React, { useCallback, useEffect, useMemo, useRef, Component, type ErrorInfo, type ReactNode } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
  type Node,
  type Edge,
  type FitViewOptions,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AgentNode, type AgentNodeData } from "./AgentNode";
import { IpcEdge, type IpcEdgeData } from "./IpcEdge";
import { AgentDetailPanel } from "./AgentDetailPanel";
import { getLayoutedElements } from "../../lib/layout";
import {
  useSyndicateStore,
  handleSyndicateSseEvent,
  startFlashPruner,
  type SyndicateAgent,
  type IpcFlash,
} from "../../store/syndicate.store";
import { useSecureSse } from "../../hooks/useSecureSse";

// ── Node / edge type registries (stable refs — never recreate) ────────────

const nodeTypes: NodeTypes = { agent: AgentNode } as const;
const edgeTypes: EdgeTypes = { ipc: IpcEdge } as const;
const fitViewOptions: FitViewOptions = { padding: 0.25 };

// ── Build React Flow elements from store data ─────────────────────────────

function agentToNodeData(a: SyndicateAgent): AgentNodeData {
  return {
    name: a.name,
    roleId: a.roleId,
    avatarEmoji: a.avatarEmoji,
    uiColor: a.uiColor,
    status: a.liveStatus,
    inProgressTaskCount: a.inProgressTaskCount,
  };
}

function buildNodes(agents: SyndicateAgent[]): Node[] {
  return agents.map((a) => ({
    id: a.id,
    type: "agent" as const,
    position: { x: 0, y: 0 },
    data: agentToNodeData(a),
  }));
}

function buildEdges(agents: SyndicateAgent[], flashes: IpcFlash[]): Edge[] {
  // Build flash lookup — check both directions so a→b flash matches b→a edge
  const flashSet = new Set<string>();
  for (const f of flashes) {
    flashSet.add(`${f.source}:${f.target}`);
    flashSet.add(`${f.target}:${f.source}`);
  }

  const edges: Edge[] = [];
  const agentIds = new Set(agents.map((a) => a.id));

  for (const a of agents) {
    if (!a.supervisorId) continue;
    if (!agentIds.has(a.supervisorId)) continue;

    const key = `${a.supervisorId}:${a.id}`;
    const isFlashing = flashSet.has(key);

    edges.push({
      id: `e-${a.supervisorId}-${a.id}`,
      source: a.supervisorId,
      target: a.id,
      type: "ipc",
      animated: !isFlashing,
      data: {
        flashing: isFlashing,
        color: "var(--color-border-subtle)",
      } satisfies IpcEdgeData,
    });
  }

  return edges;
}

/**
 * Topology fingerprint — a string that changes ONLY when graph structure
 * changes (agent added/removed, supervisor link changed). Status, flash,
 * and data-only changes do NOT affect this fingerprint.
 */
function topologyFingerprint(agents: SyndicateAgent[]): string {
  return agents
    .map((a) => `${a.id}:${a.supervisorId ?? ""}`)
    .sort()
    .join("|");
}

// ── Styles ────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: "var(--color-bg-primary)",
};

const toolbarStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  display: "flex",
  gap: 6,
  zIndex: 5,
};

const toolbarBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-secondary)",
  background: "var(--color-surface-elevated)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 6,
  cursor: "pointer",
};

// Keyframes injected once into the DOM. Covers AgentNode badge pulse
// and IpcEdge particle animation — no per-component <style> tags needed.
const INJECTED_KEYFRAMES = `
@keyframes agentBadgePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.7; transform: scale(1.15); }
}
@keyframes ipcParticleTravel {
  0%   { offset-distance: 0%; opacity: 0; }
  5%   { opacity: 1; }
  95%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}

/* ── React Flow Controls visibility fix ─────────────────────────────── */
.react-flow__controls {
  background: #1e1e1e !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 8px !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4) !important;
}
.react-flow__controls-button {
  background: #2a2a2a !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
  fill: rgba(255, 255, 255, 0.7) !important;
  color: rgba(255, 255, 255, 0.7) !important;
  width: 28px !important;
  height: 28px !important;
}
.react-flow__controls-button:hover {
  background: #3a3a3a !important;
  fill: #fff !important;
}
.react-flow__controls-button:last-child {
  border-bottom: none !important;
}
.react-flow__controls-button svg {
  fill: inherit !important;
  max-width: 14px;
  max-height: 14px;
}

/* ── Syndicate Map toolbar button hover ─────────────────────────────── */
.syndicate-toolbar-btn:hover {
  background: var(--color-surface) !important;
  color: var(--color-text-primary) !important;
  border-color: var(--color-border-subtle) !important;
}
.syndicate-toolbar-btn:focus-visible {
  outline: 2px solid var(--color-accent-primary);
  outline-offset: 1px;
}
`;

// ── Error Boundary ────────────────────────────────────────────────────────

interface EBProps { children: ReactNode }
interface EBState { error: Error | null }

class SyndicateMapErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[SyndicateMap] Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          ...containerStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 12,
        }}>
          <span style={{ fontSize: 32 }}>⚠️</span>
          <span style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            fontFamily: "var(--font-system)",
            textAlign: "center",
            maxWidth: 320,
          }}>
            Syndicate Map encountered an error.
            <br />
            <code style={{ fontSize: 11, opacity: 0.7 }}>{this.state.error.message}</code>
          </span>
          <button
            style={toolbarBtn}
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Component ─────────────────────────────────────────────────────────────

/** Outer wrapper — provides ReactFlowProvider context for hooks + error boundary */
export function SyndicateMap() {
  return (
    <SyndicateMapErrorBoundary>
      <ReactFlowProvider>
        <SyndicateMapInner />
      </ReactFlowProvider>
    </SyndicateMapErrorBoundary>
  );
}

/** Inner component — all React Flow hooks live inside the provider */
function SyndicateMapInner() {
  const agents = useSyndicateStore((s) => s.agents);
  const ipcFlashes = useSyndicateStore((s) => s.ipcFlashes);
  const selectedAgentId = useSyndicateStore((s) => s.selectedAgentId);
  const selectAgent = useSyndicateStore((s) => s.selectAgent);
  const fetchAgents = useSyndicateStore((s) => s.fetchAgents);
  const loading = useSyndicateStore((s) => s.loading);
  const error = useSyndicateStore((s) => s.error);
  const { fitView } = useReactFlow();

  const prevTopoRef = useRef("");

  // Fetch agents on mount + start flash pruner
  useEffect(() => {
    void fetchAgents();
    return startFlashPruner();
  }, [fetchAgents]);

  // Subscribe to SSE for live updates (activity stream + broadcast)
  useSecureSse({
    path: "/api/system/activity/stream",
    onMessage: handleSyndicateSseEvent,
    reconnectMs: 3000,
    label: "SyndicateActivity",
  });

  useSecureSse({
    path: "/api/stream/agent-monitor",
    onMessage: handleSyndicateSseEvent,
    reconnectMs: 4000,
    label: "SyndicateRegistry",
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Sync store → React Flow state.
  // Split into two paths: topology change (re-layout) vs data-only (in-place).
  useEffect(() => {
    const topo = topologyFingerprint(agents);
    const topoChanged = topo !== prevTopoRef.current;

    if (topoChanged) {
      prevTopoRef.current = topo;
      const freshNodes = buildNodes(agents);
      const freshEdges = buildEdges(agents, ipcFlashes);
      const { nodes: laid, edges: laidEdges } = getLayoutedElements(
        freshNodes,
        freshEdges,
        { direction: "TB" },
      );
      setNodes(laid);
      setEdges(laidEdges);
      // Ensure fitView runs after React Flow has rendered the new nodes
      requestAnimationFrame(() => {
        fitView(fitViewOptions);
      });
    } else {
      // Data-only update: patch node.data in-place, preserving positions
      setNodes((prev) => {
        const agentMap = new Map(agents.map((a) => [a.id, a]));
        return prev.map((n) => {
          const a = agentMap.get(n.id);
          if (!a) return n;
          const next = agentToNodeData(a);
          const cur = n.data as AgentNodeData;
          // Only create a new object if something actually changed
          if (
            cur.status === next.status &&
            cur.inProgressTaskCount === next.inProgressTaskCount &&
            cur.name === next.name &&
            cur.uiColor === next.uiColor
          ) {
            return n;
          }
          return { ...n, data: next };
        });
      });
      setEdges(buildEdges(agents, ipcFlashes));
    }
  }, [agents, ipcFlashes, setNodes, setEdges]);

  const onLayout = useCallback(
    (direction: "TB" | "LR") => {
      const result = getLayoutedElements(nodes, edges, { direction });
      setNodes(result.nodes);
      setEdges(result.edges);
      requestAnimationFrame(() => {
        fitView(fitViewOptions);
      });
    },
    [nodes, edges, setNodes, setEdges, fitView],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectAgent(node.id);
    },
    [selectAgent],
  );

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId),
    [agents, selectedAgentId],
  );

  // ── Empty state ────────────────────────────────────────────────────────
  if (!loading && agents.length === 0 && !error) {
    return (
      <div style={{
        ...containerStyle,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}>
        <span style={{ fontSize: 48 }}>🗺️</span>
        <span style={{
          fontSize: 16,
          fontWeight: 600,
          color: "rgba(255, 255, 255, 0.8)",
          fontFamily: "var(--font-system)",
        }}>
          No agents yet
        </span>
        <span style={{
          fontSize: 12,
          color: "rgba(255, 255, 255, 0.4)",
          fontFamily: "var(--font-system)",
          textAlign: "center",
          maxWidth: 280,
        }}>
          Create agents via the Agent Genesis API to see them here
        </span>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <style>{INJECTED_KEYFRAMES}</style>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={fitViewOptions}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(255, 255, 255, 0.05)"
        />
        <Controls
          showInteractive={false}
          style={{ background: "var(--color-surface)", borderRadius: 8 }}
        />
      </ReactFlow>

      {/* Layout toolbar */}
      <div style={toolbarStyle}>
        <button style={toolbarBtn} onClick={() => onLayout("TB")}>
          ↕ Vertical
        </button>
        <button style={toolbarBtn} onClick={() => onLayout("LR")}>
          ↔ Horizontal
        </button>
        {loading && (
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)", alignSelf: "center", marginLeft: 8 }}>
            Loading…
          </span>
        )}
        {error && !loading && (
          <span
            style={{
              fontSize: 11,
              color: "var(--color-accent-error, #ff5f57)",
              alignSelf: "center",
              marginLeft: 8,
              cursor: "pointer",
              textDecoration: "underline",
            }}
            onClick={() => void fetchAgents()}
            title="Click to retry"
          >
            ⚠ {error} — retry
          </span>
        )}
      </div>

      {/* Agent detail sidebar */}
      {selectedAgent && (
        <AgentDetailPanel
          agentId={selectedAgent.id}
          agentName={selectedAgent.name}
          agentEmoji={selectedAgent.avatarEmoji}
          agentColor={selectedAgent.uiColor}
          onClose={() => selectAgent(null)}
        />
      )}
    </div>
  );
}
