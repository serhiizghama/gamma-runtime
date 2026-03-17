/**
 * agent-creator.service.ts — LLM-powered workspace generator
 *
 * Given a community role template + user directives, calls the Anthropic API
 * in JSON mode to synthesize the full OpenClaw agent workspace files:
 *   SOUL.md, IDENTITY.md, TOOLS.md, USER.md, BOOTSTRAP.md, HEARTBEAT.md, AGENTS.md
 *
 * This is a pure "brain" service — it does not touch the filesystem or database.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

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

/** All keys that must be present in the LLM response */
const REQUIRED_KEYS: (keyof AgentWorkspaceFiles)[] = [
  'SOUL.md',
  'IDENTITY.md',
  'TOOLS.md',
  'USER.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'AGENTS.md',
];

export interface GenerateWorkspaceParams {
  roleMarkdown: string;
  agentName: string;
  agentId: string;
  customDirectives?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AgentCreatorService {
  private readonly logger = new Logger(AgentCreatorService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  /** Max time (ms) to wait for the LLM to generate a workspace. */
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY', '');
    if (!apiKey) {
      this.logger.error('ANTHROPIC_API_KEY is not set — agent creation will fail');
    }
    this.client = new Anthropic({
      apiKey,
      timeout: 120_000, // 120s connection-level timeout
    });
    this.model = this.config.get<string>('AGENT_CREATOR_MODEL', 'claude-sonnet-4-20250514');
    this.timeoutMs = this.config.get<number>('AGENT_CREATOR_TIMEOUT_MS', 120_000);
  }

  /**
   * Call the LLM to generate workspace files from a role template.
   * Uses Anthropic's tool-use pattern for structured JSON output.
   */
  async generateWorkspace(params: GenerateWorkspaceParams): Promise<AgentWorkspaceFiles> {
    const { roleMarkdown, agentName, agentId, customDirectives } = params;

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(roleMarkdown, agentName, agentId, customDirectives);

    this.logger.log(`Generating workspace for agent "${agentName}" (${agentId}) via ${this.model}`);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 8192,
          system: systemPrompt,
          tools: [
            {
              name: 'emit_workspace',
              description: 'Emit the generated agent workspace files as structured JSON.',
              input_schema: {
                type: 'object' as const,
                properties: {
                  'SOUL.md': { type: 'string', description: 'Core persona & behaviour — the agent\'s soul.' },
                  'IDENTITY.md': { type: 'string', description: 'Backstory, traits, cognitive style.' },
                  'TOOLS.md': { type: 'string', description: 'Tool contract — MUST include vector_store.' },
                  'USER.md': { type: 'string', description: 'Guidelines for the human user interacting with this agent.' },
                  'BOOTSTRAP.md': { type: 'string', description: 'Steps the agent should execute on first activation.' },
                  'HEARTBEAT.md': { type: 'string', description: 'Idle / periodic check behaviour.' },
                  'AGENTS.md': { type: 'string', description: 'Awareness of other agents in the Gamma ecosystem.' },
                },
                required: REQUIRED_KEYS,
              },
            },
          ],
          tool_choice: { type: 'tool', name: 'emit_workspace' },
          messages: [{ role: 'user', content: userPrompt }],
        },
        { signal: abort.signal },
      );
    } finally {
      clearTimeout(timer);
    }

    // Extract the tool call result
    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('LLM did not return a tool_use block — generation failed');
    }

    const raw = toolBlock.input as Record<string, unknown>;
    return this.validateAndNormalize(raw);
  }

  // ── Prompt builders ────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return [
      'You are the **Gamma Agent Creator** — an expert AI systems architect.',
      'Your task is to synthesize a complete set of agent workspace files from a community role template.',
      '',
      'Rules:',
      '- Maintain the original role\'s **vibe**, personality, and domain expertise.',
      '- Each file must be valid Markdown.',
      '- TOOLS.md MUST include a `## vector_store` section describing the agent\'s ability to store and retrieve knowledge.',
      '- TOOLS.md should also list other relevant Gamma tools: `fs_read`, `fs_write`, `shell_exec`, `send_direct_message` — include only tools that make sense for this role.',
      '- IDENTITY.md should give the agent a unique personality grounded in the role, not a generic bio.',
      '- BOOTSTRAP.md should describe what the agent does on first activation (e.g., load prior knowledge, establish goals).',
      '- HEARTBEAT.md should describe idle/periodic behaviour suited to the role.',
      '- AGENTS.md should describe awareness of other agents in a multi-agent ecosystem.',
      '- USER.md should guide the human on how to interact effectively with this agent.',
      '',
      'Output ONLY via the emit_workspace tool. Do not include preamble or commentary.',
    ].join('\n');
  }

  private buildUserPrompt(
    roleMarkdown: string,
    agentName: string,
    agentId: string,
    customDirectives?: string,
  ): string {
    const parts = [
      `## Agent Configuration`,
      `- **Agent Name:** ${agentName}`,
      `- **Agent ID:** ${agentId}`,
      '',
      `## Role Template`,
      '```markdown',
      roleMarkdown,
      '```',
    ];

    if (customDirectives) {
      parts.push('', '## Custom User Directives', customDirectives);
    }

    parts.push(
      '',
      '## Task',
      'Generate the 7 workspace files for this agent. Use the emit_workspace tool to return them.',
    );

    return parts.join('\n');
  }

  // ── Validation ─────────────────────────────────────────────────────

  private validateAndNormalize(raw: Record<string, unknown>): AgentWorkspaceFiles {
    const result: Record<string, string> = {};

    for (const key of REQUIRED_KEYS) {
      const value = raw[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`LLM output missing or empty for required file: ${key}`);
      }
      result[key] = value;
    }

    // Enforce vector_store presence in TOOLS.md
    const toolsMd = result['TOOLS.md'];
    if (!toolsMd.toLowerCase().includes('vector_store')) {
      this.logger.warn('TOOLS.md missing vector_store — appending minimal section');
      result['TOOLS.md'] +=
        '\n\n## vector_store\n\nPersistent knowledge storage. Use to store and retrieve information across sessions.\n' +
        '- `upsert` — Store a knowledge chunk with metadata.\n' +
        '- `search` — Semantic search across stored knowledge.\n';
    }

    return result as unknown as AgentWorkspaceFiles;
  }
}
