#!/usr/bin/env bash
# start-dev.sh — Start all gamma-runtime services with auto-restart for Vite.
#
# Usage: ./scripts/start-dev.sh
# Logs:
#   /tmp/gamma-runtime-core.log
#   /tmp/gamma-runtime-ui.log
#   /tmp/gamma-h2-proxy.log
#   /tmp/gamma-watchdog.log

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

CORE_LOG=/tmp/gamma-runtime-core.log
UI_LOG=/tmp/gamma-runtime-ui.log
H2_LOG=/tmp/gamma-h2-proxy.log
WD_LOG=/tmp/gamma-watchdog.log

echo "[start-dev] Killing existing services..."
lsof -ti:3001 -ti:5173 -ti:5174 | xargs kill -9 2>/dev/null || true
pkill -f "gamma-watchdog/dist/main.js" 2>/dev/null || true
sleep 1

echo "[start-dev] Starting gamma-core..."
nohup bash -c "set -a; source $REPO/apps/gamma-core/.env; set +a; node $REPO/apps/gamma-core/dist/apps/gamma-core/src/main.js" \
  > "$CORE_LOG" 2>&1 &
CORE_PID=$!
echo "  Core PID: $CORE_PID"

echo "[start-dev] Starting gamma-watchdog..."
nohup node "$REPO/apps/gamma-watchdog/dist/main.js" > "$WD_LOG" 2>&1 &
WD_PID=$!
echo "  Watchdog PID: $WD_PID"

echo "[start-dev] Starting Vite (with auto-restart)..."
# Run Vite in a restart loop so SIGKILL doesn't kill the whole UI.
(
  while true; do
    H2_PROXY=1 pnpm --filter @gamma/ui exec vite --host 127.0.0.1 --port 5174 \
      >> "$UI_LOG" 2>&1 || true
    EXIT_CODE=$?
    echo "[vite-watchdog] Vite exited (code=$EXIT_CODE). Restarting in 2s..." >> "$UI_LOG"
    sleep 2
  done
) &
VITE_LOOP_PID=$!
echo "  Vite loop PID: $VITE_LOOP_PID"

# Wait for Vite to be ready
for i in $(seq 1 15); do
  sleep 1
  if lsof -i:5174 | grep -q LISTEN; then
    echo "  Vite ready on :5174"
    break
  fi
done

echo "[start-dev] Starting H2 proxy..."
nohup node "$REPO/scripts/h2-proxy.mjs" > "$H2_LOG" 2>&1 &
H2_PID=$!
echo "  H2 proxy PID: $H2_PID"

sleep 2

echo ""
echo "=============================="
echo "  gamma-runtime is running"
echo "=============================="
lsof -i:3001 | grep LISTEN && echo "  ✅ Core   :3001" || echo "  ❌ Core   DOWN"
lsof -i:5174 | grep LISTEN && echo "  ✅ Vite   :5174" || echo "  ❌ Vite   DOWN"
lsof -i:5173 | grep LISTEN && echo "  ✅ Proxy  :5173" || echo "  ❌ Proxy  DOWN"
pgrep -f "gamma-watchdog" > /dev/null && echo "  ✅ Watchdog" || echo "  ❌ Watchdog DOWN"
echo ""
echo "  UI: https://sputniks-mac-mini.tailcde006.ts.net:5173"
echo "  Logs: $CORE_LOG | $UI_LOG | $H2_LOG | $WD_LOG"
