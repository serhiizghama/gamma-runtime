/**
 * useLayoutPersistence — Saves and restores React Flow node positions
 * to localStorage, enabling manual layout persistence across sessions.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { Node } from "@xyflow/react";

export interface UseLayoutPersistenceOptions {
  /** Storage key prefix, e.g. 'syndicate-map' */
  storageKey: string;
}

export interface SavedPositions {
  [nodeId: string]: { x: number; y: number };
}

export interface UseLayoutPersistenceResult {
  /** Apply saved positions to nodes (returns nodes with restored positions, or null if no saved state) */
  restorePositions: (nodes: Node[]) => Node[] | null;
  /** Save current positions (debounced internally by 500ms) */
  savePositions: (nodes: Node[]) => void;
  /** Clear saved positions */
  clearPositions: () => void;
  /** Whether saved positions exist */
  hasSavedPositions: boolean;
  /** 'auto' if using dagre layout, 'manual' if user has custom positions */
  layoutMode: "auto" | "manual";
}

function readPositions(key: string): SavedPositions | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as SavedPositions;
  } catch {
    return null;
  }
}

function writePositions(key: string, positions: SavedPositions): void {
  try {
    localStorage.setItem(key, JSON.stringify(positions));
  } catch {
    // localStorage may be full or unavailable — silently ignore
  }
}

export function useLayoutPersistence(
  options: UseLayoutPersistenceOptions,
): UseLayoutPersistenceResult {
  const { storageKey } = options;

  const [layoutMode, setLayoutMode] = useState<"auto" | "manual">(() =>
    readPositions(storageKey) != null ? "manual" : "auto",
  );
  const [hasSavedPositions, setHasSavedPositions] = useState<boolean>(
    () => readPositions(storageKey) != null,
  );

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const restorePositions = useCallback(
    (nodes: Node[]): Node[] | null => {
      const saved = readPositions(storageKey);
      if (!saved) return null;

      // Only restore if at least one node has a saved position
      let anyRestored = false;
      const restored = nodes.map((node) => {
        const pos = saved[node.id];
        if (pos) {
          anyRestored = true;
          return { ...node, position: { x: pos.x, y: pos.y } };
        }
        return node;
      });

      return anyRestored ? restored : null;
    },
    [storageKey],
  );

  const savePositions = useCallback(
    (nodes: Node[]): void => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      debounceTimer.current = setTimeout(() => {
        const positions: SavedPositions = {};
        for (const node of nodes) {
          positions[node.id] = { x: node.position.x, y: node.position.y };
        }
        writePositions(storageKey, positions);
        setLayoutMode("manual");
        setHasSavedPositions(true);
      }, 500);
    },
    [storageKey],
  );

  const clearPositions = useCallback((): void => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    setLayoutMode("auto");
    setHasSavedPositions(false);
  }, [storageKey]);

  return {
    restorePositions,
    savePositions,
    clearPositions,
    hasSavedPositions,
    layoutMode,
  };
}
