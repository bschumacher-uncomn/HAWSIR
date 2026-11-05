import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const brand = JSON.parse(readFileSync(path.resolve(__dirname, 'brand.json'), 'utf8')) as Record<string, string>;

/**
 * The web app. It talks only to mission-api (/api); the API is the one
 * boundary to the data. `@contract` is the API's view contract (types, time
 * formatting, wire encoding), `@engine` is used only to re-verify hash
 * chains in the browser (never to compute a picture), and `@scenarios` only
 * for types of the fleet lab's catalog.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    { name: 'brand', transformIndexHtml: (html: string) => html.replace(/%BRAND_(\w+)%/g, (_, k: string) => brand[k.toLowerCase()] ?? '') },
  ],
  resolve: {
    alias: {
      '@contract': path.resolve(__dirname, 'mission-api/src/views'),
      '@engine': path.resolve(__dirname, 'mission-engine/src'),
      '@scenarios': path.resolve(__dirname, 'mission-engine/scenarios'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5310,
    strictPort: true,
    proxy: { '/api': process.env.HAWSIR_API ?? 'http://127.0.0.1:8820' },
  },
  build: { chunkSizeWarningLimit: 4000 },
  test: { include: ['src/**/*.test.ts'] },
});
