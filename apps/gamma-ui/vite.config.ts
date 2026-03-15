import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { watchdogBridge } from "./vite-plugin-watchdog-bridge";

// ── TLS certificates (shared with gamma-core) ────────────────────────────
const repoRoot = path.resolve(__dirname, "../..");
const keyPath = path.join(repoRoot, "certs", "localhost.key");
const certPath = path.join(repoRoot, "certs", "localhost.cert");
const hasCerts = fs.existsSync(keyPath) && fs.existsSync(certPath);

// When running behind the h2-proxy (H2_PROXY=1), Vite serves plain HTTP
// so the proxy doesn't have to negotiate TLS twice.
const behindProxy = process.env.H2_PROXY === '1';

const httpsConfig = (hasCerts && !behindProxy)
  ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
  : undefined;

// Backend target adapts to TLS availability
const apiTarget = hasCerts ? "https://localhost:3001" : "http://localhost:3001";
const wsTarget = hasCerts ? "wss://localhost:3001" : "ws://localhost:3001";

export default defineConfig({
  plugins: [react(), watchdogBridge()],
  resolve: {
    alias: {
      "@gamma/types": path.resolve(__dirname, "../../packages/gamma-types/index.ts"),
      "@gamma/os": path.resolve(__dirname, "hooks/os-api.ts"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    ...(httpsConfig ? { https: httpsConfig } : {}),
    allowedHosts: ["sputniks-mac-mini.tailcde006.ts.net"],
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        secure: false, // accept self-signed certs from backend
      },
      "/pty": {
        target: wsTarget,
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
