/**
 * layout.ts — Dagre-based auto-layout for the Syndicate Map.
 *
 * Converts a flat list of React Flow nodes + edges into a positioned
 * directed graph using @dagrejs/dagre (hierarchical / layered layout).
 */

import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

export interface LayoutOptions {
  /** Graph direction: TB (top-bottom), LR (left-right), etc. */
  direction?: "TB" | "LR" | "BT" | "RL";
  /** Horizontal spacing between nodes (px). */
  nodesep?: number;
  /** Vertical spacing between ranks (px). */
  ranksep?: number;
}

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 160; // Accounts for avatar (84px) + name + role + padding

/** Padding inside team group containers. */
const GROUP_PAD_X = 48;
const GROUP_PAD_TOP = 56; // Extra space for the team label pill
const GROUP_PAD_BOTTOM = 48;

/**
 * Run dagre layout on the given nodes and edges, returning new copies
 * with updated `position.x` / `position.y` values.
 *
 * Supports compound groups (nodes with `parentId`):
 *  - Pass 1: Layout each group's children internally to compute bounding box
 *  - Pass 2: Layout top-level graph (group rectangles + ungrouped nodes)
 *  - Combine: Group position from Pass 2, child positions relative to parent
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {},
): { nodes: Node[]; edges: Edge[] } {
  const {
    direction = "TB",
    nodesep = 80,
    ranksep = 100,
  } = options;

  // Separate group nodes, child nodes, and top-level nodes
  const groupNodes: Node[] = [];
  const childrenByGroup = new Map<string, Node[]>();
  const topLevelNodes: Node[] = [];

  for (const node of nodes) {
    if (node.type === "teamGroup") {
      groupNodes.push(node);
      childrenByGroup.set(node.id, []);
    }
  }

  for (const node of nodes) {
    if (node.type === "teamGroup") continue;
    if (node.parentId && childrenByGroup.has(node.parentId)) {
      childrenByGroup.get(node.parentId)!.push(node);
    } else {
      topLevelNodes.push(node);
    }
  }

  // If no groups, use simple flat layout
  if (groupNodes.length === 0) {
    return layoutFlat(nodes, edges, direction, nodesep, ranksep);
  }

  // ── Pass 1: Layout children within each group ─────────────────────────
  // Maps groupId → { relativePositions, bbox }
  const groupInternals = new Map<
    string,
    { positions: Map<string, { x: number; y: number }>; width: number; height: number }
  >();

  for (const group of groupNodes) {
    const children = childrenByGroup.get(group.id) ?? [];
    if (children.length === 0) {
      groupInternals.set(group.id, {
        positions: new Map(),
        width: (group.style?.width as number) ?? 200,
        height: (group.style?.height as number) ?? 150,
      });
      continue;
    }

    // Build a sub-graph for just this group's children
    const childIds = new Set(children.map((c) => c.id));
    const childEdges = edges.filter(
      (e) => childIds.has(e.source) && childIds.has(e.target),
    );

    const subG = new dagre.graphlib.Graph();
    subG.setDefaultEdgeLabel(() => ({}));
    subG.setGraph({ rankdir: direction, nodesep: nodesep * 0.9, ranksep: ranksep * 0.85 });

    for (const child of children) {
      subG.setNode(child.id, {
        width: (child.measured?.width ?? child.width) || DEFAULT_NODE_WIDTH,
        height: (child.measured?.height ?? child.height) || DEFAULT_NODE_HEIGHT,
      });
    }
    for (const edge of childEdges) {
      subG.setEdge(edge.source, edge.target);
    }

    dagre.layout(subG);

    // Compute bounding box and convert to top-left relative positions
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rawPositions = new Map<string, { x: number; y: number; w: number; h: number }>();

    for (const child of children) {
      const pos = subG.node(child.id);
      const w = (child.measured?.width ?? child.width) || DEFAULT_NODE_WIDTH;
      const h = (child.measured?.height ?? child.height) || DEFAULT_NODE_HEIGHT;
      const topLeftX = pos.x - w / 2;
      const topLeftY = pos.y - h / 2;
      rawPositions.set(child.id, { x: topLeftX, y: topLeftY, w, h });
      minX = Math.min(minX, topLeftX);
      minY = Math.min(minY, topLeftY);
      maxX = Math.max(maxX, topLeftX + w);
      maxY = Math.max(maxY, topLeftY + h);
    }

    // Shift positions so they start at (GROUP_PAD_X, GROUP_PAD_TOP)
    const positions = new Map<string, { x: number; y: number }>();
    for (const [id, raw] of rawPositions) {
      positions.set(id, {
        x: raw.x - minX + GROUP_PAD_X,
        y: raw.y - minY + GROUP_PAD_TOP,
      });
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const groupWidth = contentWidth + GROUP_PAD_X * 2;
    const groupHeight = contentHeight + GROUP_PAD_TOP + GROUP_PAD_BOTTOM;

    groupInternals.set(group.id, { positions, width: groupWidth, height: groupHeight });
  }

  // ── Pass 2: Layout top-level graph ────────────────────────────────────
  const topG = new dagre.graphlib.Graph();
  topG.setDefaultEdgeLabel(() => ({}));
  topG.setGraph({ rankdir: direction, nodesep, ranksep });

  // Add group nodes as big rectangles
  for (const group of groupNodes) {
    const internal = groupInternals.get(group.id)!;
    topG.setNode(group.id, { width: internal.width, height: internal.height });
  }

  // Add ungrouped top-level nodes
  for (const node of topLevelNodes) {
    topG.setNode(node.id, {
      width: (node.measured?.width ?? node.width) || DEFAULT_NODE_WIDTH,
      height: (node.measured?.height ?? node.height) || DEFAULT_NODE_HEIGHT,
    });
  }

  // Add edges between top-level entities (resolve child→group edges)
  const childToGroup = new Map<string, string>();
  for (const [groupId, children] of childrenByGroup) {
    for (const child of children) {
      childToGroup.set(child.id, groupId);
    }
  }

  const addedEdges = new Set<string>();
  for (const edge of edges) {
    const resolvedSource = childToGroup.get(edge.source) ?? edge.source;
    const resolvedTarget = childToGroup.get(edge.target) ?? edge.target;
    if (resolvedSource === resolvedTarget) continue; // skip intra-group edges
    const edgeKey = `${resolvedSource}:${resolvedTarget}`;
    if (addedEdges.has(edgeKey)) continue;
    addedEdges.add(edgeKey);
    // Only add if both ends exist in the top-level graph
    if (topG.node(resolvedSource) && topG.node(resolvedTarget)) {
      topG.setEdge(resolvedSource, resolvedTarget);
    }
  }

  dagre.layout(topG);

  // ── Combine results ───────────────────────────────────────────────────
  const resultNodes: Node[] = [];

  // Place group nodes
  for (const group of groupNodes) {
    const pos = topG.node(group.id);
    const internal = groupInternals.get(group.id)!;
    resultNodes.push({
      ...group,
      position: {
        x: pos.x - internal.width / 2,
        y: pos.y - internal.height / 2,
      },
      style: { ...group.style, width: internal.width, height: internal.height },
    });
  }

  // Place children with relative positions
  for (const [groupId, children] of childrenByGroup) {
    const internal = groupInternals.get(groupId);
    if (!internal) continue;
    for (const child of children) {
      const relPos = internal.positions.get(child.id);
      resultNodes.push({
        ...child,
        position: relPos ?? { x: GROUP_PAD_X, y: GROUP_PAD_TOP },
      });
    }
  }

  // Place ungrouped top-level nodes
  for (const node of topLevelNodes) {
    const pos = topG.node(node.id);
    const w = (node.measured?.width ?? node.width) || DEFAULT_NODE_WIDTH;
    const h = (node.measured?.height ?? node.height) || DEFAULT_NODE_HEIGHT;
    resultNodes.push({
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    });
  }

  return { nodes: resultNodes, edges };
}

/** Simple flat layout (no groups). */
function layoutFlat(
  nodes: Node[],
  edges: Edge[],
  direction: string,
  nodesep: number,
  ranksep: number,
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep, ranksep });

  for (const node of nodes) {
    g.setNode(node.id, {
      width: (node.measured?.width ?? node.width) || DEFAULT_NODE_WIDTH,
      height: (node.measured?.height ?? node.height) || DEFAULT_NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const w = (node.measured?.width ?? node.width) || DEFAULT_NODE_WIDTH;
    const h = (node.measured?.height ?? node.height) || DEFAULT_NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
