/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DISCORD_CLIENT_ID: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_APP_SHA?: string;
  readonly VITE_APP_REF?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
