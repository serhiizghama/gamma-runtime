import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { watchdogBridge } from "./vite-plugin-watchdog-bridge";

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
    allowedHosts: ["sputniks-mac-mini.tailcde006.ts.net"],
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/pty": {
        target: "ws://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
