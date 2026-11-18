# Card dettagliata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Normale | Dettagliata" switch on the KQM team card and the KQM Compare card; the detailed view adds, under each member's weapon and sets, its three main stats and eight out-of-combat final stats.

**Architecture:** A pure helper computes a KQM build's out-of-combat stats from the character alone (`getCharDataBundle` + `uiDataForTeam` with one member, no conditionals, no bonus stats). The card data gains optional per-member `details`; `drawKqmCard` draws a block under the gear rows only when details are present, so the normal card is unchanged. Both dialogs get the switch in `CardImageDialog`'s `header` slot.

**Tech Stack:** React + MUI, TypeScript, canvas 2D, vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-11-18-detailed-card-design.md`

## Global Constraints

- Branch `claude/vigilant-cannon-aqwxna`; PR to `juanlab` of Juan0177/Juan-optimizer only (never upstream GO or Stellar).
- The normal card is pixel-identical: `renderKqmCard.test.ts` hashes `'8456ee12'`, `'652245f7'` unchanged.
- Out of combat = the character alone at level 90 / ascension 6, the run's constellation, KQM talents, KQM weapon and artifacts (`kqmWeaponData`, `kqmArtData`), no conditionals, no teammates, no resonance, no bonus stats.
- Stats shown, in this order: HP, ATK, DEF, Elemental Mastery, CRIT Rate, CRIT DMG, Energy Recharge, the character's element DMG Bonus. Main stats: sands, goblet, circlet.
- Comparison card: marks (existing "changed" tone, `prima → dopo`) only in B's swapped slot and only when the same character enters (`out === in` key); a different entering character shows plain values; fixed members never marked.
- All text and numbers in the site's language (it/en), Italian decimal comma, official Italian stat names (keymap / `statName`).
- No writes to the database or team state. The view choice is remembered in localStorage (`juanlab-kqmCardView`, values `normal` | `detailed`, default `normal`), wrapped in try/catch.
- Commit messages in Italian with the session trailer given in the brief.

## Review Focus

- A member whose build is missing (kept member, no build): its block is omitted or shows "—", the card still renders. (Task 2 test)
- A 4★-set build (4★ pieces): main stat values and totals use the build's rarity (`kqmBuildRarity`). (Task 1 test)
- Physical/other goblet (e.g. ATK% goblet): the element DMG Bonus line still shows the character's element value (0 if none). (Task 1 test)
- Long Italian labels ("Ricarica di energia", "Bonus DAN Electro") at card size: no overlap with values. (Task 2 test: measured width ≤ column)
- Switching view twice returns the identical normal image (cache/state). (Task 3 test)

---

### Task 1: Out-of-combat stats helper

**Files:**
- Create: `libs/gi/ui/src/util/teamOpt/kqmStats.ts` (export from the teamOpt index like its neighbours)
- Test: `libs/gi/ui/src/tests/kqmStats.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type KqmStatKey = 'hp' | 'atk' | 'def' | 'eleMas' | 'critRate_' | 'critDMG_' | 'enerRech_' | `${ElementKey}_dmg_` | 'physical_dmg_'
  export interface KqmMemberStats {
    mains: { sands: MainStatKey; goblet: MainStatKey; circlet: MainStatKey }
    stats: { key: KqmStatKey; value: number }[] // 8 entries, the order above; percents as fractions (0.705)
  }
  export function kqmOutOfCombatStats(
    database: ArtCharDatabase,
    characterKey: CharacterKey,
    build: KqmBuild,
    { constellation, talent }: { constellation: number; talent: number }
  ): KqmMemberStats | undefined
  ```

- [ ] **Step 1: Write the failing tests** (use the existing KQM test fixtures/helpers in `libs/gi/ui/src/tests/kqm.test.ts` for a database with a character):
  - `it('reads the eight stats in order for a KQM build')`: keys equal the order above with the character's element DMG key; values finite.
  - `it('matches a hand sum')`: for one build, ATK = (char base ATK at 90/6 + weapon base ATK at 90/6) × (1 + ATK% from weapon secondary, sands, set 2pc and rolls) + flat ATK — compute the expected value in the test from the stat data (`getCharStat`, weapon stat data, `kqmValues(build)`), write the sum as a comment; same for CRIT Rate (5% base + char ascension stat if CRIT + weapon + rolls + circlet).
  - `it('ignores conditionals and teammates')`: same result when the database's team char has conditionals on / when called for a member of a 4-member team; a weapon whose passive is conditional does not change ATK.
  - `it('uses the build rarity for 4★ sets')` and `it('shows the element DMG Bonus with a non-elemental goblet')`.
- [ ] **Step 2: Run** `npx vitest run libs/gi/ui/src/tests/kqmStats.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** with `getCharDataBundle(database, false, 0, charInfo, kqmWeaponData(build.weapon, ck), kqmArtData(build))` where `charInfo` has level 90, ascension 6, the given constellation and talents, empty `conditional`, `bonusStats`, `customMultiTargets`, default `infusionAura`/`hitMode`/`reaction`/`enemyOverride`; then `uiDataForTeam({ [ck]: bundle.data }, database.gender, ck)[ck].target` and read `input.total.*` for each key.
- [ ] **Step 4: Run** the test file → PASS; `npx vitest run libs/gi/ui` → no new failures.
- [ ] **Step 5: Commit** `Card dettagliata: statistiche fuori combattimento di una build KQM`.

### Task 2: Card data details and drawing

**Files:**
- Modify: `libs/gi/ui/src/components/character/buildCard/renderKqmCard.tsx` (`KqmCardMember`, `drawKqmCard`, `kqmCardHeight`), `renderKqmCompareCard.tsx` (heights of the two halves)
- Test: `libs/gi/ui/src/components/character/buildCard/renderKqmCard.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly (labels and values arrive formatted).
- Produces:
  ```ts
  export interface KqmCardDetails {
    mainsTitle: string; statsTitle: string
    mains: { slot: string; stat: string }[]             // 3 rows, localized
    stats: { label: string; value: string; was?: string }[] // 8 rows; `was` = A's value → drawn "was → value" in the changed tone
  }
  // KqmCardMember gains: details?: KqmCardDetails
  ```
- [ ] **Step 1: Write the failing tests**: existing hashes `'8456ee12'`, `'652245f7'` unchanged (normal data); `kqmCardHeight(dataWithDetails) > kqmCardHeight(data)`; a detailed draw-call hash pinned after implementation (new constant); a row with `was` draws the changed tone fill; long labels: every label's measured width + value width ≤ column width (mock canvas measure as the existing tests do); a member without `details` in a detailed card draws its column empty without throwing.
- [ ] **Step 2: Run** `npx vitest run libs/gi/ui/src/components/character/buildCard/renderKqmCard.test.ts` → new tests FAIL.
- [ ] **Step 3: Implement**: block directly under the set row of each member column, same column bounds and hairlines as the card; title rows small/secondary, label left, value right, tabular numbers; the right-hand table and the rotation/notes rows move down only by the block's height (layout as in the approved preview `scratchpad` mock: block under the gear, table unchanged at top). Shrink-to-fit labels with the existing `maxWidth`/`minSize` helper if they would overlap.
- [ ] **Step 4: Run** the file → PASS; record the new hash in the test.
- [ ] **Step 5: Commit** `Card dettagliata: blocco statistiche nella card KQM`.

### Task 3: Team card switch (KQM Theorycrafting)

**Files:**
- Modify: `libs/gi/page-team/src/TeamOptimize/kqmTeamCard.ts` (`KqmTeamCardMember` gains optional `stats?: KqmMemberStats`; `kqmTeamCardData` builds `details` when given), `libs/gi/page-team/src/TeamOptimize/KqmShareMenu.tsx` (`TeamPicture`: switch, stats, record)
- Locales: `libs/gi/localization/assets/locales/{it,en}/page_team.json` — `teamOpt.card.view.normal` "Normale"/"Normal", `teamOpt.card.view.detailed` "Dettagliata"/"Detailed", `teamOpt.card.view.label` "Vista della card"/"Card view", `teamOpt.card.mains` "Statistiche principali"/"Main stats", `teamOpt.card.outOfCombat` "Statistiche (fuori combattimento)"/"Stats (out of combat)"; slot names reuse `teamOpt.kqm.sands|goblet|circlet`.
- Test: `libs/gi/page-team/src/TeamOptimize/kqmTeamCard.test.ts`

**Interfaces:**
- Consumes: Task 1 `kqmOutOfCombatStats`, `KqmMemberStats`; Task 2 `KqmCardDetails`.
- Produces: `export function kqmCardDetails(t: TFunction, stats: KqmMemberStats, locale: string | undefined, was?: KqmMemberStats): KqmCardDetails` in `kqmTeamCard.ts` (used by Task 4) — formats values (percent with one decimal, flat as integers, locale separators), stat names via `statName`, element bonus label from keymap; `was` sets each row's `was` only where the formatted strings differ.
- [ ] **Step 1: Write the failing tests**: `kqmCardDetails` in it → `"70,5%"`, `"2.315"`, Italian names; in en → `"70.5%"`, `"2,315"`; `was` only on differing rows; `kqmTeamCardData` without stats → members have no `details` (normal card data identical to before: deep-equal snapshot of the existing test's output).
- [ ] **Step 2: Run** `npx vitest run libs/gi/page-team/src/TeamOptimize/kqmTeamCard.test.ts` → FAIL.
- [ ] **Step 3: Implement**; in `TeamPicture` add the `header` switch (MUI ToggleButtonGroup or the project's Segmented, labelled by `teamOpt.card.view.label`, keyboard-operable), read/write `juanlab-kqmCardView` (try/catch), compute stats with `kqmOutOfCombatStats(database, ck, result.builds[ck], { constellation: s.cons(ck), talent })` only when detailed, pass to `kqmTeamCardData`; `aspectRatio` from the detailed height when detailed; the hidden record (`shareRecord`) includes `view`.
- [ ] **Step 4: Run** the page-team tests → PASS; tsc page-team = 42 errors (baseline); biome clean on touched files.
- [ ] **Step 5: Commit** `Card dettagliata: scelta Normale/Dettagliata nella card squadra KQM`.

### Task 4: Compare card switch (KQM Compare)

**Files:**
- Modify: `libs/gi/page-team/src/TeamOptimize/compare/compareCardData.ts`, `compare/CompareCardButton.tsx`
- Test: `compare/compareCardData.test.ts`, `compare/KqmCompare.test.tsx` (dialog switch)

**Interfaces:**
- Consumes: Task 1, Task 3 `kqmCardDetails`, the same locale keys.
- Produces: `CompareCardContext` gains optional `statsA?: Partial<Record<CharacterKey, KqmMemberStats>>` and `statsB?: …`; `compareCardData` adds `details` to both halves when given.
- [ ] **Step 1: Write the failing tests**: with stats → both halves' members have `details`; marks (`was`) only on B's swapped member and only when `ctx.out === ctx.in`; a different character entering → no `was` anywhere; fixed members → no `was` even if (artificially) values differ; without stats → output deep-equals today's.
- [ ] **Step 2: Run** `npx vitest run libs/gi/page-team/src/TeamOptimize/compare` → FAIL.
- [ ] **Step 3: Implement**; `CompareCardButton` gets the same switch and storage key; A's stats from the user's database with A's builds and constellations, B's from the comparison's `sandbox` with B's builds and constellations.
- [ ] **Step 4: Run** page-team tests → PASS; tsc 42; biome clean.
- [ ] **Step 5: Commit** `Card dettagliata: scelta Normale/Dettagliata nella card del confronto`.

### Task 5: Real-data check (controller)

- [ ] Production build served locally; user's save: KQM team card (Tsaritsa C0 + Alba argentea, Mitya C1, Danica Trapasso ululante) and Compare card (Yae C0 → C1; Yae → Mitya C1) in both views, it + en; hand-check one member's ATK and CRIT Rate against the helper's formula; normal cards identical to before; axe on both dialogs (three themes); dialog at 360/390 px without horizontal overflow.
