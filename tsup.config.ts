import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
  },
  outDir: 'dist-electron',
  format: ['cjs'],
  target: 'node22',
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ['electron', 'better-sqlite3'],
  noExternal: [],
} as any);
