/**
 * useRoles — Fetches community role templates from the backend.
 *
 * Returns roles grouped by category prefix (e.g. "Engineering", "Design").
 * Module-level cache so roles survive modal close/reopen without re-fetching.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { API_BASE } from "../constants/api";
import { systemAuthHeaders } from "../lib/auth";

export interface RoleEntry {
  id: string;
  fileName: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  vibe: string;
}

export interface RoleGroup {
  category: string;
  roles: RoleEntry[];
}

// Module-level cache — persists across modal open/close cycles
let cachedRoles: RoleEntry[] | null = null;

export function useRoles(): {
  roles: RoleEntry[];
  grouped: RoleGroup[];
  loading: boolean;
  error: string | null;
} {
  const [roles, setRoles] = useState<RoleEntry[]>(cachedRoles ?? []);
  const [loading, setLoading] = useState(!cachedRoles);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (cachedRoles) return;

    fetch(`${API_BASE}/api/agents/roles`, { headers: systemAuthHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: RoleEntry[]) => {
        cachedRoles = data;
        if (mountedRef.current) {
          setRoles(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (mountedRef.current) setError(err.message);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const grouped = useMemo((): RoleGroup[] => {
    const map = new Map<string, RoleEntry[]>();
    for (const role of roles) {
      const slash = role.id.indexOf("/");
      const raw = slash > 0 ? role.id.slice(0, slash) : "other";
      // "game-development" → "Game Development"
      const category = raw
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      if (!map.has(category)) map.set(category, []);
      map.get(category)!.push(role);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        roles: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [roles]);

  return { roles, grouped, loading, error };
}
