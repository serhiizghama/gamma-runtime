import type { ITool } from '@gamma/types';

/**
 * Multi-provider injection token for internal tool executors.
 * Each internal tool handler registers itself under this token
 * so the ToolRegistryService can collect them at init time.
 */
export const TOOL_EXECUTORS = Symbol('TOOL_EXECUTORS');

/**
 * External tool definitions — tools proxied to the OpenClaw Gateway.
 *
 * Each entry declares the tool's contract (name, schema, allowed roles)
 * but has NO local executor — the ToolExecutorService (PR 3) will
 * forward invocations to OpenClaw POST /tools/invoke.
 */
export const EXTERNAL_TOOL_DEFINITIONS: ITool[] = [
  // ── Filesystem ──────────────────────────────────────────────────────
  {
    name: 'fs_read',
    description: 'Read the contents of a file within the app bundle.',
    type: 'external',
    category: 'filesystem',
    allowedRoles: ['architect', 'app-owner'],
    schema: {
      parameters: {
        path: {
          type: 'string',
          description: 'Relative path to the file inside the bundle.',
          required: true,
        },
      },
      outputDescription: 'File contents as a UTF-8 string.',
    },
  },
  {
    name: 'fs_write',
    description: 'Write content to a file within the app bundle.',
    type: 'external',
    category: 'filesystem',
    allowedRoles: ['architect', 'app-owner'],
    schema: {
      parameters: {
        path: {
          type: 'string',
          description: 'Relative path to the target file.',
          required: true,
        },
        content: {
          type: 'string',
          description: 'Content to write.',
          required: true,
        },
      },
    },
  },
  {
    name: 'fs_list',
    description: 'List files and directories within the app bundle.',
    type: 'external',
    category: 'filesystem',
    allowedRoles: ['architect', 'app-owner'],
    schema: {
      parameters: {
        path: {
          type: 'string',
          description: 'Relative directory path. Defaults to bundle root.',
          default: '.',
        },
      },
      outputDescription: 'Array of file/directory entries with name and type.',
    },
  },

  // ── Shell ───────────────────────────────────────────────────────────
  {
    name: 'shell_exec',
    description: 'Execute a shell command in a sandboxed environment.',
    type: 'external',
    category: 'shell',
    allowedRoles: ['architect', 'app-owner'],
    schema: {
      parameters: {
        command: {
          type: 'string',
          description: 'Shell command to execute.',
          required: true,
        },
        cwd: {
          type: 'string',
          description: 'Working directory (relative to bundle root).',
        },
        timeout: {
          type: 'number',
          description: 'Max execution time in milliseconds.',
          default: 30000,
        },
      },
      outputDescription: 'Object with stdout, stderr, and exitCode.',
    },
  },

  // ── Scaffold ────────────────────────────────────────────────────────
  {
    name: 'scaffold',
    description: 'Create a new app bundle from source code.',
    type: 'external',
    category: 'scaffold',
    allowedRoles: ['architect'],
    schema: {
      parameters: {
        appId: {
          type: 'string',
          description: 'Unique application identifier.',
          required: true,
        },
        displayName: {
          type: 'string',
          description: 'Human-readable app name.',
          required: true,
        },
        sourceCode: {
          type: 'string',
          description: 'React component source code.',
          required: true,
        },
      },
    },
  },
  {
    name: 'unscaffold',
    description: 'Remove an existing app bundle.',
    type: 'external',
    category: 'scaffold',
    allowedRoles: ['architect'],
    schema: {
      parameters: {
        appId: {
          type: 'string',
          description: 'ID of the app to remove.',
          required: true,
        },
      },
    },
  },

  // ── System ──────────────────────────────────────────────────────────
  {
    name: 'system_health',
    description: 'Get current system health report (CPU, RAM, Redis, Gateway).',
    type: 'external',
    category: 'system',
    allowedRoles: ['architect'],
    schema: {
      parameters: {},
      outputDescription: 'SystemHealthReport object.',
    },
  },
  {
    name: 'list_apps',
    description: 'List all registered applications in the runtime.',
    type: 'external',
    category: 'system',
    allowedRoles: ['architect'],
    schema: {
      parameters: {},
      outputDescription: 'Array of AppRegistryEntry objects.',
    },
  },
  {
    name: 'read_file',
    description: 'Read any file on the system (architect-only, unrestricted).',
    type: 'external',
    category: 'filesystem',
    allowedRoles: ['architect'],
    schema: {
      parameters: {
        path: {
          type: 'string',
          description: 'Absolute or repo-relative file path.',
          required: true,
        },
      },
      outputDescription: 'File contents as a UTF-8 string.',
    },
  },

  // ── App Owner specific ──────────────────────────────────────────────
  {
    name: 'update_app',
    description: 'Update an existing app bundle (PATCH semantics).',
    type: 'external',
    category: 'scaffold',
    allowedRoles: ['app-owner'],
    schema: {
      parameters: {
        sourceCode: {
          type: 'string',
          description: 'Updated React component source code.',
        },
        contextDoc: {
          type: 'string',
          description: 'Updated context document.',
        },
      },
    },
  },
  {
    name: 'read_context',
    description: 'Read the context.md document for the current app.',
    type: 'external',
    category: 'context',
    allowedRoles: ['app-owner'],
    schema: {
      parameters: {},
      outputDescription: 'Context document contents as a string.',
    },
  },
  {
    name: 'list_assets',
    description: 'List assets in the current app bundle.',
    type: 'external',
    category: 'assets',
    allowedRoles: ['app-owner'],
    schema: {
      parameters: {},
      outputDescription: 'Array of asset file paths.',
    },
  },
  {
    name: 'add_asset',
    description: 'Upload an asset file to the current app bundle.',
    type: 'external',
    category: 'assets',
    allowedRoles: ['app-owner'],
    schema: {
      parameters: {
        path: {
          type: 'string',
          description: 'Target path within the assets directory.',
          required: true,
        },
        content: {
          type: 'string',
          description: 'Base64-encoded file content.',
          required: true,
        },
        encoding: {
          type: 'string',
          description: 'Content encoding.',
          enum: ['base64', 'utf8'],
          default: 'base64',
        },
      },
    },
  },

  // ── Memory ─────────────────────────────────────────────────────────
  {
    name: 'vector_store',
    description:
      'Omnichannel Knowledge Hub. Store and retrieve long-term semantic memory ' +
      '(vectors + FTS5 keyword match). Use "upsert" to save important architectural ' +
      'decisions, facts, or context for the future. Use "search" to retrieve past ' +
      'context when your short-term memory is insufficient.',
    type: 'external',
    category: 'memory',
    allowedRoles: ['architect', 'app-owner', 'daemon'],
    schema: {
      parameters: {
        action: {
          type: 'string',
          description: 'The operation to perform on the knowledge store.',
          enum: ['upsert', 'search', 'delete'],
          required: true,
        },
        payload: {
          type: 'object',
          description: 'Action-specific arguments.',
          required: true,
          properties: {
            id: {
              type: 'string',
              description:
                'Chunk ID. Required for delete. Optional for upsert (auto-generated if omitted).',
            },
            namespace: {
              type: 'string',
              description: 'Logical partition key. Defaults to "default".',
              default: 'default',
            },
            content: {
              type: 'string',
              description: 'The text to embed and store. Required for upsert.',
            },
            metadata: {
              type: 'object',
              description: 'Arbitrary JSON metadata attached to the chunk.',
            },
            query: {
              type: 'string',
              description: 'Natural-language search query. Required for search.',
            },
            limit: {
              type: 'number',
              description: 'Max results to return (1–100). Defaults to 10.',
              default: 10,
            },
            mode: {
              type: 'string',
              description: 'Search strategy: hybrid (vector + FTS5), vector-only, or FTS-only.',
              enum: ['hybrid', 'vector', 'fts'],
              default: 'hybrid',
            },
            shared: {
              type: 'boolean',
              description:
                'If true, search across all agents\' knowledge (omnichannel). ' +
                'If false (default), restrict to the calling agent\'s entries.',
              default: false,
            },
          },
        },
      },
      outputDescription:
        'Upsert: { id, status }. Search: { results: [{ id, namespace, content, metadata, score }] }. Delete: { status }.',
    },
  },
];
