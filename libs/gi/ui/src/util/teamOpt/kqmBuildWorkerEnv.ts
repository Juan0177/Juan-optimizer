/*
 * Dev only: the dev server's React refresh runtime (imported by the game data's .tsx modules) reads
 * `window`, which a worker does not have. Imported first by `kqmBuildWorker`, so it runs before them.
 */
// @ts-expect-error TS1470 (this library is typed as CommonJS; the bundler loads it as a module)
if (import.meta.hot) {
  // (as the page's preamble sets them)
  const scope = globalThis as {
    window?: unknown
    $RefreshReg$?: () => void
    $RefreshSig$?: () => (type: unknown) => unknown
  }
  scope.window ??= globalThis
  scope.$RefreshReg$ ??= () => undefined
  scope.$RefreshSig$ ??= () => (type) => type
}
