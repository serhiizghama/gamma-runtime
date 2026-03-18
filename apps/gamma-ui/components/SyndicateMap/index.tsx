/**
 * SyndicateMap — React Flow canvas for the agent hierarchy graph.
 *
 * Connects to the Zustand syndicate store for live agent data.
 * Builds nodes from SyndicateAgent[], edges from supervisorId hierarchy,
 * and overlays IPC flash animations on inter-agent communication.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
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
  type SyndicateAgent,
  type IpcFlash,
} from "../../store/syndicate.store";
import { useSecureSse } from "../../hooks/useSecureSse";

// ── Node / edge type registries ───────────────────────────────────────────

const nodeTypes: NodeTypes = { agent: AgentNode } as const;
const edgeTypes: EdgeTypes = { ipc: IpcEdge } as const;

const fitViewOptions: FitViewOptions = { padding: 0.25 };

// ── Build React Flow elements from store data ─────────────────────────────

function buildNodes(agents: SyndicateAgent[]): Node[] {
  return agents.map((a) => ({
    id: a.id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      name: a.name,
      roleId: a.roleId,
      avatarEmoji: a.avatarEmoji,
      uiColor: a.uiColor,
      status: a.liveStatus,
      inProgressTaskCount: a.inProgressTaskCount,
    } satisfies AgentNodeData,
  }));
}

function buildEdges(agents: SyndicateAgent[], flashes: IpcFlash[]): Edge[] {
  const flashSet = new Set(flashes.map((f) => `${f.source}:${f.target}`));
  const edges: Edge[] = [];

  for (const a of agents) {
    if (!a.supervisorId) continue;
    // Verify supervisor exists in agent list
    if (!agents.some((o) => o.id === a.supervisorId)) continue;

    const key = `${a.supervisorId}:${a.id}`;
    const isFlashing = flashSet.has(key);

    edges.push({
      id: `e-${a.supervisorId}-${a.id}`,
      source: a.supervisorId,
      target: a.id,
      type: "ipc",
      animated: !isFlashing, // disable default animation during flash
      data: {
        flashing: isFlashing,
        color: "var(--color-border-subtle)",
      } satisfies IpcEdgeData,
    });
  }

  return edges;
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
`;

// ── Component ─────────────────────────────────────────────────────────────

export function SyndicateMap() {
  const agents = useSyndicateStore((s) => s.agents);
  const ipcFlashes = useSyndicateStore((s) => s.ipcFlashes);
  const selectedAgentId = useSyndicateStore((s) => s.selectedAgentId);
  const selectAgent = useSyndicateStore((s) => s.selectAgent);
  const fetchAgents = useSyndicateStore((s) => s.fetchAgents);
  const loading = useSyndicateStore((s) => s.loading);

  // Track previous agent count for re-layout detection
  const prevCountRef = useRef(0);

  // Fetch agents on mount
  useEffect(() => {
    void fetchAgents();
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

  // Build React Flow elements from store
  const rawNodes = useMemo(() => buildNodes(agents), [agents]);
  const rawEdges = useMemo(() => buildEdges(agents, ipcFlashes), [agents, ipcFlashes]);

  // Apply dagre layout
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(rawNodes, rawEdges, { direction: "TB" }),
    [rawNodes, rawEdges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Re-layout when agents change (new spawn / removal)
  useEffect(() => {
    if (agents.length !== prevCountRef.current) {
      prevCountRef.current = agents.length;
      const fresh = getLayoutedElements(
        buildNodes(agents),
        buildEdges(agents, ipcFlashes),
        { direction: "TB" },
      );
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
    } else {
      // Just update data (status, flash) without re-layout
      setNodes((prev) =>
        prev.map((n) => {
          const match = rawNodes.find((r) => r.id === n.id);
          return match ? { ...n, data: match.data } : n;
        }),
      );
      setEdges(rawEdges);
    }
  }, [agents, ipcFlashes, rawNodes, rawEdges, setNodes, setEdges]);

  const onLayout = useCallback(
    (direction: "TB" | "LR") => {
      const result = getLayoutedElements(nodes, edges, { direction });
      setNodes(result.nodes);
      setEdges(result.edges);
    },
    [nodes, edges, setNodes, setEdges],
  );

  // Handle node click → open detail panel
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectAgent(node.id);
    },
    [selectAgent],
  );

  // Get selected agent data for the panel
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

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
          Vertical
        </button>
        <button style={toolbarBtn} onClick={() => onLayout("LR")}>
          Horizontal
        </button>
        {loading && (
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-secondary)",
              alignSelf: "center",
              marginLeft: 8,
            }}
          >
            Loading...
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
