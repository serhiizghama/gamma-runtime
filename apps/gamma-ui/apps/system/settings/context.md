## Gamma Agent Runtime Settings (system app)

**Purpose**
- Central place to tune core Gamma Agent Runtime UI behavior.
- Controls theme, live background parameters, and global reset.

**Current behavior**
- Reads and writes `uiSettings` from the global OS store (`useOSStore`).
- Lets the user:
  - Switch between light and dark themes.
  - Adjust live background blur (`bgBlur`) and animation speed (`bgSpeed`).
  - Reset all Gamma Agent Runtime state (windows, preferences, persisted session) via a single button.
- All changes are persisted through the `gamma-os-session` local storage key.

**Architecture notes**
- Implemented as a React component that talks only to the OS store, never directly to `localStorage`.
- Uses a small set of pure presentational subcomponents:
  - `SegmentedControl` for theme selection.
  - `SliderRow` for numeric tunables with live labels.
  - `GlassButton` for prominent destructive/system actions.
- The actual reset logic is encapsulated in the store's `resetAll` action (which clears storage and reloads the page).

**Extension ideas for the AI agent**
- Add per-app preferences (e.g., default window size, per-app themes).
- Surface performance and diagnostics toggles (debug overlays, FPS meter, logging verbosity).
- Introduce profiles (e.g., "Focus Mode", "Presentation Mode") that batch-apply multiple settings at once.

