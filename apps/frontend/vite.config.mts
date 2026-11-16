// viteStaticCopy contains some `require`, so we need to have our config as .mts instead of .ts.
// https://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only

import { resolve } from 'node:path'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { defineConfig, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import pkg from '../../package.json' with { type: 'json' }

export default defineConfig(() => ({
  base: '',
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/frontend',

  server: {
    port: 4200,
    host: 'localhost',
  },

  preview: {
    port: 4300,
    host: 'localhost',
  },

  plugins: [
    react(),
    nxViteTsPaths(),
    // Nx executor for vite does not support `assets` prop for copying files.
    // So we need to do it with this plugin. This works for both `build` and `serve`.
    viteStaticCopy({
      targets: [
        {
          src: normalizePath(
            resolve('../../libs/common/localization/assets/locales')
          ),
          dest: 'assets',
        },
        {
          src: normalizePath(
            resolve('../../libs/gi/localization/assets/locales')
          ),
          dest: 'assets',
        },
        {
          src: normalizePath(
            resolve('../../libs/gi/dm-localization/assets/locales')
          ),
          dest: 'assets',
        },
        {
          src: normalizePath(
            resolve('../../libs/gi/silly-wisher-names/assets/locales')
          ),
          dest: 'assets',
        },
        {
          src: normalizePath(resolve('../../apps/frontend/assets/*')),
          dest: 'assets',
        },
      ],
      // Force page to reload if we change any of the above files
      watch: {
        reloadPageOnChange: true,
      },
    }),
  ],

  define: {
    // juanlab: solo le variabili NX_* (URL e impostazioni dell'app) e NODE_ENV. Prima passava tutto process.env
    // e nel JavaScript pubblicato finivano le variabili del runner di GitHub Actions, token compresi.
    'process.env': Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => k.startsWith('NX_') || k === 'NODE_ENV'
      )
    ),
    __VERSION__: `"${pkg.version}"`,
    // juanlab: id della build, aggiunto alle richieste delle traduzioni (?v=...) cosi dopo un deploy il browser non
    // usa i JSON vecchi che ha in cache (GitHub Pages li fa tenere 10 minuti) con il JavaScript nuovo
    __JUANLAB_BUILD__: JSON.stringify(Date.now().toString(36)),
  },

  // Uncomment this if you are using workers.
  worker: {
    // https://vitejs.dev/guide/migration#worker-plugins-is-now-a-function
    plugins: () => [nxViteTsPaths()],
  },

  build: {
    outDir: '../../dist/apps/frontend',
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },

  test: {
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/frontend',
      provider: 'v8',
    },
  },
}))
