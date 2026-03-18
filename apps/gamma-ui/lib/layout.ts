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
const DEFAULT_NODE_HEIGHT = 120;

/**
 * Run dagre layout on the given nodes and edges, returning new copies
 * with updated `position.x` / `position.y` values.
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {},
): { nodes: Node[]; edges: Edge[] } {
  const {
    direction = "TB",
    nodesep = 60,
    ranksep = 80,
  } = options;

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
      // dagre returns center coordinates; React Flow expects top-left
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
