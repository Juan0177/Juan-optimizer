# Build KQM / TC → 5 manufatti per gc-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a KQM build or a TC build, generate five legal +20 artifacts (9 rolls each) close to the build, preview them, and send them to gc-web with the existing link.

**Architecture:** A pure generator works on a normalised input (sets, per-slot main/rarity, substat targets, which substats are "used"); two small normalisers feed it from `KqmBuild` and `BuildTc`; a dialog previews the pieces and the target/generated/Δ table and opens `gcwebLink` with a `JuanLabBuild` payload. gc-web is not changed.

**Tech Stack:** TypeScript, React + MUI, vitest, i18next (`juanlab` namespace).

**Spec:** `docs/superpowers/specs/2026-11-18-build-to-gcweb-design.md`

## Global Constraints

- Branch `claude/vigilant-cannon-aqwxna`; PR to `juanlab` of Juan0177/Juan-optimizer only. gc-web (Juan0177/gc-web) is not changed.
- Every piece: rarity and main stat exactly as the build; level +20 for 5★ (+16 for 4★ pieces of 4★ sets); rolls = gc-web's `artifactRollLimits(4, level)` (`/home/user/gc-web/public/commands.js:119`): 5★ +20 → 9 rolls, 4 substats, ≤ 6 rolls per substat; 4★ +16 → 8 rolls; never fewer (no random server upgrades).
- No substat equal to the piece's main stat; at most 4 substats per piece.
- Each roll is one of the game's tiers for that substat and rarity (`getSubstatValuesPercent(key, rarity)` in `libs/gi/util/src/artifact/artifact.ts`); the value sent is the exact sum of the chosen tiers as the game shows it (percent with one decimal, flat whole), and gc-web's read-back (`countsFor` → fewest-rolls combination, `/home/user/gc-web/public/juanlab.js` + `commands.js` `substatMarks`) must return the same roll count per substat.
- "Used" substats: from the caller (KQM: the problem's `scales` when available) or else: substats with placed rolls (TC: above their 2 fixed rolls), CRIT Rate/DMG, ER, the sands/goblet/circlet main stats that are substats (hp_, atk_, def_, eleMas, enerRech_, critRate_, critDMG_), and the flat HP/ATK/DEF of a counted HP%/ATK%/DEF%. Unused substats are filler at the lowest tier; their KQM fixed rolls are not targets.
- Unreachable totals (standards above 25 placed rolls, or caps): generate the closest legal result and report the gap per substat; never refuse.
- No writes to the database, team state or KQM results. The send button only when the gc-web link is enabled (`useGcwebSettings`), as `SendToGcwebButton` does.
- Italian and English strings in `libs/gi/localization/assets/locales/{it,en}/juanlab.json` (`gcwebBuild.*`), official game terms.
- Commit messages in Italian with the session trailer from the brief.

## Review Focus

- A build whose main stat equals a heavily-rolled substat (e.g. CRIT DMG circlet + many CRIT DMG rolls): the 4 other pieces must carry it, ≤ 6 per piece. (Task 1 test)
- ER sands + high ER target: ER can only be on 4 pieces. (Task 1 test)
- A 4★ set (4 pieces 4★ +16, one 5★ off-piece): roll budgets differ per piece. (Task 1 test)
- KQMS 30/40 rolls: closest result with a reported gap, no throw. (Task 1 test)
- A value that two tier mixes reach with different roll counts: the generator picks the mix gc-web reads back with the same count. (Task 1 test)

---

### Task 1: Generator

**Files:**
- Create: `libs/gi/ui/src/juanlab/gcwebArtifacts.ts`
- Test: `libs/gi/ui/src/juanlab/gcwebArtifacts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GenSlot { slotKey: ArtifactSlotKey; mainStatKey: MainStatKey; rarity: 4 | 5; level: number; setKey: ArtifactSetKey }
  export interface GenInput {
    slots: GenSlot[]                                  // 5, flower..circlet
    targets: Partial<Record<SubstatKey, number>>      // total substat values as the game shows them (percent points / flat)
    used: SubstatKey[]                                // substats that matter; others are filler
  }
  export interface GenPiece extends GenSlot { substats: { key: SubstatKey; rolls: number[]; value: number }[] } // rolls = tier values, value = shown sum
  export interface GenResult {
    pieces: GenPiece[]
    totals: Partial<Record<SubstatKey, number>>
    gaps: Partial<Record<SubstatKey, number>>         // generated − target, used substats only
  }
  export function generateArtifacts(input: GenInput): GenResult
  export function gcwebReadBack(key: SubstatKey, rarity: 4 | 5, value: number): number // roll count gc-web reads for that value (port of countsFor/substatMarks: fewest rolls, stronger tiers first)
  ```
- [ ] **Step 1: Write the failing tests**: KQMS 5★ Anastasya-like build → 5 pieces, each 9 rolls, 4 substats, none equal to its main, ≤ 6 per substat, every substat value = exact tier sum and `gcwebReadBack` equals its rolls length; used totals within one lowest tier of target; the five Review Focus cases above; determinism (same input → same output); runtime < 100 ms. Build `gcwebReadBack`'s expectations from gc-web's own algorithm: read `/home/user/gc-web/public/commands.js` (`substatMarks`, `strongerFirst`, `shownSum` with `Math.fround`) and `juanlab.js` (`countsFor`) and port them faithfully; add 6 fixed cases computed by running gc-web's functions in node (import the .js files from the gc-web checkout in a one-off script; paste the outputs as literals with a comment).
- [ ] **Step 2: Run** `npx vitest run libs/gi/ui/src/juanlab/gcwebArtifacts.test.ts` → FAIL.
- [ ] **Step 3: Implement**: place substats on pieces (search over assignments respecting the constraints; used substats first by target size), then choose tiers per roll so each used total is closest to its target and each substat's tier mix reads back with its count; filler at the lowest tier.
- [ ] **Step 4: Run** the file → PASS; `npx vitest run libs/gi/ui` once → no new failures; tsc gi-ui = 2 (baseline).
- [ ] **Step 5: Commit** `gc-web: genera 5 manufatti reali da una build`.

### Task 2: Inputs from KQM and TC builds, and the payload

**Files:**
- Modify: `libs/gi/ui/src/juanlab/gcwebArtifacts.ts` (or a sibling `gcwebBuildInput.ts`), `libs/gi/ui/src/juanlab/gcweb.ts` (payload from `GenResult`)
- Test: same folder

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export function genInputFromKqm(build: KqmBuild, opts: { rolls?: number; scales?: SubstatKey[]; offSet?: ArtifactSetKey }): GenInput
  export function genInputFromTc(buildTc: BuildTc): GenInput
  export function genResultToPayload(characterKey: CharacterKey, gender: 'F' | 'M', name: string, result: GenResult): JuanLabBuild
  ```
- [ ] **Step 1: Write the failing tests**: KQM: targets = `kqmValues(build)` minus main stats, converted to shown units; rarity per slot from `kqmBuildRarity` (4★ sets: 4★ pieces +16, the off-piece 5★ +20); 4-piece set + off-piece set (an allowed set not breaking the bonuses; 2+2 builds keep both sets); `used` from `scales` when given, else placed-roll substats + CRIT + ER. TC: slots from `buildTc.artifact.slots`, targets = `buildTc.artifact.substats.stats` (values), sets from `artifact.sets`. Payload: `setId`, `slot`, `mainProp`, `prop` ids via the same maps as `artifactsToPayload`, `value` = shown sums; `decodePayload(encodePayload(p))` round-trips.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; gi-ui suite; tsc 2.
- [ ] **Step 5: Commit** `gc-web: build KQM e TC come input, link per gc-web`.

### Task 3: Preview dialog and entry points

**Files:**
- Create: `libs/gi/ui/src/juanlab/GcwebBuildDialog.tsx`
- Modify: `libs/gi/page-team/src/TeamOptimize/KqmComparison.tsx` (build inspector, next to the build view), `libs/gi/page-team/src/CharacterDisplay/Build/BuildTc.tsx` (TC build), locales `juanlab.json` it/en
- Test: `libs/gi/ui/src/juanlab/GcwebBuildDialog.test.tsx`, page-team tests for the two buttons

**Interfaces:**
- Consumes: Tasks 1–2; `useGcwebSettings`, `gcwebLink`.
- Produces: `<GcwebBuildButton input={() => GenInput} characterKey name />` (renders nothing when the gc-web link is off? — no: renders disabled with a tooltip pointing to Settings, so the feature is discoverable).
- [ ] **Step 1: Write the failing tests**: dialog lists 5 pieces (slot, set, main, level, 4 substats with value and roll count) and a table substat | target | generated | Δ for used substats; "Invia a gc-web" opens `gcwebLink(settings.url, payload)` (mock `window.open`); "Copia link" copies it; link off → disabled with the Settings hint; KQM inspector and TC build show the button; no DB writes (snapshot of storage before/after).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (TeamOptimize/DESIGN.md: labels, ⓘ tooltips, squares, gold only for the main action; WCAG 2.1 AA). **Step 4: Run** page-team + gi-ui suites; tsc page-team 42, gi-ui 2; biome clean.
- [ ] **Step 5: Commit** `gc-web: anteprima dei 5 manufatti e invio da KQM e build TC`.

### Task 4: Real check (controller)

- [ ] Production build served locally; gc-web's `public/` served locally (static) as the gc-web URL in Settings; user's save: Anastasya's KQM build (Tsaritsa team) and one TC build → preview → link opens gc-web, which shows the 5 pieces with no "rounded" problems and no "+N random upgrades"; it + en; axe on the dialog (3 themes), 360/390 px.
