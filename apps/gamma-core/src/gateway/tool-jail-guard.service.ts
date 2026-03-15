import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { AppStorageService } from '../scaffold/app-storage.service';

/** Tool names that carry a file path argument. */
const FS_TOOLS = ['fs_read', 'fs_write', 'fs_list'] as const;

/** Dangerous shell patterns that could escape the jail. */
const SHELL_ESCAPE_PATTERNS = [
  /\.\.\//,                    // relative traversal
  /\/etc\//,                   // system config
  /\/proc\//,                  // proc filesystem
  /\/var\//,                   // system data
  /~\//,                       // home directory expansion
  /\$HOME/,                    // env-based home
  /\$\(/,                      // command substitution
  /`[^`]+`/,                   // backtick command substitution
  /\|\s*(bash|sh|zsh|curl)/,   // pipe to shell / network
  />\s*\//,                    // redirect to absolute path
  /;\s*(cd|rm|mv|cp)\s/,       // chained destructive commands outside jail
] as const;

export interface JailViolation {
  tool: string;
  sessionKey: string;
  argument: string;
  reason: string;
}

/**
 * Tool Jail Guard — Hard-coded path validation for filesystem tools (§9.5 hardening).
 *
 * Intercepts tool call arguments BEFORE execution and validates that
 * App Owner agents cannot escape their jailed directory. System Architect
 * sessions are exempt (full access).
 *
 * Defence-in-depth: even if prompt-based scoping is bypassed, this guard
 * blocks any path that resolves outside the app's bundle directory.
 */
@Injectable()
export class ToolJailGuardService {
  private readonly logger = new Logger(ToolJailGuardService.name);

  constructor(private readonly appStorage: AppStorageService) {}

  /**
   * Validate a tool call's arguments against the jail for a given session.
   *
   * @returns null if the call is allowed, or a JailViolation if blocked.
   */
  validate(
    sessionKey: string,
    toolName: string,
    args: Record<string, unknown> | null,
  ): JailViolation | null {
    // System Architect is exempt — full system access
    if (sessionKey === 'system-architect') return null;

    // ── App Inspector: read-only cross-app access (Phase 4.2) ─────────
    // Must be checked before the generic app-owner- prefix match below.
    if (sessionKey === 'inspector') {
      return this.validateInspectorAccess(toolName, args);
    }

    // Only enforce on app-owner sessions
    if (!sessionKey.startsWith('app-owner-')) return null;

    const appId = sessionKey.replace('app-owner-', '');

    // ── Filesystem tools: validate the path argument ───────────────────
    if ((FS_TOOLS as readonly string[]).includes(toolName)) {
      return this.validateFsToolPath(appId, toolName, args);
    }

    // ── shell_exec: scan the command for escape patterns ──────────────
    if (toolName === 'shell_exec') {
      return this.validateShellCommand(appId, toolName, args);
    }

    return null;
  }

  // ── Filesystem tool validation ──────────────────────────────────────

  private validateFsToolPath(
    appId: string,
    toolName: string,
    args: Record<string, unknown> | null,
  ): JailViolation | null {
    const targetPath = (args?.path ?? args?.file ?? args?.directory) as
      | string
      | undefined;

    if (!targetPath) return null; // no path arg — nothing to validate

    // Reject absolute paths immediately
    if (path.isAbsolute(targetPath)) {
      return this.violation(
        toolName,
        `app-owner-${appId}`,
        targetPath,
        `Absolute path forbidden for App Owner`,
      );
    }

    // Normalize and check for traversal segments
    const normalized = path.normalize(targetPath);
    if (normalized.startsWith('..') || normalized.includes(`${path.sep}..`)) {
      return this.violation(
        toolName,
        `app-owner-${appId}`,
        targetPath,
        `Path traversal detected: resolves outside app bundle`,
      );
    }

    // Resolve against jail root and verify containment
    const jailRoot = this.appStorage.getJailRoot();
    const appRoot = path.resolve(jailRoot, appId);
    const resolved = path.resolve(appRoot, normalized);

    if (resolved !== appRoot && !resolved.startsWith(appRoot + path.sep)) {
      return this.violation(
        toolName,
        `app-owner-${appId}`,
        targetPath,
        `Resolved path '${resolved}' escapes app jail '${appRoot}'`,
      );
    }

    // Block access to hidden files/directories (.git, .env, etc.)
    if (normalized.split(path.sep).some((seg) => seg.startsWith('.'))) {
      return this.violation(
        toolName,
        `app-owner-${appId}`,
        targetPath,
        `Hidden files/directories are forbidden`,
      );
    }

    return null;
  }

  // ── App Inspector validation (Phase 4.2) ───────────────────────────
  // Read-only cross-app access: fs_read and fs_list anywhere under the
  // jail root, but all write/exec tools are blocked (defense in depth).

  private validateInspectorAccess(
    toolName: string,
    args: Record<string, unknown> | null,
  ): JailViolation | null {
    // Block any write or exec tool — Inspector is strictly read-only
    if (toolName === 'fs_write' || toolName === 'shell_exec') {
      return this.violation(
        toolName,
        'inspector',
        JSON.stringify(args ?? {}),
        `App Inspector is read-only — ${toolName} is forbidden`,
      );
    }

    // Allow fs_read / fs_list with standard path safety checks (no traversal,
    // no absolute paths, no hidden files) but scoped to the entire jail root
    // rather than a single app bundle.
    if (toolName === 'fs_read' || toolName === 'fs_list') {
      const targetPath = (args?.path ?? args?.file ?? args?.directory) as
        | string
        | undefined;

      if (!targetPath) return null;

      if (path.isAbsolute(targetPath)) {
        return this.violation(
          toolName,
          'inspector',
          targetPath,
          'Absolute path forbidden for App Inspector',
        );
      }

      const normalized = path.normalize(targetPath);
      if (normalized.startsWith('..') || normalized.includes(`${path.sep}..`)) {
        return this.violation(
          toolName,
          'inspector',
          targetPath,
          'Path traversal detected: resolves outside jail root',
        );
      }

      const jailRoot = this.appStorage.getJailRoot();
      const resolved = path.resolve(jailRoot, normalized);

      if (resolved !== jailRoot && !resolved.startsWith(jailRoot + path.sep)) {
        return this.violation(
          toolName,
          'inspector',
          targetPath,
          `Resolved path '${resolved}' escapes jail root '${jailRoot}'`,
        );
      }

      if (normalized.split(path.sep).some((seg) => seg.startsWith('.'))) {
        return this.violation(
          toolName,
          'inspector',
          targetPath,
          'Hidden files/directories are forbidden',
        );
      }

      return null;
    }

    // Any other tool not explicitly handled — allow (tool scoping already
    // limits the Inspector to fs_read, fs_list, send_message).
    return null;
  }

  // ── Shell command validation ────────────────────────────────────────

  private validateShellCommand(
    appId: string,
    toolName: string,
    args: Record<string, unknown> | null,
  ): JailViolation | null {
    const command = (args?.command ?? args?.cmd) as string | undefined;
    if (!command) return null;

    for (const pattern of SHELL_ESCAPE_PATTERNS) {
      if (pattern.test(command)) {
        return this.violation(
          toolName,
          `app-owner-${appId}`,
          command,
          `Shell command matches escape pattern: ${pattern.source}`,
        );
      }
    }

    // Block absolute path references in the command
    if (/(?:^|\s)\/(?!dev\/null)/.test(command)) {
      return this.violation(
        toolName,
        `app-owner-${appId}`,
        command,
        `Shell command references absolute path`,
      );
    }

    return null;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private violation(
    tool: string,
    sessionKey: string,
    argument: string,
    reason: string,
  ): JailViolation {
    this.logger.error(
      `[JAIL VIOLATION] ${tool} blocked for ${sessionKey}: ${reason} | arg='${argument}'`,
    );
    return { tool, sessionKey, argument, reason };
  }
}
