import React, { useState } from "react";
import { useNotesStore, type Note } from "../../../store/useNotesStore";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function NotesApp(): React.ReactElement {
  const notes = useNotesStore((s) => s.notes);
  const activeId = useNotesStore((s) => s.activeId);
  const addNote = useNotesStore((s) => s.addNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const setActiveId = useNotesStore((s) => s.setActiveId);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const activeNote: Note | undefined =
    notes.find((n) => n.id === activeId) ?? notes[0];

  const handleDeleteClick = (id: string) => {
    setPendingDeleteId(id);
  };

  const confirmDelete = () => {
    if (pendingDeleteId) {
      deleteNote(pendingDeleteId);
      setPendingDeleteId(null);
    }
  };

  const cancelDelete = () => {
    setPendingDeleteId(null);
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        background: "var(--color-bg-base)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-system)",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: 220,
          borderRight: "1px solid var(--color-surface-muted)",
          padding: "12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "var(--color-surface)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--color-text-muted-strong)",
            }}
          >
            Notes
          </span>
          <button
            type="button"
            onClick={addNote}
            style={{
              borderRadius: 999,
              border: "none",
              width: 22,
              height: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              cursor: "pointer",
              background: "var(--button-primary-bg)",
              color: "var(--button-primary-fg)",
              boxShadow: "var(--shadow-button-primary)",
            }}
          >
            +
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {notes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setActiveId(n.id)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "7px 8px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background:
                  n.id === activeId
                    ? "var(--color-surface-muted-strong)"
                    : "var(--color-surface)",
                color: "inherit",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  width: "100%",
                }}
              >
                {n.title || "Untitled note"}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted-strong)",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  width: "100%",
                }}
              >
                {formatDate(n.createdAt)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "12px 16px",
          gap: 10,
        }}
      >
        {activeNote ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <input
                value={activeNote.title}
                onChange={(e) =>
                  updateNote(activeNote.id, { title: e.target.value })
                }
                placeholder="Note title"
                style={{
                  flex: 1,
                  border: "none",
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 16,
                  fontWeight: 600,
                  background: "var(--color-surface)",
                  outline: "none",
                  color: "var(--color-text-primary)",
                }}
              />
              {pendingDeleteId === activeNote.id ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={confirmDelete}
                    style={{
                      borderRadius: 999,
                      border: "1px solid var(--button-danger-border)",
                      padding: "6px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                      background: "var(--button-danger-bg)",
                      color: "var(--button-danger-fg)",
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={cancelDelete}
                    style={{
                      borderRadius: 999,
                      border: "1px solid var(--color-border-subtle-strong)",
                      padding: "6px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                      background: "var(--color-surface)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleDeleteClick(activeNote.id)}
                  style={{
                    borderRadius: 999,
                    border: "1px solid var(--button-danger-border)",
                    padding: "6px 10px",
                    fontSize: 11,
                    cursor: "pointer",
                    background: "var(--button-danger-bg)",
                    color: "var(--button-danger-fg)",
                  }}
                >
                  Delete
                </button>
              )}
            </div>
            <textarea
              value={activeNote.body}
              onChange={(e) =>
                updateNote(activeNote.id, { body: e.target.value })
              }
              placeholder="Write your thoughts…"
              spellCheck={true}
              style={{
                flex: 1,
                resize: "none",
                borderRadius: 12,
                border: "1px solid var(--color-border-subtle-strong)",
                padding: "10px 12px",
                fontFamily: "var(--font-system)",
                fontSize: 14,
                lineHeight: 1.6,
                background: "var(--color-surface-elevated)",
                color: "var(--color-text-primary)",
                outline: "none",
              }}
            />
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-text-secondary)",
            }}
          >
            No notes yet. Click + to create one.
          </div>
        )}
      </div>
    </div>
  );
}
