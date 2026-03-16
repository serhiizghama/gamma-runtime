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
      // Use dotenv/config via full path — safe for multiline values (PEM keys).
      // bash `set -a; source .env` breaks on OPENCLAW_DEVICE_PRIVATE_KEY_PEM.
      script: `${ROOT}/apps/gamma-core/dist/main.js`,
      cwd: `${ROOT}/apps/gamma-core`,
      interpreter: 'node',
      node_args: `-r ${ROOT}/apps/gamma-core/node_modules/dotenv/config`,
      env: {
        DOTENV_CONFIG_PATH: `${ROOT}/apps/gamma-core/.env`,
      },
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
