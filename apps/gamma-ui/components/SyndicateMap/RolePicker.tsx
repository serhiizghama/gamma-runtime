/**
 * RolePicker — Two-level role browser with search and custom role option.
 *
 * Shared by CreateTeamModal and AddAgentModal.
 *
 * Mode A (browse): Opens a popup with category sidebar + role cards.
 * Mode B (custom): Textarea for free-form role description.
 */

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type CSSProperties,
} from "react";
import { useRoles, type RoleEntry } from "../../hooks/useRoles";

// ── Public interface ─────────────────────────────────────────────────────

export interface RolePickerProps {
  /** Currently selected role id (null = nothing selected) */
  selectedRoleId: string | null;
  /** Selected role display name (for pill preview) */
  selectedRoleName: string | null;
  /** Selected role emoji */
  selectedRoleEmoji: string | null;
  /** Called when user picks a role from the catalog */
  onSelect: (role: RoleEntry) => void;
  /** Custom role text (Mode B) */
  customRoleText: string;
  /** Called when user edits custom role textarea */
  onCustomRoleChange: (text: string) => void;
  /** Whether we're in custom role mode */
  isCustomMode: boolean;
  /** Toggle between browse / custom */
  onToggleCustom: () => void;
}

// ── Styles ───────────────────────────────────────────────────────────────

const triggerBtn: CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 13,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-primary)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const triggerBtnSelected: CSSProperties = {
  ...triggerBtn,
  color: "var(--color-text-primary)",
};

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.35)",
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const pickerBox: CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 12,
  width: 620,
  maxWidth: "92vw",
  height: 480,
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
};

const headerBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 16px",
  borderBottom: "1px solid var(--color-border-subtle)",
};

const searchInput: CSSProperties = {
  flex: 1,
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-primary)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 6,
  outline: "none",
};

const closeBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--color-text-secondary)",
  fontSize: 18,
  cursor: "pointer",
  padding: "2px 6px",
  lineHeight: 1,
};

const bodyRow: CSSProperties = {
  display: "flex",
  flex: 1,
  overflow: "hidden",
};

const sidebar: CSSProperties = {
  width: 180,
  minWidth: 180,
  borderRight: "1px solid var(--color-border-subtle)",
  overflowY: "auto",
  padding: "6px 0",
};

const catBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  padding: "6px 14px",
  fontSize: 12,
  fontFamily: "var(--font-system)",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};

const catBtnActive: CSSProperties = {
  ...catBtn,
  color: "var(--color-text-primary)",
  background: "rgba(59, 130, 246, 0.12)",
  fontWeight: 600,
};

const catCount: CSSProperties = {
  fontSize: 10,
  opacity: 0.5,
  marginLeft: 4,
};

const roleList: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 8,
};

const roleCard: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 8,
  cursor: "pointer",
  transition: "background 0.1s",
};

const roleEmoji: CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
  flexShrink: 0,
  marginTop: 1,
};

const roleName: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-primary)",
  lineHeight: 1.2,
};

const roleDesc: CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-secondary)",
  lineHeight: 1.4,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const toggleLink: CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-system)",
  color: "var(--color-accent-primary)",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
  marginTop: 4,
};

const customTextarea: CSSProperties = {
  width: "100%",
  minHeight: 80,
  padding: "var(--space-2, 8px)",
  fontSize: 13,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-primary)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 6,
  outline: "none",
  resize: "vertical",
};

// ── Component ────────────────────────────────────────────────────────────

export function RolePicker({
  selectedRoleId,
  selectedRoleName,
  selectedRoleEmoji,
  onSelect,
  customRoleText,
  onCustomRoleChange,
  isCustomMode,
  onToggleCustom,
}: RolePickerProps) {
  const { grouped, loading } = useRoles();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const roleListRef = useRef<HTMLDivElement>(null);

  // Focus search input when picker opens
  useEffect(() => {
    if (pickerOpen) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [pickerOpen]);

  // Escape closes picker
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  // Filter roles by search
  const filtered = useMemo(() => {
    if (!search.trim()) return grouped;
    const q = search.toLowerCase();
    return grouped
      .map((g) => ({
        ...g,
        roles: g.roles.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.roles.length > 0);
  }, [grouped, search]);

  // Visible roles: active category or all
  // Computed directly (not memoized) to avoid stale data when switching categories
  let visibleRoles: RoleEntry[];
  if (!activeCategory) {
    visibleRoles = filtered.flatMap((g) => g.roles);
  } else {
    const group = filtered.find((g) => g.category === activeCategory);
    visibleRoles = group?.roles ?? [];
  }

  // Scroll role list to top when category changes
  useEffect(() => {
    roleListRef.current?.scrollTo(0, 0);
  }, [activeCategory, search]);

  const handleSelect = useCallback(
    (role: RoleEntry) => {
      onSelect(role);
      setPickerOpen(false);
      setSearch("");
      setActiveCategory(null);
    },
    [onSelect],
  );

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── Custom mode ──────────────────────────────────────────────────────

  if (isCustomMode) {
    return (
      <div>
        <textarea
          style={customTextarea}
          value={customRoleText}
          onChange={(e) => onCustomRoleChange(e.target.value)}
          placeholder="Describe what this agent should do, its expertise, personality..."
          rows={4}
        />
        <button type="button" style={toggleLink} onClick={onToggleCustom}>
          Or pick from existing roles...
        </button>
      </div>
    );
  }

  // ── Browse mode ──────────────────────────────────────────────────────

  return (
    <div>
      {/* Trigger button */}
      <button
        type="button"
        style={selectedRoleId ? triggerBtnSelected : triggerBtn}
        onClick={() => setPickerOpen(true)}
      >
        {selectedRoleId ? (
          <>
            <span style={{ fontSize: 18 }}>{selectedRoleEmoji}</span>
            <span>{selectedRoleName}</span>
          </>
        ) : loading ? (
          "Loading roles..."
        ) : (
          "Choose a role..."
        )}
      </button>
      <button type="button" style={toggleLink} onClick={onToggleCustom}>
        Or describe a custom role...
      </button>

      {/* Picker popup */}
      {pickerOpen && (
        <div
          style={overlay}
          onClick={() => setPickerOpen(false)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={pickerBox} onClick={(e) => e.stopPropagation()}>
            {/* Header with search */}
            <div style={headerBar}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: "var(--font-system)",
                  color: "var(--color-text-primary)",
                  whiteSpace: "nowrap",
                }}
              >
                Choose Role
              </span>
              <input
                ref={searchRef}
                type="text"
                style={searchInput}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActiveCategory(null);
                }}
                placeholder="Search roles..."
              />
              <button
                style={closeBtnStyle}
                onClick={() => setPickerOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* Body: sidebar + role list */}
            <div style={bodyRow}>
              {/* Category sidebar */}
              <div style={sidebar}>
                <button
                  style={
                    activeCategory === null ? catBtnActive : catBtn
                  }
                  onClick={() => setActiveCategory(null)}
                >
                  All
                  <span style={catCount}>
                    {filtered.reduce((s, g) => s + g.roles.length, 0)}
                  </span>
                </button>
                {filtered.map((g) => (
                  <button
                    key={g.category}
                    style={
                      activeCategory === g.category
                        ? catBtnActive
                        : catBtn
                    }
                    onClick={() => setActiveCategory(g.category)}
                  >
                    {g.category}
                    <span style={catCount}>{g.roles.length}</span>
                  </button>
                ))}
              </div>

              {/* Role cards */}
              <div ref={roleListRef} style={roleList}>
                {visibleRoles.length === 0 && (
                  <div
                    style={{
                      padding: 20,
                      textAlign: "center",
                      color: "var(--color-text-secondary)",
                      fontSize: 12,
                      fontFamily: "var(--font-system)",
                    }}
                  >
                    No roles match your search
                  </div>
                )}
                {visibleRoles.map((role) => (
                  <div
                    key={role.id}
                    style={{
                      ...roleCard,
                      background:
                        hoveredId === role.id
                          ? "rgba(59, 130, 246, 0.08)"
                          : selectedRoleId === role.id
                            ? "rgba(59, 130, 246, 0.06)"
                            : "transparent",
                    }}
                    onClick={() => handleSelect(role)}
                    onMouseEnter={() => setHoveredId(role.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <span style={roleEmoji}>{role.emoji}</span>
                    <div>
                      <div style={roleName}>{role.name}</div>
                      <div style={roleDesc}>{role.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
