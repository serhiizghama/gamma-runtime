/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAMMA_SYSTEM_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
