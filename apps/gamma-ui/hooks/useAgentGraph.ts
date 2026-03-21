/**
 * useAgentGraph — Pure computation hook that builds React Flow nodes and edges
 * from the syndicate agent list, IPC flashes, and collapsed cluster state.
 *
 * Encapsulates: agentToNodeData, buildNodes, buildClusterNodes, buildEdges,
 * topologyFingerprint, and clustering integration. No side effects — just
 * useMemo over the inputs.
 */

import { useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";

import type { AgentNodeData } from "../components/SyndicateMap/AgentNode";
import type { AgentClusterNodeData } from "../components/SyndicateMap/AgentClusterNode";
import type { IpcEdgeData } from "../components/SyndicateMap/IpcEdge";
import { computeClusters, type ClusterInfo } from "../components/SyndicateMap/clustering";
import type { SyndicateAgent, IpcFlash } from "../store/syndicate.store";

// ── Public types ──────────────────────────────────────────────────────────

export interface UseAgentGraphOptions {
  agents: SyndicateAgent[];
  ipcFlashes: IpcFlash[];
  collapsedIds: Set<string>;
}

export interface UseAgentGraphResult {
  nodes: Node[];
  edges: Edge[];
  topologyKey: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────

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

function buildClusterNodes(clusters: ClusterInfo[]): Node[] {
  return clusters.map((c) => ({
    id: `cluster-${c.clusterId}`,
    type: "cluster" as const,
    position: { x: 0, y: 0 },
    data: {
      name: c.root.name,
      avatarEmoji: c.root.avatarEmoji,
      uiColor: c.root.uiColor,
      hiddenCount: c.hiddenCount,
      totalTasks: c.totalTasks,
      worstStatus: c.worstStatus,
      clusterId: c.clusterId,
    } satisfies AgentClusterNodeData,
  }));
}

function buildEdges(
  agents: SyndicateAgent[],
  flashes: IpcFlash[],
  clusters: ClusterInfo[] = [],
): Edge[] {
  // Build flash lookup — check both directions so a->b flash matches b->a edge
  const flashSet = new Set<string>();
  for (const f of flashes) {
    flashSet.add(`${f.source}:${f.target}`);
    flashSet.add(`${f.target}:${f.source}`);
  }

  // Map clustered agent IDs to their cluster node ID so edges resolve correctly
  const agentToClusterNode = new Map<string, string>();
  for (const c of clusters) {
    const clusterNodeId = `cluster-${c.clusterId}`;
    for (const m of c.members) {
      agentToClusterNode.set(m.id, clusterNodeId);
    }
  }

  const edges: Edge[] = [];
  // All valid node IDs: visible agent IDs + cluster node IDs
  const visibleNodeIds = new Set(agents.map((a) => a.id));
  for (const c of clusters) {
    visibleNodeIds.add(`cluster-${c.clusterId}`);
  }

  // Edges from visible agents
  for (const a of agents) {
    if (!a.supervisorId) continue;

    // Resolve source: if supervisor is in a cluster, point to cluster node
    const source = agentToClusterNode.get(a.supervisorId) ?? a.supervisorId;
    if (!visibleNodeIds.has(source)) continue;

    const isFlashing = flashSet.has(`${a.supervisorId}:${a.id}`) || flashSet.has(`${a.id}:${a.supervisorId}`);

    edges.push({
      id: `e-${source}-${a.id}`,
      source,
      target: a.id,
      type: "ipc",
      animated: !isFlashing,
      data: {
        flashing: isFlashing,
        color: "var(--color-border-subtle)",
      } satisfies IpcEdgeData,
    });
  }

  // Edges from cluster nodes to their parent (supervisor of the root agent)
  for (const c of clusters) {
    const rootSupervisor = c.root.supervisorId;
    if (!rootSupervisor) continue;

    const clusterNodeId = `cluster-${c.clusterId}`;
    // Resolve: if root's supervisor is also in a cluster, point to that cluster
    const source = agentToClusterNode.get(rootSupervisor) ?? rootSupervisor;
    if (!visibleNodeIds.has(source)) continue;
    // Avoid self-edges (shouldn't happen but guard)
    if (source === clusterNodeId) continue;

    edges.push({
      id: `e-${source}-${clusterNodeId}`,
      source,
      target: clusterNodeId,
      type: "ipc",
      animated: true,
      data: {
        flashing: false,
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
function topologyFingerprint(agents: SyndicateAgent[], collapsedIds: Set<string>): string {
  const agentPart = agents
    .map((a) => `${a.id}:${a.supervisorId ?? ""}`)
    .sort()
    .join("|");
  const collapsedPart = [...collapsedIds].sort().join(",");
  return `${agentPart}#${collapsedPart}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useAgentGraph({
  agents,
  ipcFlashes,
  collapsedIds,
}: UseAgentGraphOptions): UseAgentGraphResult {
  const topologyKey = useMemo(
    () => topologyFingerprint(agents, collapsedIds),
    [agents, collapsedIds],
  );

  const { visibleAgents, clusters } = useMemo(
    () => computeClusters(agents, collapsedIds),
    [agents, collapsedIds],
  );

  const nodes = useMemo(
    () => [...buildNodes(visibleAgents), ...buildClusterNodes(clusters)],
    [visibleAgents, clusters],
  );

  const edges = useMemo(
    () => buildEdges(visibleAgents, ipcFlashes, clusters),
    [visibleAgents, ipcFlashes, clusters],
  );

  return { nodes, edges, topologyKey };
}
