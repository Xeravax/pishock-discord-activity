import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

function readAppVersion(root: string): string {
  const fromEnv = process.env.VITE_APP_VERSION || process.env.APP_VERSION;
  if (fromEnv?.trim()) return fromEnv.trim();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')) as {
      label?: string;
    };
    if (raw.label) return String(raw.label);
  } catch {
    // ignore
  }
  return 'dev';
}

export default defineConfig(({ mode }) => {
  const root = path.resolve(import.meta.dirname);
  // Allow scripts/write-version.mjs output (.env.version) to feed VITE_* vars
  loadEnv(mode, root, '');
  try {
    const versionEnv = fs.readFileSync(path.join(root, '.env.version'), 'utf8');
    for (const line of versionEnv.split(/\r?\n/)) {
      const m = /^(VITE_[A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
    }
  } catch {
    // optional
  }

  const appVersion = readAppVersion(root);

  return {
    plugins: [react()],
    root: path.resolve(import.meta.dirname, 'src/client'),
    publicDir: path.resolve(import.meta.dirname, 'public'),
    envDir: root,
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    },
    build: {
      outDir: path.resolve(import.meta.dirname, 'client-dist'),
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:3000',
        '/.proxy/api': {
          target: 'http://localhost:3000',
          rewrite: (p) => p.replace(/^\/\.proxy/, ''),
        },
      },
    },
  };
});
