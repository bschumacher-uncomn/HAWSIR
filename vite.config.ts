import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5310,
    strictPort: true,
    proxy: { '/api': process.env.NAVIFI_SERVER ?? 'http://127.0.0.1:8810' },
  },
  build: { chunkSizeWarningLimit: 4000 },
  test: { include: ['src/**/*.test.ts'] },
});
