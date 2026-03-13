import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { AppStorageService } from './app-storage.service';

/**
 * Git Workspace Service — Nested Repository Management (spec §9.2 v1.5).
 *
 * Solely responsible for all version-control interactions within the
 * web/apps/generated/ nested Git repository:
 * - Lazy repo initialization with branch setup and optional remote
 * - Staging, committing, and optionally pushing changes
 */
@Injectable()
export class GitWorkspaceService {
  private readonly logger = new Logger(GitWorkspaceService.name);
  private readonly branch: string;
  private readonly autoPush: boolean;
  private readonly privateRepoUrl: string | null;
  private readonly gitAuthorName: string;
  private readonly gitAuthorEmail: string;
  private gitReady = false;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: AppStorageService,
  ) {
    this.branch = this.config.get<string>(
      'SCAFFOLD_GIT_BRANCH',
      'private-apps',
    );
    this.autoPush =
      this.config.get<string>('SCAFFOLD_AUTO_PUSH', 'false') === 'true';
    this.privateRepoUrl =
      this.config.get<string>('SCAFFOLD_PRIVATE_REPO_URL', '') || null;
    this.gitAuthorName = this.config.get<string>(
      'GIT_AUTHOR_NAME',
      'gamma-os',
    );
    this.gitAuthorEmail = this.config.get<string>(
      'GIT_AUTHOR_EMAIL',
      'gamma@localhost',
    );
  }

  /**
   * Ensures the nested Git repo exists inside web/apps/generated/.
   * Idempotent — safe to call on every scaffold/remove operation.
   */
  async ensureRepo(): Promise<SimpleGit> {
    const jailRoot = this.storage.getJailRoot();
    const git = simpleGit(jailRoot);

    if (!this.gitReady) {
      await this.storage.ensureDir(jailRoot);

      const isRepo = await git.checkIsRepo().catch(() => false);

      if (!isRepo) {
        this.logger.log('Initializing nested Git repo in web/apps/generated/');
        await git.init();
        await git.addConfig('user.name', this.gitAuthorName);
        await git.addConfig('user.email', this.gitAuthorEmail);

        await git.checkoutLocalBranch(this.branch);
        await this.storage.writeFile(
          path.join(jailRoot, '.gitkeep'),
          '# AI-generated apps directory\n',
        );
        await git.add('.');
        await git.commit('init: generated apps workspace');

        if (this.privateRepoUrl) {
          await git.addRemote('origin', this.privateRepoUrl);
        }
      } else {
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        if (currentBranch.trim() !== this.branch) {
          try {
            await git.checkout(this.branch);
          } catch {
            await git.checkoutLocalBranch(this.branch);
          }
        }
      }

      this.gitReady = true;
    }

    return git;
  }

  /**
   * Stages all changes, commits with the given message, and optionally
   * pushes to the configured remote. Returns the commit hash.
   */
  async commitChanges(message: string): Promise<string | undefined> {
    const git = await this.ensureRepo();
    await git.add('.');
    const result = await git.commit(message, {
      '--author': `${this.gitAuthorName} <${this.gitAuthorEmail}>`,
    });
    const hash = result.commit || undefined;
    await this.pushIfEnabled(git);
    return hash;
  }

  /**
   * Stages all changes and commits only when there are actual file changes.
   * Used for removal flows where the bundle directory may already be absent.
   */
  async stageAndCommitIfChanged(message: string): Promise<void> {
    const git = await this.ensureRepo();
    await git.add('.');
    const hasChanges = (await git.status()).files.length > 0;
    if (hasChanges) {
      await git.commit(message, {
        '--author': `${this.gitAuthorName} <${this.gitAuthorEmail}>`,
      });
      await this.pushIfEnabled(git);
    }
  }

  private async pushIfEnabled(git: SimpleGit): Promise<void> {
    if (this.autoPush && this.privateRepoUrl) {
      try {
        await git.push('origin', this.branch);
      } catch (err) {
        this.logger.warn(`Auto-push failed (best-effort): ${err}`);
      }
    }
  }
}
