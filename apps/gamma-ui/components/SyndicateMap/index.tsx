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

import React, { useCallback, useEffect, useMemo, useRef, useState, Component, type ErrorInfo, type ReactNode } from "react";
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
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AgentNode } from "./AgentNode";
import { AgentClusterNode, type AgentClusterNodeData } from "./AgentClusterNode";
import { TeamGroupNode } from "./TeamGroupNode";
import { IpcEdge } from "./IpcEdge";
import { AgentDetailPanel } from "./AgentDetailPanel";
import { MapToolbar } from "./MapToolbar";
import { getLayoutedElements } from "../../lib/layout";
import {
  useSyndicateStore,
  handleSyndicateSseEvent,
  startFlashPruner,
} from "../../store/syndicate.store";
import { useSecureSse } from "../../hooks/useSecureSse";
import { useLayoutPersistence } from "../../hooks/useLayoutPersistence";
import { useAgentGraph } from "../../hooks/useAgentGraph";

// ── Node / edge type registries (stable refs — never recreate) ────────────

const nodeTypes: NodeTypes = { agent: AgentNode, cluster: AgentClusterNode, teamGroup: TeamGroupNode } as const;
const edgeTypes: EdgeTypes = { ipc: IpcEdge } as const;
const fitViewOptions: FitViewOptions = { padding: 0.25 };

// ── Styles ────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: "var(--color-bg-primary)",
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
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "var(--font-system)",
              color: "var(--color-text-secondary)",
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: 6,
              cursor: "pointer",
            }}
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

  const {
    restorePositions,
    savePositions,
    clearPositions,
    layoutMode,
  } = useLayoutPersistence({ storageKey: "syndicate-map" });

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const prevTopoRef = useRef("");

  // Build graph elements from store data via the useAgentGraph hook
  const graph = useAgentGraph({ agents, ipcFlashes, collapsedIds });

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

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Wrap onNodesChange to persist positions after drag
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);
      const hasDragEnd = changes.some(
        (c) => c.type === "position" && !c.dragging,
      );
      if (hasDragEnd) {
        // Read latest nodes via setNodes identity trick
        setNodes((current) => {
          savePositions(current);
          return current;
        });
      }
    },
    [onNodesChangeBase, setNodes, savePositions],
  );

  // Sync store → React Flow state.
  // Split into two paths: topology change (re-layout) vs data-only (in-place).
  useEffect(() => {
    const topoChanged = graph.topologyKey !== prevTopoRef.current;

    if (topoChanged) {
      prevTopoRef.current = graph.topologyKey;

      // Try restoring saved positions first; fall back to dagre layout
      const restored = restorePositions(graph.nodes);
      if (restored) {
        setNodes(restored);
        setEdges(graph.edges);
      } else {
        const { nodes: laid, edges: laidEdges } = getLayoutedElements(
          graph.nodes,
          graph.edges,
          { direction: "TB" },
        );
        setNodes(laid);
        setEdges(laidEdges);
      }
      // Ensure fitView runs after React Flow has rendered the new nodes
      requestAnimationFrame(() => {
        fitView(fitViewOptions);
      });
    } else {
      // Data-only update: patch node.data in-place, preserving positions
      const freshById = new Map(graph.nodes.map((n) => [n.id, n]));

      setNodes((prev) => {
        const next = prev.map((n) => {
          const fresh = freshById.get(n.id);
          if (!fresh) return n;

          // Shallow-compare data to avoid unnecessary re-renders
          const cur = n.data as Record<string, unknown>;
          const nxt = fresh.data as Record<string, unknown>;
          const keys = Object.keys(nxt);
          const changed = keys.some((k) => cur[k] !== nxt[k]);
          return changed ? { ...n, data: fresh.data } : n;
        });
        // Return same reference if nothing changed — avoids downstream re-renders
        const anyChanged = next.some((n, i) => n !== prev[i]);
        return anyChanged ? next : prev;
      });

      // Only update edges if the reference actually changed (memoized in useAgentGraph)
      setEdges((prev) => (prev === graph.edges ? prev : graph.edges));
    }
  }, [graph, setNodes, setEdges]);

  const onLayout = useCallback(
    (direction: "TB" | "LR") => {
      clearPositions();
      const result = getLayoutedElements(nodes, edges, { direction });
      setNodes(result.nodes);
      setEdges(result.edges);
      requestAnimationFrame(() => {
        fitView(fitViewOptions);
      });
    },
    [nodes, edges, setNodes, setEdges, fitView, clearPositions],
  );

  const onResetPositions = useCallback(() => {
    clearPositions();
    const result = getLayoutedElements(nodes, edges, { direction: "TB" });
    setNodes(result.nodes);
    setEdges(result.edges);
    requestAnimationFrame(() => {
      fitView(fitViewOptions);
    });
  }, [nodes, edges, setNodes, setEdges, fitView, clearPositions]);

  const onFitView = useCallback(() => {
    fitView(fitViewOptions);
  }, [fitView]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith("cluster-")) {
        // Expand the cluster: remove from collapsedIds and select root agent
        const clusterId = (node.data as unknown as AgentClusterNodeData).clusterId;
        setCollapsedIds((prev) => {
          const next = new Set(prev);
          next.delete(clusterId);
          return next;
        });
        selectAgent(clusterId);
      } else {
        selectAgent(node.id);
      }
    },
    [selectAgent],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // Double-click on an agent node → collapse its subtree
      if (!node.id.startsWith("cluster-")) {
        setCollapsedIds((prev) => {
          const next = new Set(prev);
          next.add(node.id);
          return next;
        });
      }
    },
    [],
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
        onNodeDoubleClick={onNodeDoubleClick}
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
      <MapToolbar
        onLayout={onLayout}
        onFitView={onFitView}
        onResetPositions={onResetPositions}
        layoutMode={layoutMode}
        loading={loading}
        error={error}
        onRetry={() => void fetchAgents()}
      />

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
