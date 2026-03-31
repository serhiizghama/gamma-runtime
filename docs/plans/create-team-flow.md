# Implementation Plan: Create Team & Add Agent on Syndicate Map

## Context

Gamma Runtime — MSc thesis project. The Syndicate Map (`SyndicateMap/`) is a React Flow canvas visualizing agent hierarchy. Currently teams can only be created via blueprint spawner in the CEO Dashboard. For the thesis presentation, we need an inline flow: user clicks "+" on the map → fills a form → team with leader appears on the canvas. Then inside a team, user can add more agents via "+" button.

**Backend is ~100% ready** — all CRUD endpoints, agent factory, roles manifest (161 roles), SQLite persistence, and Redis registry exist. The gap is purely UI + one new atomic backend endpoint.

---

## Stage 1: Backend — `POST /api/teams/create-with-leader`

**Goal:** One atomic endpoint instead of 3 separate calls. Creates team + leader agent in one request.

### 1.1 — `teams.service.ts` (modify)

**File:** `apps/gamma-core/src/teams/teams.service.ts`

Add `AgentFactoryService` injection + new method:

- Add imports: `BadRequestException` from `@nestjs/common`, `AgentFactoryService` + `AgentInstanceDto` from `../agents/agent-factory.service`
- Add to constructor: `private readonly agentFactory: AgentFactoryService`
- Add method after `createTeam()` (~line 51):

```typescript
async createTeamWithLeader(opts: {
  name: string;
  description?: string;
  leaderRoleId: string;
  leaderName?: string;
}): Promise<{ team: TeamStateRecord; leader: AgentInstanceDto }> {
  const role = this.agentFactory.findRole(opts.leaderRoleId);
  if (!role) throw new BadRequestException(`Unknown role: "${opts.leaderRoleId}"`);

  const leaderName = opts.leaderName?.trim() || role.name;
  const team = this.createTeam(opts.name, opts.description ?? '');

  const leader = await this.agentFactory.createAgent({
    roleId: opts.leaderRoleId,
    name: leaderName,
    teamId: team.id,
  });

  return { team, leader };
}
```

**DI confirmed:** `AgentFactoryService` is exported from `AgentsModule`, which is already imported in `TeamsModule`.

### 1.2 — `teams.controller.ts` (modify)

**File:** `apps/gamma-core/src/teams/teams.controller.ts`

Add endpoint **after** `@Post() createTeam` and **before** `@Get('blueprints')` (route ordering matters — must be above `:id` params):

```typescript
@Post('create-with-leader')
async createTeamWithLeader(
  @Body() body: { name: string; description?: string; leaderRoleId: string; leaderName?: string },
) {
  return this.teamsService.createTeamWithLeader(body);
}
```

### Verification
```bash
curl -X POST http://localhost:3001/api/teams/create-with-leader \
  -H "Content-Type: application/json" \
  -H "X-Gamma-System-Token: $TOKEN" \
  -d '{"name":"Test Team","leaderRoleId":"engineering/engineering-backend-developer"}'
```
Expected: `{ team: { id: "team.XXX", ... }, leader: { agentId: "agent.XXX", ... } }`

---

## Stage 2: UI — CreateTeamModal

### 2.1 — `useRoles.ts` (new file)

**File:** `apps/gamma-ui/hooks/useRoles.ts`

Hook that fetches `GET /api/agents/roles` and groups by category. Module-level cache so roles survive modal close/reopen.

- Returns: `{ roles: RoleEntry[], grouped: RoleGroup[], loading, error }`
- `RoleEntry`: `{ id, fileName, name, description, color, emoji, vibe }`
- `RoleGroup`: `{ category: string, roles: RoleEntry[] }` — category derived from `role.id` prefix before `/`
- Pattern: follow `useTeams.ts` exactly — `mountedRef`, `systemAuthHeaders()`, `API_BASE`

### 2.2 — `RolePicker.tsx` (new file — shared component)

**File:** `apps/gamma-ui/components/SyndicateMap/RolePicker.tsx`

Reusable role browser used by both CreateTeamModal and AddAgentModal.
This is the most complex UI piece — a two-level category browser with search + custom role option.

**Props:**
```typescript
interface RolePickerProps {
  selectedRoleId: string | null;
  onSelect: (roleId: string, roleName: string) => void;
  onCustomRole: (prompt: string) => void;  // when user writes custom description
  customRoleMode: boolean;                  // toggles between picker and textarea
  onToggleCustom: () => void;              // switch between browse/custom modes
}
```

**Two modes:**

#### Mode A: Browse Roles (default)
- **Trigger button** in the parent form — shows selected role or placeholder "Choose a role..."
- Clicking opens a **second popup** (not inline dropdown) layered above the modal:
  - `position: fixed`, centered, `maxWidth: 600`, `maxHeight: 500`, `zIndex: 10000` (above the parent modal's 9999)
  - Header: title "Choose Role" + search input + close button
  - **Left column** (30% width): list of categories as clickable pills/rows
    - Each category shows: name + count badge (e.g. "Engineering (25)")
    - Active category highlighted with `var(--color-accent-primary)` background
    - On click — right column filters to that category
    - "All" option at top to show everything
  - **Right column** (70% width): scrollable list of roles in selected category
    - Each role card: `{emoji}` large (24px) + **name** (bold, 13px) + description (12px, 2-line clamp, `color: var(--color-text-secondary)`)
    - Hover: `background: rgba(59, 130, 246, 0.08)`
    - Click: selects role, closes picker popup, returns to parent modal
  - **Search bar** at top filters across ALL categories (name + description, case-insensitive)
    - When search is active, left column shows only matching categories with match counts
    - Clear button to reset search
  - Escape key closes picker popup (returns to parent modal without selection)
  - Backdrop click closes picker popup

#### Mode B: Custom Role (toggle)
- Below the role trigger button, a small link: "Or describe a custom role..."
- Clicking it replaces the trigger button with:
  - Textarea (4 rows): placeholder "Describe what this agent should do, its expertise, personality..."
  - Small link below: "Or pick from existing roles..." to toggle back to Mode A
- When custom role text is provided, parent form sends it as `customDirectives` to the backend
- **Backend handling**: uses a generic role (e.g. `specialized/specialized-custom-agent`) + `customDirectives` field

**Styles:** Same dark theme. Picker popup follows the same modal pattern (overlay + box) but with slightly darker overlay `rgba(0,0,0,0.35)` to show it's layered above the parent modal.

### 2.3 — `CreateTeamModal.tsx` (new file)

**File:** `apps/gamma-ui/components/SyndicateMap/CreateTeamModal.tsx`

**Props:** `{ onClose: () => void; onCreated: () => void }`

**Form fields:**
1. **Team Name** — text input (required)
2. **Description** — textarea, 3 rows (optional)
3. **Leader Role** — uses `RolePicker` component (required):
   - Shows selected role as a pill: `{emoji} {roleName}` with colored left border
   - Or shows "Choose a role..." placeholder button
   - Supports custom role via toggle
4. **Leader Name** — text input (optional, placeholder = selected role's name)

**Submit:** `POST ${API_BASE}/api/teams/create-with-leader` → on success: `onCreated()` + `onClose()`

**Styles (all inline CSSProperties, follow existing patterns):**
- Overlay: `position: fixed, inset: 0, background: rgba(0,0,0,0.55), zIndex: 9999`
- Modal box: `background: var(--color-surface), border: 1px solid var(--color-border-subtle), borderRadius: 12, maxWidth: 520, boxShadow: var(--shadow-elevated)`
- Inputs: `background: var(--color-bg-primary), border: 1px solid var(--color-border-subtle), borderRadius: 6, fontSize: 13, color: var(--color-text-primary), fontFamily: var(--font-system)`
- Submit button: `background: var(--color-accent-primary), color: #fff, borderRadius: 6, fontSize: 12, fontWeight: 600`
- Cancel button: `background: transparent, color: var(--color-text-secondary), border: 1px solid var(--color-border-subtle)`
- Escape key to close (useEffect pattern)
- Backdrop click closes (onClick overlay + stopPropagation on box)

### 2.3 — `MapToolbar.tsx` (modify)

**File:** `apps/gamma-ui/components/SyndicateMap/MapToolbar.tsx`

- Add `onCreateTeam?: () => void` to `Props` interface
- Add button after layout mode badge, before loading/error indicators:
```tsx
{onCreateTeam && (
  <button className="syndicate-toolbar-btn" style={toolbarBtn} onClick={onCreateTeam} title="Create new team">
    + Team
  </button>
)}
```

### 2.4 — `index.tsx` (modify)

**File:** `apps/gamma-ui/components/SyndicateMap/index.tsx`

- Import `CreateTeamModal`
- Add state: `const [showCreateTeam, setShowCreateTeam] = useState(false)`
- Pass `onCreateTeam={() => setShowCreateTeam(true)}` to `MapToolbar`
- Render modal:
```tsx
{showCreateTeam && (
  <CreateTeamModal
    onClose={() => setShowCreateTeam(false)}
    onCreated={() => void useSyndicateStore.getState().fetchAgents()}
  />
)}
```

### Verification
1. Open Syndicate Map in browser
2. Click "+ Team" in toolbar
3. Fill in name, select a leader role from dropdown, submit
4. Modal closes, new team + leader node appear on the canvas

---

## Stage 3: UI — AddAgentModal

### 3.1 — `AddAgentModal.tsx` (new file)

**File:** `apps/gamma-ui/components/SyndicateMap/AddAgentModal.tsx`

**Props:** `{ teamId: string; teamName: string; onClose: () => void; onCreated: () => void }`

**Form fields:**
1. **Role** — uses shared `RolePicker` component (required). Same two modes: browse categories or write custom description
2. **Agent Name** — text input (optional, default = role name)

**Submit:** `POST ${API_BASE}/api/agents` with `{ roleId, name, teamId, customDirectives? }`
- **Important:** `name` is required by backend DTO (`@IsNotEmpty()`). If user leaves it blank, resolve from `useRoles()` data: `roles.find(r => r.id === selectedRoleId)?.name || 'Agent'`
- If custom role mode: send `customDirectives` with the user's text, use a generic roleId (e.g. `specialized/specialized-custom-agent`)

**Style:** Same modal pattern, `maxWidth: 480`. Title: `"Add Agent to {teamName}"`

### 3.2 — `TeamGroupNode.tsx` (modify)

**File:** `apps/gamma-ui/components/SyndicateMap/TeamGroupNode.tsx`

- Add to `TeamGroupNodeData`: `onAddAgent?: (teamId: string, teamName: string) => void`
- Add "+" button next to 💬 button (adjust positioning: new button at `right: 42`, existing chat stays at `right: 12`):
```tsx
{onAddAgent && (
  <button style={{...chatBtnStyle, right: 42}} onClick={(e) => { e.stopPropagation(); onAddAgent(teamId, teamName); }} title={`Add agent to ${teamName}`}>
    ➕
  </button>
)}
```
- Update `arePropsEqual` to include `p.onAddAgent === n.onAddAgent`

### 3.3 — `index.tsx` (modify — additional changes)

**File:** `apps/gamma-ui/components/SyndicateMap/index.tsx`

- Import `AddAgentModal`
- Add state: `const [addAgentTarget, setAddAgentTarget] = useState<{ teamId: string; teamName: string } | null>(null)`
- Add callback: `const handleAddAgent = useCallback((teamId, teamName) => setAddAgentTarget({ teamId, teamName }), [])`
- In the `useEffect` that syncs graph → React Flow (two places — topology-change and data-only branches): inject `onAddAgent: handleAddAgent` alongside existing `onOpenChat: handleOpenTeamChat` into teamGroup nodes
- Add `handleAddAgent` to the useEffect dependency array
- Render modal:
```tsx
{addAgentTarget && (
  <AddAgentModal
    teamId={addAgentTarget.teamId}
    teamName={addAgentTarget.teamName}
    onClose={() => setAddAgentTarget(null)}
    onCreated={() => void useSyndicateStore.getState().fetchAgents()}
  />
)}
```

### Verification
1. Have an existing team on the map
2. Click ➕ on the team group node
3. Select a role, submit
4. Modal closes, new agent appears inside the team group

---

## Stage 4: Polish

1. **Empty state text** — Update `index.tsx` empty state (~line 437) from "Create agents via the Agent Genesis API" to "Click **+ Team** in the toolbar to create your first team"
2. **Mutual exclusion** — When opening CreateTeamModal, close team chat and agent detail panel. When opening AddAgentModal, close others.
3. **Submit button states** — `"Creating…"` text + `disabled` during submission (already described in each modal)

---

## Files Summary

| File | Action | Stage |
|------|--------|-------|
| `apps/gamma-core/src/teams/teams.service.ts` | Modify (add method + DI) | 1 |
| `apps/gamma-core/src/teams/teams.controller.ts` | Modify (add endpoint) | 1 |
| `apps/gamma-ui/hooks/useRoles.ts` | **New** | 2 |
| `apps/gamma-ui/components/SyndicateMap/RolePicker.tsx` | **New** (shared) | 2 |
| `apps/gamma-ui/components/SyndicateMap/CreateTeamModal.tsx` | **New** | 2 |
| `apps/gamma-ui/components/SyndicateMap/MapToolbar.tsx` | Modify (add prop + button) | 2 |
| `apps/gamma-ui/components/SyndicateMap/index.tsx` | Modify (modal state + wiring) | 2, 3, 4 |
| `apps/gamma-ui/components/SyndicateMap/AddAgentModal.tsx` | **New** | 3 |
| `apps/gamma-ui/components/SyndicateMap/TeamGroupNode.tsx` | Modify (add prop + button) | 3 |

## Key Reuse Points

- `systemAuthHeaders()` from `apps/gamma-ui/lib/auth.ts`
- `API_BASE` from `apps/gamma-ui/constants/api.ts`
- `useSyndicateStore.getState().fetchAgents()` from `apps/gamma-ui/store/syndicate.store.ts`
- `AgentFactoryService.findRole()` and `.createAgent()` from `apps/gamma-core/src/agents/agent-factory.service.ts`
- CSS variables from `apps/gamma-ui/styles/os-theme.css`
- Modal pattern from `apps/gamma-ui/components/ui/ConfirmModal.tsx`
- Form/input pattern from `apps/gamma-ui/components/CeoDashboard/GoalInput.tsx`
- Hook pattern from `apps/gamma-ui/hooks/useTeams.ts`

## End-to-End Verification

1. `pnpm build:types && pnpm dev:core` — backend starts without errors
2. `pnpm dev` — frontend starts
3. Open Syndicate Map → click "+ Team" → fill form → submit → team + leader appear on map
4. Click ➕ on the team node → select role → submit → new agent appears in team
5. Verify Redis: `redis-cli HGETALL gamma:sessions:registry` shows new agent sessions
6. Verify SQLite: `SELECT * FROM teams; SELECT * FROM agents WHERE team_id IS NOT NULL;`
