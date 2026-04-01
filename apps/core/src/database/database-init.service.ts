import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class DatabaseInitService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseInitService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    const ok = await this.db.healthCheck();
    if (!ok) {
      throw new Error('Cannot connect to Postgres');
    }
    this.logger.log('Connected to Postgres');

    await this.runMigrations();
  }

  private async runMigrations() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )
    `);

    const migrationsDir = join(__dirname, 'migrations');
    const migrationFile = '001-init.sql';

    const { rows } = await this.db.query<{ name: string }>(
      'SELECT name FROM _migrations WHERE name = $1',
      [migrationFile],
    );

    if (rows.length > 0) {
      this.logger.log(`Migration ${migrationFile} already applied, skipping`);
      return;
    }

    const sql = readFileSync(join(migrationsDir, migrationFile), 'utf-8');
    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (name, applied_at) VALUES ($1, $2)',
        [migrationFile, Date.now()],
      );
      await client.query('COMMIT');
      this.logger.log(`Migration ${migrationFile} applied successfully`);
    } catch (err) {
      await client.query('ROLLBACK');
      const error = err as Error;
      if (error.message?.includes('already exists')) {
        this.logger.log(`Tables already exist, marking ${migrationFile} as applied`);
        await this.db.query(
          'INSERT INTO _migrations (name, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [migrationFile, Date.now()],
        );
      } else {
        throw err;
      }
    } finally {
      client.release();
    }
  }
}
