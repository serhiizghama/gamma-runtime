import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

interface NotesState {
  notes: Note[];
  activeId: string;
  addNote: () => void;
  deleteNote: (id: string) => void;
  updateNote: (id: string, patch: Partial<Pick<Note, "title" | "body">>) => void;
  setActiveId: (id: string) => void;
}

function makeNote(): Note {
  return {
    id: crypto.randomUUID(),
    title: "Untitled note",
    body: "",
    createdAt: Date.now(),
  };
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => {
      const seed = makeNote();
      return {
        notes: [seed],
        activeId: seed.id,

        addNote: () => {
          const next = makeNote();
          set((state) => ({ notes: [next, ...state.notes], activeId: next.id }));
        },

        /**
         * Uses get() to read the current snapshot — avoids stale-closure issues
         * when add + delete fire in the same batch. Both notes and activeId are
         * updated atomically in a single set() call.
         */
        deleteNote: (id: string) => {
          const { notes, activeId } = get();
          const remaining = notes.filter((n) => n.id !== id);
          const nextActiveId =
            activeId === id ? (remaining[0]?.id ?? "") : activeId;
          set({ notes: remaining, activeId: nextActiveId });
        },

        updateNote: (id: string, patch) => {
          set((state) => ({
            notes: state.notes.map((n) =>
              n.id === id ? { ...n, ...patch } : n,
            ),
          }));
        },

        setActiveId: (id: string) => set({ activeId: id }),
      };
    },
    {
      name: "gamma-notes",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
