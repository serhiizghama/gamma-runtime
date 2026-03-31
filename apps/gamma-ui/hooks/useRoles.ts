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

    const sorted = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        roles: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));

    // Virtual category: "Team Leaders" — roles suitable for leading a team.
    // Curated by role ID. Placed first in the list for quick access.
    const leaderRoleIds = new Set([
      "project-management/project-manager-senior",
      "product/product-manager",
      "engineering/engineering-software-architect",
      "engineering/engineering-backend-architect",
      "design/design-ux-architect",
      "job-hunting/job-hunting-squad-leader",
      "game-development/unity/unity-architect",
      "game-development/unreal-engine/unreal-multiplayer-architect",
      "engineering/engineering-autonomous-optimization-architect",
      "specialized/specialized-workflow-architect",
      "specialized/automation-governance-architect",
      "specialized/agentic-identity-trust",
      "spatial-computing/xr-interface-architect",
      "specialized/specialized-salesforce-architect",
    ]);

    const leaderRoles = roles
      .filter((r) => leaderRoleIds.has(r.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (leaderRoles.length > 0) {
      sorted.unshift({ category: "Team Leaders", roles: leaderRoles });
    }

    return sorted;
  }, [roles]);

  return { roles, grouped, loading, error };
}
