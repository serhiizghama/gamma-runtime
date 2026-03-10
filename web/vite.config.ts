import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@gamma/types": path.resolve(__dirname, "../packages/gamma-types/index.ts"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["sputniks-mac-mini.tailcde006.ts.net"],
  },
});
