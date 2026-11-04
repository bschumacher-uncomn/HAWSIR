import { defineConfig } from 'vite';
import path from 'node:path';

/** Bundles the edge server into one self-contained ESM file (no node_modules needed at runtime). */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  publicDir: false,
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    target: 'node20',
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { format: 'esm', entryFileNames: 'index.mjs', inlineDynamicImports: true } },
  },
});
