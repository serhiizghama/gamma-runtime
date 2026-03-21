/**
 * agent-creator.service.ts — IPC-delegated workspace generator
 *
 * Instead of calling the Anthropic API directly, delegates workspace generation
 * to the system-architect agent via its chat session. This keeps gamma-core
 * free of direct LLM coupling — all LLM interactions go through OpenClaw agents.
 *
 * Flow:
 *   1. createAgent → delegateWorkspaceGeneration() → message to system-architect
 *   2. system-architect generates files via its own LLM + tools (fs_write)
 *   3. Agent record transitions from 'configuring' → 'active' once workspace is ready
 */

import { Injectable, Logger } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentWorkspaceFiles {
  'SOUL.md': string;
  'IDENTITY.md': string;
  'TOOLS.md': string;
  'USER.md': string;
  'BOOTSTRAP.md': string;
  'HEARTBEAT.md': string;
  'AGENTS.md': string;
}

/** All keys that must be present in the workspace */
export const REQUIRED_WORKSPACE_FILES: (keyof AgentWorkspaceFiles)[] = [
  'SOUL.md',
  'IDENTITY.md',
  'TOOLS.md',
  'USER.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'AGENTS.md',
];

export interface DelegateGenesisParams {
  roleMarkdown: string;
  agentName: string;
  agentId: string;
  workspacePath: string;
  customDirectives?: string;
}

export interface GenesisTaskResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AgentCreatorService {
  private readonly logger = new Logger(AgentCreatorService.name);

  /** Window ID of the system architect session. */
  private readonly architectWindowId = 'system-architect-window';

  constructor(private readonly sessions: SessionsService) {}

  /**
   * Delegate workspace generation to the system-architect agent.
   *
   * Sends a structured message to the architect's chat session. The architect
   * uses its own LLM + tools (fs_write) to generate and write workspace files.
   *
   * This is fire-and-forget from the caller's perspective — the agent record
   * is created immediately with status 'configuring', and workspace files
   * are written by the architect asynchronously.
   */
  async delegateWorkspaceGeneration(
    params: DelegateGenesisParams,
  ): Promise<GenesisTaskResult> {
    const { roleMarkdown, agentName, agentId, workspacePath, customDirectives } = params;

    const taskDescription = this.buildTaskDescription(
      roleMarkdown,
      agentName,
      agentId,
      workspacePath,
      customDirectives,
    );

    this.logger.log(
      `Delegating workspace generation for "${agentName}" (${agentId}) to system-architect`,
    );

    // Send the genesis task as a structured message to the architect's chat
    // session. This wakes the architect if idle and triggers LLM processing.
    const result = await this.sessions.sendMessage(
      this.architectWindowId,
      taskDescription,
    );

    if (!result || !result.ok) {
      const errMsg = result?.error?.message ?? 'unknown error';
      this.logger.error(`Failed to send genesis task for ${agentId}: ${errMsg}`);
      return { ok: false, error: errMsg };
    }

    this.logger.log(
      `Genesis task sent to system-architect for "${agentName}" (${agentId})`,
    );

    return { ok: true };
  }

  // ── Task description builder ──────────────────────────────────────

  private buildTaskDescription(
    roleMarkdown: string,
    agentName: string,
    agentId: string,
    workspacePath: string,
    customDirectives?: string,
  ): string {
    const parts = [
      '# Agent Genesis Task',
      '',
      'Generate the workspace files for a new Gamma agent.',
      '',
      '## Agent Configuration',
      `- **Agent Name:** ${agentName}`,
      `- **Agent ID:** ${agentId}`,
      `- **Workspace Path:** ${workspacePath}`,
      '',
      '## Required Files',
      'Generate each of these Markdown files and write them to the workspace path using `fs_write`:',
      '- `SOUL.md` — Core persona & behaviour',
      '- `IDENTITY.md` — Backstory, traits, cognitive style',
      '- `TOOLS.md` — Tool contract (MUST include vector_store section)',
      '- `USER.md` — Guidelines for the human user',
      '- `BOOTSTRAP.md` — Steps on first activation',
      '- `HEARTBEAT.md` — Idle/periodic check behaviour',
      '- `AGENTS.md` — Awareness of other agents in the Gamma ecosystem',
      '',
      '## Role Template',
      '```markdown',
      roleMarkdown,
      '```',
    ];

    if (customDirectives) {
      parts.push('', '## Custom User Directives', customDirectives);
    }

    parts.push(
      '',
      '## Rules',
      '- Maintain the role\'s personality, vibe, and domain expertise.',
      '- Each file must be valid Markdown.',
      '- TOOLS.md MUST include a `## vector_store` section.',
      '- IDENTITY.md should give the agent a unique personality, not a generic bio.',
      '- Write each file to `<workspacePath>/<filename>` using the fs_write tool.',
      '- After writing all 7 files, confirm completion.',
      '- Also create an empty `memory/` subdirectory inside the workspace path.',
    );

    return parts.join('\n');
  }
}
