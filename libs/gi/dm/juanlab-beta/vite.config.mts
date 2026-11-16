// juanlab-beta: runs generate.ts with vite-node, with the monorepo paths of tsconfig.base.json as aliases and
// gi/dm replaced by the shim (the real module reads the whole datamine when imported).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const paths: Record<string, string[]> = JSON.parse(readFileSync(`${root}tsconfig.base.json`, 'utf8')).compilerOptions.paths
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@genshin-optimizer\/gi\/dm$/, replacement: fileURLToPath(new URL('./shim-dm.ts', import.meta.url)) },
      ...Object.entries(paths).map(([name, [target]]) => ({ find: new RegExp(`^${escape(name)}$`), replacement: `${root}${target}` })),
    ],
  },
})
