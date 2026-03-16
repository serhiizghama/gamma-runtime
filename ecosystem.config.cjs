/**
 * PM2 ecosystem config for gamma-runtime.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs   — start all services
 *   pm2 stop all                     — stop all
 *   pm2 restart all                  — restart all
 *   pm2 logs                         — tail all logs
 *   pm2 save                         — persist process list
 *   pm2 startup                      — install auto-start on system boot
 */

const ROOT = '/Users/sputnik/.openclaw/agents/serhii/projects/gamma-runtime';

module.exports = {
  apps: [
    {
      name: 'gamma-core',
      script: 'apps/gamma-core/dist/main.js',
      cwd: ROOT,
      interpreter: 'node',
      env_file: 'apps/gamma-core/.env',
      // Load .env manually via preload (pm2 doesn't source dotenv natively)
      node_args: [],
      // env vars from the .env file are loaded via the shell wrapper below
      // We use a wrapper script to source the .env before starting node
      script: 'bash',
      args: `-c "set -a; source ${ROOT}/apps/gamma-core/.env; set +a; node ${ROOT}/apps/gamma-core/dist/main.js"`,
      interpreter: 'none',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      out_file: '/tmp/gamma-runtime-core.log',
      error_file: '/tmp/gamma-runtime-core.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'gamma-ui',
      cwd: ROOT,
      script: 'bash',
      args: `-c "cd ${ROOT} && H2_PROXY=1 pnpm --filter @gamma/ui exec vite --host 127.0.0.1 --port 5174"`,
      interpreter: 'none',
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 50,
      out_file: '/tmp/gamma-runtime-ui.log',
      error_file: '/tmp/gamma-runtime-ui.log',
      merge_logs: true,
    },
    {
      name: 'gamma-h2-proxy',
      cwd: ROOT,
      script: 'scripts/h2-proxy.mjs',
      interpreter: 'node',
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 20,
      out_file: '/tmp/gamma-h2-proxy.log',
      error_file: '/tmp/gamma-h2-proxy.log',
      merge_logs: true,
    },
    {
      name: 'gamma-watchdog',
      cwd: ROOT,
      script: 'apps/gamma-watchdog/dist/main.js',
      interpreter: 'node',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      out_file: '/tmp/gamma-watchdog.log',
      error_file: '/tmp/gamma-watchdog.log',
      merge_logs: true,
    },
  ],
};
