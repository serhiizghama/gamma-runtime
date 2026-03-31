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
import type { TeamGroupNodeData } from "../components/SyndicateMap/TeamGroupNode";
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

function isLeaderRole(roleId: string, name: string): boolean {
  const r = roleId.toLowerCase();
  const n = name.toLowerCase();
  return r.includes("squad-leader") || r.includes("leader") || n.includes("squad leader") || n.includes("lead");
}

function agentToNodeData(a: SyndicateAgent, leader?: boolean): AgentNodeData {
  return {
    name: a.name,
    roleId: a.roleId,
    avatarEmoji: a.avatarEmoji,
    uiColor: a.uiColor,
    status: a.liveStatus,
    inProgressTaskCount: a.inProgressTaskCount,
    teamName: a.teamName ?? null,
    isLeader: leader ?? isLeaderRole(a.roleId, a.name),
  };
}

function buildNodes(agents: SyndicateAgent[]): Node[] {
  // Determine team leaders so they can be flagged in node data
  const teamLeaders = new Set<string>();
  const byTeam = new Map<string, SyndicateAgent[]>();
  for (const a of agents) {
    if (a.teamName) {
      const list = byTeam.get(a.teamName);
      if (list) list.push(a);
      else byTeam.set(a.teamName, [a]);
    }
  }
  for (const members of byTeam.values()) {
    const leader = members.find((m) => isLeaderRole(m.roleId, m.name)) ?? members[0];
    if (leader) teamLeaders.add(leader.id);
  }

  return agents.map((a) => ({
    id: a.id,
    type: "agent" as const,
    position: { x: 0, y: 0 },
    data: agentToNodeData(a, teamLeaders.has(a.id)),
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
  // Build team leader map: agentId → leaderId for all team members
  // Team members' edges point to their leader; leader's edge points to their supervisor
  const teamLeaderOf = new Map<string, string>(); // memberId → leaderId
  const byTeamForEdges = new Map<string, SyndicateAgent[]>();
  for (const a of agents) {
    if (a.teamName) {
      const list = byTeamForEdges.get(a.teamName);
      if (list) list.push(a);
      else byTeamForEdges.set(a.teamName, [a]);
    }
  }
  for (const members of byTeamForEdges.values()) {
    if (members.length < 2) continue;
    const leader = members.find((m) => isLeaderRole(m.roleId, m.name)) ?? members[0];
    if (!leader) continue;
    for (const m of members) {
      if (m.id !== leader.id) {
        teamLeaderOf.set(m.id, leader.id);
      }
    }
  }
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
  const addedEdgeKeys = new Set<string>();
  for (const a of agents) {
    // For non-leader team members: edge goes to their team leader (not external supervisor)
    const overrideTarget = teamLeaderOf.get(a.id);
    if (overrideTarget && visibleNodeIds.has(overrideTarget)) {
      const edgeKey = `${overrideTarget}:${a.id}`;
      if (!addedEdgeKeys.has(edgeKey)) {
        addedEdgeKeys.add(edgeKey);
        const isFlashing = flashSet.has(`${overrideTarget}:${a.id}`) || flashSet.has(`${a.id}:${overrideTarget}`);
        edges.push({
          id: `e-${overrideTarget}-${a.id}`,
          source: overrideTarget,
          target: a.id,
          type: "ipc",
          animated: !isFlashing,
          data: { flashing: isFlashing, color: "var(--color-border-subtle)" } satisfies IpcEdgeData,
        });
      }
      continue; // skip normal supervisorId edge for this member
    }

    if (!a.supervisorId) continue;

    // Resolve source: if supervisor is in a cluster, point to cluster node
    const source = agentToClusterNode.get(a.supervisorId) ?? a.supervisorId;
    if (!visibleNodeIds.has(source)) continue;

    const isFlashing = flashSet.has(`${a.supervisorId}:${a.id}`) || flashSet.has(`${a.id}:${a.supervisorId}`);
    const edgeKey = `${source}:${a.id}`;
    if (addedEdgeKeys.has(edgeKey)) continue;
    addedEdgeKeys.add(edgeKey);

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

  // Edges from team leaders with no supervisorId → System Architect (visual hierarchy hint)
  const architectAgent = agents.find((a) => a.roleId === "architect");
  if (architectAgent && visibleNodeIds.has(architectAgent.id)) {
    // Find team leaders that have no supervisor edge yet
    const agentsWithEdges = new Set<string>();
    for (const e of edges) agentsWithEdges.add(e.target);

    for (const [, members] of byTeamForEdges) {
      const leader = members.find((m) => isLeaderRole(m.roleId, m.name)) ?? members[0];
      if (!leader) continue;
      if (leader.id === architectAgent.id) continue;
      if (leader.supervisorId) continue; // already has explicit supervisor
      if (agentsWithEdges.has(leader.id)) continue; // already has an incoming edge

      const edgeKey = `${architectAgent.id}:${leader.id}`;
      if (addedEdgeKeys.has(edgeKey)) continue;
      addedEdgeKeys.add(edgeKey);

      edges.push({
        id: `e-${architectAgent.id}-${leader.id}`,
        source: architectAgent.id,
        target: leader.id,
        type: "ipc",
        animated: true,
        data: { flashing: false, color: "var(--color-border-subtle)" } satisfies IpcEdgeData,
      });
    }
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
 * Build team group nodes for agents that share a teamName (1+ members).
 * Returns { groupNodes, teamMemberIds } where teamMemberIds maps agentId → teamGroupNodeId.
 */
function buildTeamGroups(agents: SyndicateAgent[]): {
  groupNodes: Node[];
  teamMemberIds: Map<string, string>;
} {
  const byTeam = new Map<string, SyndicateAgent[]>();
  for (const a of agents) {
    const team = a.teamName;
    if (!team) continue;
    const list = byTeam.get(team);
    if (list) list.push(a);
    else byTeam.set(team, [a]);
  }

  const groupNodes: Node[] = [];
  const teamMemberIds = new Map<string, string>();

  for (const [teamName, members] of byTeam) {
    if (members.length < 1) continue;
    const groupId = `team-${teamName}`;
    groupNodes.push({
      id: groupId,
      type: "teamGroup" as const,
      position: { x: 0, y: 0 },
      data: {
        teamName,
        teamId: members[0]?.teamId || "",
        memberCount: members.length,
        uiColor: members[0]?.uiColor || "#6366f1",
      } satisfies TeamGroupNodeData,
      style: { width: 400, height: 250 },
    });
    for (const m of members) {
      teamMemberIds.set(m.id, groupId);
    }
  }

  return { groupNodes, teamMemberIds };
}

/**
 * Topology fingerprint — a string that changes ONLY when graph structure
 * changes (agent added/removed, supervisor link changed, team changed).
 * Status, flash, and data-only changes do NOT affect this fingerprint.
 */
function topologyFingerprint(agents: SyndicateAgent[], collapsedIds: Set<string>): string {
  const agentPart = agents
    .map((a) => `${a.id}:${a.supervisorId ?? ""}:${a.teamName ?? ""}`)
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

  const { groupNodes, teamMemberIds } = useMemo(
    () => buildTeamGroups(visibleAgents),
    [visibleAgents],
  );

  const nodes = useMemo(() => {
    const agentNodes = buildNodes(visibleAgents).map((n) => {
      const parentId = teamMemberIds.get(n.id);
      if (parentId) {
        return {
          ...n,
          parentId,
          extent: "parent" as const,
          data: { ...n.data, isInTeamGroup: true },
        };
      }
      return n;
    });
    // Group nodes MUST come before their children in the array
    return [...groupNodes, ...agentNodes, ...buildClusterNodes(clusters)];
  }, [visibleAgents, clusters, groupNodes, teamMemberIds]);

  const edges = useMemo(
    () => buildEdges(visibleAgents, ipcFlashes, clusters),
    [visibleAgents, ipcFlashes, clusters],
  );

  // Memoize the return object so its reference only changes when content changes.
  // Without this, a new object literal is created on every render, causing
  // the useEffect in SyndicateMapInner (which depends on `graph`) to fire
  // every render → setEdges → re-render → infinite loop (React "Maximum update
  // depth exceeded").
  return useMemo(
    () => ({ nodes, edges, topologyKey }),
    [nodes, edges, topologyKey],
  );
}
