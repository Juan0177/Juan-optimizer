# Build KQM / TC → 5 manufatti per gc-web — design

**Status:** approved by the user on 2026-11-18 (approach 1; +20 with 9 rolls).

## Intent
The user builds a team, runs KQM Theorycrafting, and wants to **test those builds on the private
server** (LunaGC, through gc-web). A KQM build is not five artifacts: it is main stats plus substat
totals counted in average rolls. This feature turns such a build into five artifacts that could
exist in the game, and sends them to gc-web with the link that already exists, so the user can give
them to the character on the server and play the build. Close is enough: "qualche virgola" off is
fine, the build must be essentially the same.

## Goals
- From a **KQM build** (KQM Theorycrafting results and KQM Compare's B) and from a **TC build**
  (GO's theorycraft loadout, incl. KQM builds saved as TC), generate 5 artifacts:
  - set pieces as the build says (4 + 1 off-piece, or 2 + 2), the off-piece's set: builder's call
    (any set that does not break the build's set bonuses);
  - slot, rarity and main stat exactly as the build (incl. 4★ pieces of 4★ sets);
  - level and roll count per piece as the server builds them: gc-web/LunaGC give a piece
    `appendNum (4) + floor(level/4)` rolls (`artifactRollLimits`, gc-web/public/commands.js) and fill
    missing rolls at random; so every generated piece carries exactly that many rolls (5★ +20: 9,
    4★ +16: 8), never fewer (no random upgrades). Main stats stay at 5★ +20 / 4★ +16 as KQM counts
    them (`kqmMainValues`). Chosen by the user (2026-11-18): +20 with 9 rolls, the extra rolls on substats the build does not use, at the lowest tier.
  - substats: at most 4 per piece, never the piece's main stat, at most 6 rolls per substat on a
    piece, each roll one of the game's 4 values for that substat and rarity (70/80/90/100% tiers),
    the totals as close as possible to the build's.
- Show, before sending, the 5 generated pieces and per substat the target vs generated total, with
  the difference (the user sees what "qualche virgola" means).
- **Send** one character's 5 pieces to gc-web with the existing link (`JuanLabBuild` v1,
  `libs/gi/ui/src/juanlab/gcweb.ts` `gcwebLink`), only when the gc-web link is enabled in Settings
  (same rule as the current "Invia a gc-web" button). gc-web is not changed.
- Italian and English, `juanlab` namespace.

- Rolls beyond the build's (KQMS: 40 rolls in 45 slots) go on substats the build does not use, at the
  lowest tier; rolls the pieces cannot hold (standards above 25 placed rolls: 30/40/50) are dropped
  from the least valuable stats and the preview shows the gap (my call: generate the closest, never
  refuse).
- "Used" substats: the ones the damage reads when the entry point knows them (the KQM problem's
  `scales`), else judged from the build: substats with placed rolls (TC: above their 2 fixed rolls),
  CRIT Rate/DMG, ER, the sands/goblet/circlet main stats that are substats (an ATK% sands counts
  ATK%, even with no placed rolls), and the flat HP/ATK/DEF of a counted HP%/ATK%/DEF%. The others
  are filler: their KQM fixed rolls are not targets (my call).
- Every substat's roll count must survive gc-web's read-back (`countsFor` returns the fewest-rolls
  combination for a value): the generator checks each value against gc-web's rule (reimplemented
  from its tier table, tested against gc-web's own function) and picks tier mixes that read back
  with the intended count.

## Non-goals
- Sending a whole team in one link (approach 2: later, if the user sends whole teams often).
- Changing gc-web, its format, or how it turns values into rolls.
- Writing the generated artifacts into Juan-optimizer's inventory.
- Weapon, talents, constellation (the link carries artifacts only, as today).

## Anti-goals
- A generated piece that cannot exist in the game (5 substats, substat = main stat, >6 rolls on
  one substat, a value no roll combination gives): gc-web would round or refuse it silently.
- A generated build far from the original without saying so (difference not shown).
- Any write to the database, team state or KQM results.

## Constraints (from the code)
- KQM build: `KqmBuild { weapon, sets, mains: { sands, goblet, circlet, off? }, rolls }`
  (`libs/gi/ui/src/util/teamOpt/kqm.ts`); `kqmValues(build)` gives totals; `kqmBuildRarity(build,
  rolls)` the 4★/5★ split and roll scale; KQMS = 2 fixed rolls on each of the 10 substats + N placed
  (the run's standard, `TeamOptKqm.rolls`, default 20); `KQM_SUBSTAT_ROLLS` = average roll values.
- TC `stats` are values (GO's TC solver divides them by `getSubstatValue`).
- TC build: `BuildTc.artifact = { slots: { [slot]: { level, statKey, rarity } }, substats: { type:
  'max'|'mid'|'min', stats: Record<SubstatKey, number>, rarity }, sets }`
  (`libs/gi/db/src/Database/DataManagers/BuildTcDataManager.ts`); the builder confirms whether
  `stats` are values or roll counts.
- Roll values per substat/rarity: GO's artifact data (`getSubstatValuesPercent` / substat roll
  tables in `@genshin-optimizer/gi/util` or stats); gc-web reads values as "the number the game
  shows" (10.5 for 10.5% CRIT Rate, 37 for +37 ATK) and recomputes tiers (`countsFor`,
  `gc-web/public/juanlab.js`, max 6 rolls per substat).
- Existing link and settings: `artifactsToPayload`, `gcwebLink`, `useGcwebSettings`,
  `SendToGcwebButton` (`libs/gi/ui/src/juanlab/GcwebLink.tsx`).
- Fork rules: branch `claude/vigilant-cannon-aqwxna`, PR to `juanlab` only; `TeamOptimize/DESIGN.md`;
  WCAG 2.1 AA.

## Approaches
1. **One character at a time, existing link (chosen by the user)**: a "Invia a gc-web" action on
   each KQM build (results tile/inspector, KQM Compare B) and on TC builds; gc-web unchanged.
2. Whole team in one link: needs a new payload format and a gc-web change. Later.
3. GOOD file download: not what the user needs (the target is the server via gc-web).

## Design
- **Generator** (pure, tested): `generateArtifacts(input) → { pieces: 5 × { setKey, slotKey,
  rarity, level, mainStatKey, substats: { key, rolls: tier[] , value }[] }, targets, totals, diff }`.
  Input normalised from a KQM build or a TC build: sets, per-slot main/rarity/level, substat targets
  (values), roll budget per piece. Search: place substats on pieces (respecting the constraints),
  then pick each roll's tier to bring each total closest to its target (low/high play); prefer
  exact matches on the stats that matter most for damage (CRIT, ER, ATK%/HP%/DEF%/EM by the build),
  junk substats (flat HP/ATK/DEF when not useful) fill the remaining slots at minimum tiers.
- **Preview dialog**: the 5 pieces (slot, set, main, 4 substats with value and rolls), and the table
  target / generated / Δ per substat; button "Invia a gc-web" (opens the link as today) and "Copia
  link". Disabled with a message when the gc-web link is off (pointer to Settings).
- **Entry points**: KQM Theorycrafting results (per member, in the build inspector), KQM Compare B's
  results (same component), character editor with a TC loadout (next to the existing button; for a
  TC loadout the existing button sends nothing useful today).

## Left to the builder
- The search algorithm (exhaustive over placements is small: 10 substats × 5 pieces; tiers per
  roll ≤ 4^6), as long as it is deterministic and fast (< 100 ms).
- Off-piece set choice; level per piece for non-KQMS budgets; exact dialog layout.

## Done when
- Unit tests: KQMS 5★ build → 5 legal pieces, each 9 rolls / +20 (no random upgrades in gc-web), totals within one lowest tier of
  each target; 4★ set build; a build whose target is not reachable (e.g. ER on ER sands + many rolls)
  → closest legal result with the difference reported; TC build with `type` max/mid/min; the payload
  passes gc-web's own `countsFor` exactly (values are exact tier sums) — tested by importing
  gc-web's function or reproducing its tier table.
- With the user's save: Anastasya's KQM build (Tsaritsa team) → preview → link opens gc-web with the
  5 pieces, gc-web reports no "rounded" problems; same from a TC build.
- No writes; typecheck/lint/tests pass; axe no violations on the dialog (three themes).
