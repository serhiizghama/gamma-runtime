/**
 * clustering.ts — Subtree collapse/expand logic for the Syndicate Map.
 *
 * Pure utility module (no React, no hooks). Given the full agent list and
 * a set of collapsed node IDs, produces the visible agents and cluster
 * descriptors for React Flow rendering.
 */

import type { SyndicateAgent } from "../../store/syndicate.store";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ClusterInfo {
  /** The agent ID that is the root of the collapsed subtree. */
  clusterId: string;
  /** The agent that serves as cluster root. */
  root: SyndicateAgent;
  /** All agents in the collapsed subtree (including root). */
  members: SyndicateAgent[];
  /** Count of child agents hidden by the collapse (excludes root). */
  hiddenCount: number;
  /** Aggregate in-progress task count across all members. */
  totalTasks: number;
  /** Aggregate worst status: running > idle > offline. */
  worstStatus: string;
}

export interface ClusteringResult {
  /** Agents to show as individual nodes. */
  visibleAgents: SyndicateAgent[];
  /** Clusters to show as cluster nodes. */
  clusters: ClusterInfo[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Status severity: higher = worse (more attention-demanding). */
const STATUS_SEVERITY: Record<string, number> = {
  offline: 0,
  idle: 1,
  running: 2,
  error: 3,
  aborted: 3,
};

function worstOf(a: string, b: string): string {
  return (STATUS_SEVERITY[b] ?? 0) > (STATUS_SEVERITY[a] ?? 0) ? b : a;
}

/**
 * Build a children lookup: parentId → child agents.
 */
function buildChildrenMap(
  agents: SyndicateAgent[],
): Map<string, SyndicateAgent[]> {
  const map = new Map<string, SyndicateAgent[]>();
  for (const agent of agents) {
    if (agent.supervisorId != null) {
      const siblings = map.get(agent.supervisorId);
      if (siblings) {
        siblings.push(agent);
      } else {
        map.set(agent.supervisorId, [agent]);
      }
    }
  }
  return map;
}

/**
 * Collect all descendants of `rootId` (inclusive) using the children map.
 */
function collectSubtree(
  rootAgent: SyndicateAgent,
  childrenMap: Map<string, SyndicateAgent[]>,
): SyndicateAgent[] {
  const result: SyndicateAgent[] = [rootAgent];
  const stack = [rootAgent.id];

  while (stack.length > 0) {
    const parentId = stack.pop()!;
    const children = childrenMap.get(parentId);
    if (children) {
      for (const child of children) {
        result.push(child);
        stack.push(child.id);
      }
    }
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────

/**
 * Given the full agent list and a set of collapsed agent IDs, compute
 * which agents are visible individually and which are collapsed into
 * cluster nodes.
 *
 * Rules:
 *  - A collapsed agent and all its descendants become a single cluster.
 *  - If a descendant is also in `collapsedIds`, it is still swallowed by
 *    the nearest collapsed ancestor (no nested clusters).
 *  - Agents not under any collapsed subtree appear in `visibleAgents`.
 */
export function computeClusters(
  agents: SyndicateAgent[],
  collapsedIds: Set<string>,
): ClusteringResult {
  if (collapsedIds.size === 0) {
    return { visibleAgents: agents, clusters: [] };
  }

  const agentById = new Map<string, SyndicateAgent>();
  for (const a of agents) agentById.set(a.id, a);

  const childrenMap = buildChildrenMap(agents);

  // Determine which collapsed IDs are "top-level" — i.e. not already
  // nested under another collapsed ancestor.
  const topLevelCollapsed = new Set<string>();

  for (const id of collapsedIds) {
    if (!agentById.has(id)) continue; // skip stale IDs

    let ancestor = agentById.get(id)!.supervisorId;
    let swallowed = false;
    while (ancestor != null) {
      if (collapsedIds.has(ancestor) && agentById.has(ancestor)) {
        swallowed = true;
        break;
      }
      ancestor = agentById.get(ancestor)?.supervisorId ?? null;
    }
    if (!swallowed) {
      topLevelCollapsed.add(id);
    }
  }

  // Collect members for each top-level cluster and track hidden agent IDs.
  const hiddenIds = new Set<string>();
  const clusters: ClusterInfo[] = [];

  for (const clusterId of topLevelCollapsed) {
    const root = agentById.get(clusterId)!;
    const members = collectSubtree(root, childrenMap);

    let totalTasks = 0;
    let worst = "offline";
    for (const m of members) {
      totalTasks += m.inProgressTaskCount;
      worst = worstOf(worst, m.liveStatus);
      hiddenIds.add(m.id);
    }

    clusters.push({
      clusterId,
      root,
      members,
      hiddenCount: members.length - 1, // exclude root
      totalTasks,
      worstStatus: worst,
    });
  }

  const visibleAgents = agents.filter((a) => !hiddenIds.has(a.id));

  return { visibleAgents, clusters };
}
