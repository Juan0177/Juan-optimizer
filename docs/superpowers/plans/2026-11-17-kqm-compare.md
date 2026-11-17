# KQM Compare (Alpha) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "KQM Compare" (Alpha) tab that takes KQM Theorycrafting's last result as team A, swaps
one member for a freely configured character with its own rotation fragment, runs KQM for that
member only (teammates fixed) on a throwaway database copy, and shows A vs B (DPR, DPS, shares,
ER) with a shareable card.

**Architecture:** Pure helpers (fragment substitution, side summaries) + one async engine function
(`compareSwapKqm`) that clones the database into a `SandboxStorage`, swaps the team slot under the
same `teamId`, and calls the KQM engine; a new tab component reads the saved KQM run and renders
the form, overview and card. Nothing existing changes behaviour; the only shared-code edits are
optional parameters with unchanged defaults.

**Tech Stack:** React 18, MUI 5, TypeScript, Nx, Vitest (+ Testing Library as in
`TeamOptimize/KqmUx.test.tsx`), Canvas 2D for the card.

**Spec:** `docs/superpowers/specs/2026-11-17-swap-compare-design.md`

## Global Constraints
- Branch `claude/vigilant-cannon-aqwxna`; PR to `juanlab` of Juan0177/Juan-optimizer only, never to
  frzyc/genshin-optimizer or s-naveen/stellar-optimizer; merge it if clean.
- Tab label `KQM Compare` with an `Alpha` badge, after `KQM Theorycrafting` (Beta); route
  `/teams/:teamId/kqm-compare`, shown only when `kqmTheorycraftingEnabled`.
- No writes to the user's database, `teamOpt`, `teamKqmResults`, or localStorage keys
  `teamOptRotationText_/Draft_/Opener_/Timing_<teamId>`.
- Fixed members keep A's builds, constellations and settings exactly.
- `TeamOptimize/DESIGN.md`: labels only, explanations in ⓘ tooltips, gold only for "Confronta",
  square controls, tabular right-aligned numbers, status colours for Δ only.
- New strings in the `juanlab` namespace, both `it` and `en` (`libs/gi/localization/assets/locales/{it,en}/juanlab.json`), under `kqmCompare.*`.
- WCAG 2.1 AA: axe 0 violations on the tab in the juanlab, go and stellar themes.

## Review Focus
- Leaving member present only in the opener, or in opener and loop → once total is required; opener-only must be substituted in the opener (Task 1 test).
- Entering character already in the team (e.g. Odette) → refused with a message, nothing runs (Task 2 test).
- Saved KQM run whose members differ from the team's now (team edited since) → treated as "no result" (Task 3 test).
- Leaving the tab mid-run → run cancelled, nothing written, no state left behind (Task 3 test).
- Gendered/renamed names (Traveler, nicknames like "Yae") in the fragment substitution → matched via the parser (Task 1 test).

---

### Task 1: Fragment substitution

**Files:**
- Create: `libs/gi/page-team/src/TeamOptimize/compare/swapFragment.ts`
- Test: `libs/gi/page-team/src/TeamOptimize/compare/swapFragment.test.ts`

**Interfaces:**
- Consumes: `parseRotation(text, names)` and `RotationMember` from `@genshin-optimizer/gi/ui` (`rotation/parse.ts:285`).
- Produces:
  ```ts
  export type SwapFragmentResult =
    | { ok: true; text: string; opener: string; where: 'text' | 'opener'; replaced: string; inserted: string }
    | { ok: false; error: 'notFound' | 'repeated' | 'emptyFragment'; count: number }
  export function swapFragment(args: {
    text: string; opener: string; names: RotationMember[]
    out: CharacterKey; inName: string; fragment: string
  }): SwapFragmentResult
  ```

- [ ] **Step 1: Write the failing tests** — names list `[Anastasya, Yae Miko, Odette, Danica]`:
  - `replaces the single step`: text `Danica E -> Odette E E -> Yae Miko E E E -> Danica Q -> Anastasya hE N2 Q N5 E E E N2`, out `YaeMiko`, inName `Mitya`, fragment `E Q` → `ok`, `text === 'Danica E -> Odette E E -> Mitya E Q -> Danica Q -> Anastasya hE N2 Q N5 E E E N2'`, `replaced === 'Yae Miko E E E'`, `where === 'text'`.
  - `nickname`: `Yae E E E` in place of `Yae Miko E E E` → same result.
  - `notFound`: out `Mitya` → `{ ok: false, error: 'notFound', count: 0 }`.
  - `repeated`: Yae twice in text → `error: 'repeated', count: 2`; once in opener + once in text → `repeated`, `count: 2`.
  - `opener only`: opener `Yae Miko E -> Danica E`, text without Yae → `where: 'opener'`, opener becomes `Mitya E Q -> Danica E`, text unchanged.
  - `emptyFragment`: fragment `'  '` → `error: 'emptyFragment'`.
- [ ] **Step 2: Run** `npx nx test gi-page-team -- swapFragment` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `swapFragment`** — split on `->` keeping each step's raw text; identify a step's member with `parseRotation(step, names)` (its first step's `characterKey`) so nicknames and accents match the parser; count across opener + text; rebuild by replacing only that raw step, preserving the original separators and spacing elsewhere.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "KQM Compare: sostituzione del frammento di rotazione"`.

### Task 2: Engine — `compareSwapKqm` on a sandbox copy

**Files:**
- Create: `libs/gi/page-team/src/TeamOptimize/compare/compareSwapKqm.ts`
- Test: `libs/gi/page-team/src/TeamOptimize/compare/compareSwapKqm.test.ts`
- Modify: `libs/gi/page-team/src/TeamOptimize/RotationWriter.tsx` (`kqmRotationReplay`: optional `opener?: string`, default = localStorage as now)
- Modify: `libs/gi/page-team/src/TeamOptimize/useKqmRun.ts` (`kqmReplayOf`: optional trailing `opener?: string` passed through)

**Interfaces:**
- Consumes: `swapFragment` (Task 1); `compareTeamKqm`, `optimizeTeamKqm`, `KqmResult`, `KqmBuild`, `KqmWeapon`, `KqmSets`, `teamOptMembers` from `@genshin-optimizer/gi/ui`; `SandboxStorage` from `@genshin-optimizer/common/database`; `ArtCharDatabase`, `TeamKqmSavedRun`, `TeamOptKqm` from `@genshin-optimizer/gi/db`; `kqmReplayOf` (useKqmRun.ts).
- Produces:
  ```ts
  export interface SwapIn {
    key: CharacterKey; constellation: number
    weapon: KqmWeapon | 'auto'; sets: KqmSets | 'auto'
    build: 'kqm' | { kind: 'existing'; buildId: string }
    kqm?: Partial<TeamOptKqm>   // the entering member's own KQM settings (per-member entries only)
  }
  export interface SideMember { key: CharacterKey; damage: number; share: number; er: number; erValue: number; build?: KqmBuild; fixed: boolean }
  export interface Side { dpr: number; dps: number; rotationTime: number; members: SideMember[]; rotation: string }
  export function sideOf(result: KqmResult, rotation: string, fixed: CharacterKey[]): Side
  export async function compareSwapKqm(args: {
    database: ArtCharDatabase; teamId: string; gender: GenderKey; i18n: i18n
    saved: TeamKqmSavedRun; out: CharacterKey; swapIn: SwapIn
    text: string; opener: string; fragment: string
    onStep?: (s: KqmStep) => void; isCancelled?: () => boolean
  }): Promise<{ a: Side; b: Side } | { error: 'inTeam' | SwapFragmentError | 'cancelled' | 'unsupported' }>
  ```

- [ ] **Step 1: Write the failing tests** (database built in the test as `KqmPool.test.tsx` does, a 4-member team with a saved KQM run in `teamKqmResults`):
  - `sideOf`: from a `KqmResult` with `after.total = 1000`, members `{A: 600, B: 400}`, `played.rotationTime = 20` → `dpr 1000`, `dps 50`, shares `0.6 / 0.4`, `er` = `energyRecharge[ck].target`.
  - `no writes`: snapshot `database.storage.entries` and the four localStorage keys before; run `compareSwapKqm` (out Yae, in Mitya C0, weapon `{ key: 'WanderingEvenstar', refinement: 1 }`, fragment `E Q`); after: identical.
  - `fixed members unchanged`: `b.members` for the three others have `fixed: true` and `build` deep-equal to the saved run's `result.builds[key]`.
  - `inTeam`: swapIn `Odette` → `{ error: 'inTeam' }`.
  - `fragment errors pass through`: Yae twice → `{ error: 'repeated' }`.
  - `cancelled`: `isCancelled: () => true` → `{ error: 'cancelled' }` and no writes.
- [ ] **Step 2: Run** `npx nx test gi-page-team -- compareSwapKqm` — Expected: FAIL.
- [ ] **Step 3: Add the optional `opener` parameter** to `kqmRotationReplay` and `kqmReplayOf` (default unchanged); run `npx nx test gi-page-team -- rotation` — Expected: existing tests PASS.
- [ ] **Step 4: Implement `sideOf` and `compareSwapKqm`.** Sandbox: `new ArtCharDatabase(database.dbIndex, new SandboxStorage(Object.fromEntries(database.storage.entries)))`; in it add `chars` entry if missing (level 90, ascension 6, talents as KQM mode assumes), `teamChars.new(swapIn.key, {})`, replace the leaving member's `loadoutData` slot, set `teamOpt.kqm.constellations[key]` and the entering member's per-member KQM settings (it inherits the leaving member's field time). Play the swapped text/opener through `kqmReplayOf(sandbox, …, text, opener)`. Search only the entering member with teammates fixed from `saved.run.result.builds`: `compareTeamKqm` when weapon and sets are fixed; for `'auto'`, the engine's one-member path (`from` = teammates' builds + `only`), and if that path cannot search a member with no starting build without engine changes, return `{ error: 'unsupported' }` for `'auto'` and the UI disables Auto (spec: "ship fixed weapon + sets first"). Same rule for `build.kind === 'existing'`. A = `sideOf(saved.run.result, text, fixed)`.
- [ ] **Step 5: Run** the Task 2 tests — Expected: PASS. Run `npx nx run gi-page-team:typecheck` (or `npx tsc -p libs/gi/page-team/tsconfig.lib.json --noEmit`) — Expected: no errors.
- [ ] **Step 6: Commit** `git commit -m "KQM Compare: calcolo su copia temporanea del database"`.

### Task 3: The tab and its screen

**Files:**
- Create: `libs/gi/page-team/src/TeamOptimize/compare/KqmCompare.tsx`
- Modify: `libs/gi/page-team/src/TeamCharacterSelector.tsx` (new `Tab` value `kqm-compare` after the KQM tab, `BetaBadge` with label `Alpha`; `teamBuildMode` gains `'kqm-compare'`)
- Modify: `libs/gi/page-team/src/index.tsx` (`KQM_COMPARE_PATH = 'kqm-compare'`, route match, render `KqmCompare`, same `kqmTheorycraftingEnabled` guard)
- Modify: `libs/gi/localization/assets/locales/{it,en}/juanlab.json` (`kqmCompare.*`)
- Test: `libs/gi/page-team/src/TeamOptimize/compare/KqmCompare.test.tsx`

**Interfaces:**
- Consumes: `compareSwapKqm`, `SwapIn`, `Side` (Task 2); `swapFragment` (Task 1) for the live preview; `database.teamKqmResults.getRun(teamId)`; `teamOptMembers`; existing pickers (`WeaponChooser.tsx`, `KqmChoosers.tsx`) and `ui.tsx` building blocks.
- Produces: `export default function KqmCompare({ teamId }: { teamId: string })`; `export function savedRunFor(database, teamId): TeamKqmSavedRun | undefined` (undefined when the saved `members` differ from the team's current members).

- [ ] **Step 1: Write the failing tests:**
  - `no saved run` → text `kqmCompare.noResult` shown, "Confronta" disabled.
  - `savedRunFor` returns `undefined` when the team's members changed since the run.
  - "Confronta" disabled until: leaving member chosen, entering character chosen, fragment valid, confirmation checkbox ticked; enabled after all four.
  - Fixed members render with a lock and no editable controls; the entering member's constellation/weapon/sets/build controls are enabled.
  - Preview line shows B's rotation with the replaced step in a `<mark>`.
  - Unmounting during a run calls cancel (mock `compareSwapKqm`, assert `isCancelled()` becomes true).
- [ ] **Step 2: Run** `npx nx test gi-page-team -- KqmCompare` — Expected: FAIL.
- [ ] **Step 3: Implement the tab, route and screen** per the spec's screen sketch. Entering member: character picker (characters with a kit model, minus the team's), constellation C0–C6, weapon (+R) or Auto, sets or Auto, build "KQM" or an existing build from a list (equipped, `database.builds`, `database.buildTcs` of that character), and a collapsible "Impostazioni KQM" with the per-member options KQM Theorycrafting shows for a member (reuse its components, bound to local state, never to `teamOpt`). Confirmation shows `savedAt` formatted in the user's locale; run with progress (`onStep`); overview table A | B | Δ with DPR, DPS, rotation time, per member damage + share and ER (`er` target; warning colour when a fixed member's `erValue < er` in B); the swapped member's row labelled `Yae Miko → Mitya`.
- [ ] **Step 4: Run** the Task 3 tests — Expected: PASS; run the whole `npx nx test gi-page-team` — Expected: PASS (existing tabs untouched).
- [ ] **Step 5: Commit** `git commit -m "KQM Compare: scheda Alpha, scelta del cambio e riepilogo A/B"`.

### Task 4: Comparison card

**Files:**
- Create: `libs/gi/ui/src/components/character/buildCard/renderKqmCompareCard.tsx` (export from the folder's `index.ts`)
- Modify: `libs/gi/page-team/src/TeamOptimize/compare/KqmCompare.tsx` ("Crea card" button → `CardImageDialog`)
- Test: `libs/gi/page-team/src/TeamOptimize/compare/compareCardData.test.ts`

**Interfaces:**
- Consumes: `Side` (Task 2); `kqmCardFace`, `shareStyle.ts` helpers, `CardImageDialog`.
- Produces: `export type KqmCompareCardData = { name: string; a: KqmCardData; b: KqmCardData; swap: { out: string; in: string }; labels: KqmCardData['labels'] & { delta: string } }`; `export function renderKqmCompareCard(data: KqmCompareCardData): Promise<HTMLCanvasElement>`; in page-team `export function compareCardData(a: Side, b: Side, ctx): KqmCompareCardData`.

- [ ] **Step 1: Write the failing test** `compareCardData`: DPR/DPS strings formatted with `formatDamage`, shares `0…1`, both rotations present, swap names `Yae Miko` / `Mitya`.
- [ ] **Step 2: Run** `npx nx test gi-page-team -- compareCardData` — Expected: FAIL.
- [ ] **Step 3: Implement** `compareCardData` and `renderKqmCompareCard` (two columns of `renderKqmCard`'s member rows, a header with DPR/DPS/time and Δ, both rotations, "Juan-optimizer" mark; fileName `KQM-Compare-<team>`).
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "KQM Compare: card del confronto"`.

### Task 5: Real-data check, accessibility, ship

**Files:** none new (scratch scripts in the session scratchpad only).

- [ ] **Step 1:** `npx nx run-many -t typecheck lint test -p gi-page-team gi-ui` — Expected: all pass.
- [ ] **Step 2:** Build the site (`GO_KQM_THEORYCRAFTING` unset) and serve it locally; with Playwright import the user's save `Juan-optimizer_DB_Tsaritsa_Yae_e_Mitya.json`, run KQM Theorycrafting on `Tsaritsa - Yae - Odette - Danica`, open KQM Compare, out Yae Miko, in Mitya C0 Wandering Evenstar R1, fragment `E Q`, tick, Confronta. Expected: A equals KQM Theorycrafting's DPR/DPS; B shows numbers; fixed members' weapons/sets identical on both sides; `database.storage.entries` and the four localStorage keys identical before/after; card PNG downloads.
- [ ] **Step 3:** axe-core on the tab (before and after a run) in the juanlab, go, stellar themes — Expected: 0 violations.
- [ ] **Step 4:** Push, open the PR to `juanlab` (Juan0177/Juan-optimizer), merge if clean, check the Pages deploy succeeds.
