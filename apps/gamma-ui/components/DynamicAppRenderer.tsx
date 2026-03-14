import React, { useState, useEffect, useCallback } from "react";
import type { AppRegistryEntry } from "@gamma/types";

/** Convert kebab-case id to PascalCase (matches scaffold.service) */
function pascal(id: string): string {
  return id
    .replace(/[-_]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

interface DynamicAppRendererProps {
  appId: string;
  entry: AppRegistryEntry | null | undefined;
}

/**
 * Dynamically imports and renders generated app bundles with hot-reload.
 * - Uses entry.updatedAt as React key for full remount on code updates
 * - Renders tombstone when app is removed (entry is null)
 * - Vite-safe: strongly-typed template literal anchored to generated directory
 */
export function DynamicAppRenderer({
  appId,
  entry,
}: DynamicAppRendererProps): React.ReactElement {
  const [Component, setComponent] = useState<
    React.ComponentType | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const loadComponent = useCallback(async () => {
    if (!entry) {
      setComponent(null);
      setError(null);
      return;
    }
    setError(null);
    const PascalId = pascal(appId);
    try {
      const mod = await import(
        /* @vite-ignore */
        `../apps/private/${appId}/${PascalId}App.tsx?t=${entry.updatedAt}`
      );
      const Exported = mod.default ?? mod[Object.keys(mod)[0]];
      setComponent(() => Exported);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setComponent(null);
    }
  }, [appId, entry?.updatedAt]);

  useEffect(() => {
    loadComponent();
  }, [loadComponent]);

  // Tombstone: app removed from registry (e.g. unscaffolded)
  if (!entry) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          color: "var(--color-text-secondary)",
          fontFamily: "var(--font-system)",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
          Application removed
        </h2>
        <p style={{ fontSize: 13, margin: 0 }}>
          This application was removed by the System Architect.
        </p>
      </div>
    );
  }

  // Loading state
  if (!Component && !error) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-secondary)",
          fontSize: 13,
          fontFamily: "var(--font-system)",
        }}
      >
        Loading {entry.displayName}…
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          color: "var(--color-text-secondary)",
          fontFamily: "var(--font-system)",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
          Failed to load app
        </h2>
        <p style={{ fontSize: 12, margin: 0, wordBreak: "break-word" }}>
          {error}
        </p>
      </div>
    );
  }

  // key forces full remount when updatedAt changes (hot-reload)
  return Component ? (
    <Component key={entry.updatedAt} />
  ) : (
    <div />
  );
}
