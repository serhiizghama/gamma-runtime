/**
 * agent-factory.service.ts — Generative Agent Lifecycle Manager
 *
 * Orchestrates the full agent creation pipeline:
 *   1. Validate role from manifest
 *   2. Create base workspace directory (~/.openclaw/agents/<agentId>/)
 *   3. Persist agent metadata in gamma-state.db (status: 'configuring')
 *   4. Register agent in the Redis agent registry
 *   5. Delegate workspace file generation to system-architect via IPC
 *
 * The system-architect generates SOUL.md, IDENTITY.md, etc. asynchronously
 * using its own LLM + tools. gamma-core never calls LLMs directly.
 *
 * Also handles soft-delete (archive) with session teardown.
 *
 * Identity contract ("OpenClaw Passport"):
 *   agentId === sessionKey === gamma-knowledge._agentId
 *   This single identifier is the agent's passport and must never change.
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { AgentCreatorService } from './agent-creator.service';
import { AgentStateRepository, type AgentStateRecord } from '../state/agent-state.repository';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import { SessionsService } from '../sessions/sessions.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoleManifestEntry {
  id: string;
  fileName: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  vibe: string;
}

export interface AgentInstanceDto {
  agentId: string;
  name: string;
  roleId: string;
  avatarEmoji: string;
  uiColor: string;
  workspacePath: string;
  status: string;
  createdAt: number;
}

export interface CreateAgentOptions {
  roleId: string;
  name: string;
  customDirectives?: string;
  teamId?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AgentFactoryService {
  private readonly logger = new Logger(AgentFactoryService.name);
  private manifest: RoleManifestEntry[] = [];
  private readonly rolesRoot: string;
  private readonly agentsRoot: string;
  private readonly manifestPath: string;

  constructor(
    private readonly config: ConfigService,
    private readonly creator: AgentCreatorService,
    private readonly agentStateRepo: AgentStateRepository,
    private readonly agentRegistry: AgentRegistryService,
    private readonly sessions: SessionsService,
  ) {
    // Resolve paths from env or sensible defaults
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    this.rolesRoot = this.config.get<string>(
      'COMMUNITY_ROLES_ROOT',
      resolve(repoRoot, 'community-roles'),
    );
    this.agentsRoot = this.config.get<string>(
      'AGENTS_WORKSPACE_ROOT',
      resolve(homedir(), '.openclaw', 'agents'),
    );
    this.manifestPath = this.config.get<string>(
      'ROLES_MANIFEST_PATH',
      resolve(repoRoot, 'data', 'roles-manifest.json'),
    );

    this.loadManifest();
  }

  // ── Manifest ───────────────────────────────────────────────────────

  /** Load roles-manifest.json from disk. Called on init and exposed for reload. */
  loadManifest(): void {
    if (!existsSync(this.manifestPath)) {
      this.logger.warn(`Roles manifest not found at ${this.manifestPath} — run sync-roles.ts first`);
      this.manifest = [];
      return;
    }

    try {
      const raw = readFileSync(this.manifestPath, 'utf-8');
      this.manifest = JSON.parse(raw) as RoleManifestEntry[];
      this.logger.log(`Loaded ${this.manifest.length} role(s) from manifest`);
    } catch (err) {
      this.logger.error(`Failed to parse roles manifest: ${err}`);
      this.manifest = [];
    }
  }

  /** Return all available roles for the UI. */
  getRoles(): RoleManifestEntry[] {
    return this.manifest;
  }

  /** Look up a role by id, e.g. "dev/senior-developer". */
  findRole(roleId: string): RoleManifestEntry | undefined {
    return this.manifest.find((r) => r.id === roleId);
  }

  // ── Agent Creation ─────────────────────────────────────────────────

  async createAgent(opts: CreateAgentOptions): Promise<AgentInstanceDto> {
    const { roleId, name, customDirectives, teamId } = opts;

    // 1. Validate role exists in manifest
    const role = this.findRole(roleId);
    if (!role) {
      throw new BadRequestException(`Unknown role: "${roleId}". Run sync-roles.ts to update the manifest.`);
    }

    // 2. Read the source role markdown (with path-traversal guard)
    const roleFilePath = resolve(this.rolesRoot, role.fileName);
    if (!roleFilePath.startsWith(this.rolesRoot + '/')) {
      throw new BadRequestException(`Role path escapes roles root — rejecting "${role.fileName}"`);
    }
    if (!existsSync(roleFilePath)) {
      throw new BadRequestException(`Role file not found on disk: ${role.fileName}`);
    }
    const roleMarkdown = readFileSync(roleFilePath, 'utf-8');

    // 3. Generate agentId (OpenClaw passport — never changes)
    const agentId = `agent.${ulid()}`;
    const workspacePath = resolve(this.agentsRoot, agentId);

    this.logger.log(`Creating agent "${name}" (${agentId}) from role "${roleId}"`);

    // 4. Create base workspace directory structure
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(join(workspacePath, 'memory'), { recursive: true });

    const now = Date.now();

    // 5. Persist in gamma-state.db with status 'configuring'
    const record: AgentStateRecord = {
      id: agentId,
      name,
      roleId,
      avatarEmoji: role.emoji,
      uiColor: role.color,
      status: 'configuring',
      workspacePath,
      teamId: teamId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.agentStateRepo.upsert(record);

    // 6. Register in Redis agent registry
    await this.agentRegistry.register({
      agentId,
      role: 'daemon',
      sessionKey: agentId,
      windowId: '',
      appId: '',
      status: 'idle',
      capabilities: [],
      lastHeartbeat: now,
      lastActivity: 'configuring — workspace generation delegated',
      acceptsMessages: false,
      createdAt: now,
      supervisorId: null,
    });

    // 7. Delegate workspace generation to system-architect (fire-and-forget)
    this.creator.delegateWorkspaceGeneration({
      roleMarkdown,
      agentName: name,
      agentId,
      workspacePath,
      customDirectives,
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Genesis delegation failed for ${agentId}: ${message}`);
      // Mark as failed in DB so UI can show the error
      this.agentStateRepo.upsert({
        ...record,
        status: 'failed',
        updatedAt: Date.now(),
      });
    });

    this.logger.log(`Agent "${name}" (${agentId}) created — workspace generation delegated to architect`);

    return {
      agentId,
      name,
      roleId,
      avatarEmoji: role.emoji,
      uiColor: role.color,
      workspacePath,
      status: 'configuring',
      createdAt: now,
    };
  }

  // ── Agent Deletion (soft) ──────────────────────────────────────────

  async deleteAgent(agentId: string): Promise<{ ok: boolean; reason?: string }> {
    // Validate agentId format to prevent injection via route param
    if (!/^agent\.[A-Z0-9]{26}$/.test(agentId)) {
      throw new BadRequestException(`Invalid agentId format: "${agentId}"`);
    }

    const record = this.agentStateRepo.findById(agentId);
    if (!record) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }

    if (record.status === 'archived') {
      return { ok: true, reason: 'already archived' };
    }

    this.logger.log(`Archiving agent "${record.name}" (${agentId})`);

    // 1. If the agent has an active session/window, abort it
    const registryEntry = await this.agentRegistry.getOne(agentId);
    if (registryEntry?.windowId) {
      try {
        await this.sessions.abort(registryEntry.windowId);
        this.logger.log(`Aborted session for agent ${agentId} (window: ${registryEntry.windowId})`);
      } catch (err) {
        this.logger.warn(`Failed to abort session for ${agentId}: ${err}`);
      }
    }

    // 2. Mark archived in gamma-state.db (knowledge chunks are preserved)
    this.agentStateRepo.markArchived(agentId);

    // 3. Update registry to offline
    await this.agentRegistry.update(agentId, {
      status: 'offline',
      acceptsMessages: false,
    });

    this.logger.log(`Agent ${agentId} archived`);
    return { ok: true };
  }

  // ── List agents from state DB ──────────────────────────────────────

  findAllAgents(): AgentStateRecord[] {
    return this.agentStateRepo.findAll();
  }

  findAgent(id: string): AgentStateRecord | null {
    return this.agentStateRepo.findById(id);
  }

  /** Update an agent's team assignment. Pass null to unassign. */
  updateTeamId(agentId: string, teamId: string | null): void {
    const record = this.agentStateRepo.findById(agentId);
    if (!record) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    this.agentStateRepo.upsert({
      ...record,
      teamId,
      updatedAt: Date.now(),
    });
  }
}
