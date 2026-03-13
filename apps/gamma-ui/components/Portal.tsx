import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PortalProps {
  children: ReactNode;
  containerId?: string;
}

/**
 * Portal — renders children into #gamma-os-portal-root (or any container by id).
 * Required by spec §11: dropdowns, tooltips, context menus must escape
 * the stacking context created by window `transform` properties.
 */
export function Portal({ children, containerId = "gamma-os-portal-root" }: PortalProps) {
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    containerRef.current = document.getElementById(containerId);
  }, [containerId]);

  const container =
    containerRef.current ?? document.getElementById(containerId);

  if (!container) return null;
  return createPortal(children, container);
}
