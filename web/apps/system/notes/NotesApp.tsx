import React, { useState } from "react";

interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

function createNote(): Note {
  const now = Date.now();
  return {
    id: `note-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Untitled note",
    body: "",
    createdAt: now,
  };
}

export function NotesApp(): React.ReactElement {
  const [notes, setNotes] = useState<Note[]>([createNote()]);
  const [activeId, setActiveId] = useState<string>(notes[0].id);

  const activeNote = notes.find((n) => n.id === activeId) ?? notes[0];

  const updateActive = (patch: Partial<Pick<Note, "title" | "body">>) => {
    if (!activeNote) return;
    setNotes((prev) =>
      prev.map((n) =>
        n.id === activeNote.id
          ? {
              ...n,
              ...patch,
            }
          : n,
      ),
    );
  };

  const addNote = () => {
    const next = createNote();
    setNotes((prev) => [next, ...prev]);
    setActiveId(next.id);
  };

  const deleteNote = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (activeId === id && notes.length > 1) {
      const remaining = notes.filter((n) => n.id !== id);
      setActiveId(remaining[0]?.id ?? "");
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        background:
          "radial-gradient(circle at top left, #1e293b 0, #020617 40%, #020617 100%)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-system)",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: 220,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          padding: "12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "rgba(15,23,42,0.96)",
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
              color: "rgba(248,250,252,0.6)",
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
              background:
                "linear-gradient(135deg, rgba(52,211,153,0.95), rgba(59,130,246,0.95))",
              color: "#020617",
              boxShadow: "0 6px 14px rgba(34,197,94,0.45)",
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
                    ? "rgba(148,163,184,0.24)"
                    : "rgba(15,23,42,0.7)",
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
                  color: "rgba(148,163,184,0.9)",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  width: "100%",
                }}
              >
                {new Date(n.createdAt).toLocaleString()}
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
                onChange={(e) => updateActive({ title: e.target.value })}
                placeholder="Note title"
                style={{
                  flex: 1,
                  border: "none",
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 16,
                  fontWeight: 600,
                  background: "rgba(15,23,42,0.8)",
                  outline: "none",
                  color: "var(--text-primary)",
                }}
              />
              <button
                type="button"
                onClick={() => deleteNote(activeNote.id)}
                style={{
                  borderRadius: 999,
                  border: "1px solid rgba(248,113,113,0.6)",
                  padding: "6px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  background: "rgba(248,113,113,0.08)",
                  color: "#fecaca",
                }}
              >
                Delete
              </button>
            </div>
            <textarea
              value={activeNote.body}
              onChange={(e) => updateActive({ body: e.target.value })}
              placeholder="Write your thoughts…"
              spellCheck={true}
              style={{
                flex: 1,
                resize: "none",
                borderRadius: 12,
                border: "1px solid rgba(148,163,184,0.45)",
                padding: "10px 12px",
                fontFamily:
                  "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
                fontSize: 14,
                lineHeight: 1.6,
                background: "rgba(15,23,42,0.95)",
                color: "var(--text-primary)",
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
              color: "var(--text-secondary)",
            }}
          >
            No notes yet. Click + to create one.
          </div>
        )}
      </div>
    </div>
  );
}

