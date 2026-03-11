import { Injectable } from '@nestjs/common';

// ── Security deny patterns (spec §9.3) ──────────────────────────────────

interface DenyPattern {
  pattern: RegExp;
  reason: string;
}

const SECURITY_DENY_PATTERNS: DenyPattern[] = [
  {
    pattern: /\beval\s*\(/,
    reason: 'eval() is forbidden — arbitrary code execution risk',
  },
  {
    pattern: /\.innerHTML\s*=/,
    reason: 'innerHTML assignment — XSS risk; use React JSX instead',
  },
  {
    pattern: /\.outerHTML\s*=/,
    reason: 'outerHTML assignment — XSS risk',
  },
  {
    pattern: /document\.write\s*\(/,
    reason: 'document.write() — XSS risk',
  },
  {
    pattern: /localStorage\s*\./,
    reason:
      'Direct localStorage access forbidden in generated apps — use OS store',
  },
  {
    pattern: /sessionStorage\s*\./,
    reason: 'Direct sessionStorage access forbidden in generated apps',
  },
  {
    pattern: /require\s*\(\s*['"`]child_process/,
    reason: 'child_process require — server-side escape attempt',
  },
  {
    pattern: /process\.env\b/,
    reason: 'process.env access forbidden in generated client apps',
  },
  {
    pattern: /fetch\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)/,
    reason: 'External fetch calls require explicit allowlisting',
  },
];

/**
 * Validation Service — AST-free security scanner and structural validator
 * for AI-generated React component source code (spec §9.3).
 *
 * Solely responsible for checking source strings against deny patterns
 * and asserting structural requirements (export, React reference).
 */
@Injectable()
export class ValidationService {
  validateSource(
    source: string,
    fileName = 'generated.tsx',
  ): { ok: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const { pattern, reason } of SECURITY_DENY_PATTERNS) {
      if (pattern.test(source)) {
        errors.push(`Security violation in ${fileName}: ${reason}`);
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    if (!source.includes('export')) {
      errors.push(`${fileName}: must contain at least one export`);
    }

    if (!source.includes('React') && !source.includes('react')) {
      errors.push(
        `${fileName}: must import React or reference react for JSX`,
      );
    }

    return { ok: errors.length === 0, errors };
  }
}
