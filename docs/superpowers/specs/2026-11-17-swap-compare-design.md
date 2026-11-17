# Confronto con un cambio (Team optimize) — design

## Intent
In Team optimize the user wants to ask "what if I swap this member for that one?" and see, without
saving anything, how the team changes. First case: the Tsaritsa team, Yae Miko (C1, Winter's Heavy
Heart) against Mitya (Wandering Evenstar). The two rotations are practically the same, only the
swapped member's slot differs, so comparing them by hand (two saved teams, two rotations) is
tedious.

The overview must show, for the team as saved (A) and the team with the swap (B), side by side:
- ER requirements (each member)
- the other teammates' damage (each member's damage and share)
- DPS
- DPR (damage per rotation)

and generate a comparison card (an image, to share).

## Goals
- Pick: the member who leaves, the character who enters (any character with a kit model, owned or
  not), its constellation, its weapon and refinement, its build.
- Rotation: the current rotation text with the leaving member's name replaced by the new one,
  editable before comparing (the new member's actions may differ: "Yae Miko E E E" → "Mitya E Q").
  The opener ("First rotation only") and timing of the team apply to both sides.
- Numbers for B computed by the same engine as the page: A's numbers in the comparison must equal
  those already shown on the page.
- Comparison card as a PNG (copy / download), in the style of the existing KQM team picture.

## Non-goals
- Saving the swapped team (no "save as team" for now; Duplica squadra already exists).
- Swapping more than one member at once.
- Optimizing builds for B (B uses the build given, nothing is searched).
- Changing side A: A is the team exactly as saved. To compare "Yae C1 + Winter's Heavy Heart",
  that build is set on the saved team.

## Anti-goals (a failure even if it works)
- Any write to the user's database or to the team's localStorage (rotation text, opener, timing,
  conditionals): the comparison is throwaway.
- A's numbers in the comparison differing from the page's.
- A wrong name substitution silently dropping the new member's steps (parse warnings must show).

## Constraints (from the code)
- Every damage path is keyed by a DB `teamId` (`teamOptMembers`, `getTeamDataWith` in
  `libs/gi/ui/src/util/teamOpt/data.ts`); the roster cannot be overridden in memory, but weapon,
  artifacts, constellation, talents and conditionals can (`TeamDataOverrides`, data.ts:196).
- The KQM workers already evaluate on a throwaway copy:
  `new ArtCharDatabase(dbIndex, new SandboxStorage(entries))` (`kqmBuildPool.ts`, `kqmBuildWorker.ts`).
- Rotation text → attacks: `kqmRotationReplay({ text, ... })` (`RotationWriter.tsx:531`) returns
  `{ attacks, rotationTime, energy }`; damage: `evaluateTeamRotation` (`solve.ts:208`) returns
  `total` (DPR) and `members` (per-member damage).
- ER: `calculateEnergyRecharge` (`energyCalc.ts:165`), fed by `syncEnergyCalculator` +
  `withRotationEnergy` with the replay's `energy`. Needs the character in `energyCalcData.json`.
- Card: canvas 2D, `renderKqmCard` / `shareStyle.ts` / `CardImageDialog` (`BuildCardButton.tsx:124`).
- Parser: names must belong to the members passed to `parseRotation`; unknown names are skipped
  with a warning.
- Fork rules: work on branch `claude/vigilant-cannon-aqwxna`, PR to `juanlab` of Juan0177/Juan-optimizer
  only, never to upstream GO or Stellar. Follow `TeamOptimize/DESIGN.md` (labels only, ⓘ tooltips,
  gold only for the main action, squares, WCAG 2.1 AA).

## Approaches
1. **Throwaway copy of the database (chosen).** Copy the DB into a `SandboxStorage`, swap the
   member in the copy under the same `teamId`, run replay + evaluation + ER on the copy, drop it.
   Same engine, nothing saved; costs one DB copy per comparison.
2. Teach the engine hypothetical rosters. Cleanest long term, but rewrites the core taken from
   Stellar: every future Stellar sync would conflict. Dropped.
3. Reuse KQM comparison. Only works with KQM standard builds on all four members, so the other
   three would lose the user's builds: does not answer the question. Dropped.

The user picked 1.

## Design
### Where
Team optimize, rotation panel: a button "Confronta un cambio" next to Export / Import. It opens a
dialog (full screen on phones).

### The dialog
```
Confronta un cambio                                         [x]
Esce  [Anastasya] [Yae Miko●] [Odette] [Danica]
Entra [Mitya ▾]  C[0▾]  Arma [Astro del vespro errante ▾] R[1▾]
Build ( ) salvata  (•) KQM standard
Rotazione
┌──────────────────────────────────────────────────────────┐
│Danica E -> Odette E E -> Mitya E E E -> Danica Q -> ...  │
└──────────────────────────────────────────────────────────┘
⚠ "Mitya E E E": ... (parser warnings, if any)
                                               [Confronta]
──────────────────────────────────────────────────────────
                     A: Yae Miko      B: Mitya       Δ
DPR                  5,19M            4,83M        −6,9%
DPS                  267,7K           239,3K       −10,6%
Tempo rotazione      19,4 s           20,2 s
Anastasya   danno    2,55M  49%       2,56M  53%   +0,4%
            ER       135%             150%
Yae → Mitya danno    1,45M  28%       0,96M  20%
            ER       120%             110%
Odette  ...
Danica  ...
                                           [Crea card]
```
- Build of the entering character: "salvata" = its equipped build if it is in the database (with
  a TC/build the team would use), else disabled; "KQM standard" = `kqmWeaponData` +
  `kqmArtData` for the chosen weapon (default).
- The weapon list defaults to the character's weapon type; constellation default C0.
- Rotation box prefilled from `teamOptRotationText_<teamId>` with the leaving member's localized
  name (and key/nickname forms the parser accepts) replaced by the entering one's name.
- "Confronta" runs; the dialog stays usable while it runs (progress, cancel on close).
- Δ: green for gains, red for losses (status colours only), with sign and percent; numbers
  tabular and right-aligned.
- ER rows: the requirement each member needs for the rotation (the ER calculator's target).

### The card
Canvas picture, in the style of `renderKqmCard`: team name, A vs B columns with avatars, DPR, DPS,
rotation time, each member's damage/share and ER, the rotation text of B, "Juan-optimizer" mark.
Shown in `CardImageDialog` (copy / download PNG).

### Computation (one function, testable without UI)
`compareSwap(database, teamId, { out, in: { key, constellation, weapon, refinement, build },
text })` →
`{ a: SideResult, b: SideResult, warnings }`, with
`SideResult = { dpr, dps, rotationTime, members: { key, damage, share, er }[] }`.
- A: the page's own evaluation inputs (same call as `useCurrentEvaluation`) on the real database,
  plus the ER calculation.
- B: sandbox copy → add the character if missing (level 90, talents 9/9/9 or the KQM standard
  talents) → new team char → replace the `loadoutData` slot → replay the edited text →
  `evaluateTeamRotation` with overrides for the entering member (weapon, arts, constellation) →
  ER.
- Strings: new i18n keys under the `juanlab` namespace (Italian and English).

## Left to the builder
- Main thread or a worker for the sandbox evaluation (worker if the KQM pool can be reused
  cheaply; the UI must not freeze for more than a moment on a large DB).
- Exact talent levels for a character that is not owned (match what KQM mode assumes).
- Which conditionals the entering member starts with (the replay already puts buff states on each
  attack; anything else stays off).
- Name-substitution details for nicknames.
- Card layout details, as long as it reads in both themes' colours and at phone size.

## Done when
- With the user's save (`Tsaritsa - Yae - Odette - Danica`), swapping Yae Miko for Mitya
  (C0, Wandering Evenstar R1, KQM standard) and the rotation
  `Danica E -> Odette E E -> Mitya E Q -> Danica Q -> Anastasya hE N2 Q N5 E E E N2` shows A equal
  to the page's numbers and B's DPR, DPS, shares and ER; the card downloads.
- The database and the team's localStorage are byte-identical before and after.
- Unit tests for name substitution and for "no writes"; typecheck, lint and the page's tests pass;
  axe shows no violations in the dialog (all three themes).
