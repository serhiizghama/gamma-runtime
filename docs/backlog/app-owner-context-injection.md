## Backlog — OpenClaw System Prompt Ingestion for App Owners

**Status**: RESOLVED (2026-03-15)
**Owner**: Gamma OS Architect / Backend
**Area**: Kernel `SessionsService` ↔ OpenClaw Gateway protocol

### Resolution

Fixed via **dual-path injection** in `GatewayWsService`:

1. `sessions.create` still passes `systemPrompt` (for Gateways that support it).
2. Every `chat.send` now includes a `system` field with the persisted prompt from `gamma:session-context:{sessionKey}`.

This ensures agents always receive their persona/context regardless of whether the Gateway honors `systemPrompt` on `sessions.create`.

### Changes Made

- `GatewayWsService.sendMessage()`: Retrieves stored system prompt from Redis, passes as `system` field on `chat.send`.
- `GatewayWsService.createSession()`: Now also passes `allowedTools` for role-based scoping.
- `SessionsService.initializeSystemArchitectSession()`: New method — persists System Architect persona to Redis for dual-path injection.
- Removed TODO markers from `sessions.service.ts` and `WindowNode.tsx`.

### Tool Scoping (also resolved)

Role-based `allowedTools` arrays defined in `gateway-ws.service.ts`:
- **App Owner**: `shell_exec`, `fs_read`, `fs_write`, `fs_list`, `update_app`, `read_context`, `list_assets`, `add_asset`
- **System Architect**: `shell_exec`, `fs_read`, `fs_write`, `fs_list`, `scaffold`, `unscaffold`, `system_health`, `list_apps`, `read_file`
