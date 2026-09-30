import { createRequire } from 'node:module'
import { defineConfig } from 'tsdown'

const require = createRequire(import.meta.url)
// editorconfig가 쓰는 @one-ini/wasm은 실행 시 __dirname 옆의 wasm 파일을 읽으므로 앱 번들 폴더에 함께 복사해야 한다.
const oneIniWasm = createRequire(require.resolve('editorconfig')).resolve('@one-ini/wasm/one_ini_bg.wasm')

export default defineConfig([
  {
    entry: { main: 'electron/main.ts' },
    format: 'cjs',
    platform: 'node',
    outDir: 'dist/electron',
    clean: true,
    outExtensions: () => ({ js: '.cjs' }),
    copy: [{ from: oneIniWasm, to: 'dist/electron' }],
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
