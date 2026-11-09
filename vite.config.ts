import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/client'),
  publicDir: path.resolve(__dirname, 'public'),
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, 'client-dist'),
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
});
