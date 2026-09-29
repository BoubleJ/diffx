import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/cli.ts'],
    format: 'esm',
    outDir: 'dist',
    clean: false,
    deps: {
      neverBundle: ['open', 'get-port'],
    },
  },
  {
    entry: { main: 'electron/main.ts' },
    format: 'cjs',
    platform: 'node',
    outDir: 'dist/electron',
    clean: true,
    outExtensions: () => ({ js: '.cjs' }),
    deps: {
      neverBundle: ['electron'],
      alwaysBundle: [/^(?!electron$).+/],
    },
  },
  {
    entry: { preload: 'electron/preload.ts' },
    format: 'cjs',
    platform: 'node',
    outDir: 'dist/electron',
    clean: false,
    outExtensions: () => ({ js: '.cjs' }),
    deps: {
      neverBundle: ['electron'],
    },
  },
])
