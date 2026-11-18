# Card dettagliata (detailed KQM cards) — design

## Intent
The user shares KQM cards (KQM Theorycrafting's team card, KQM Compare's comparison card) and wants
whoever looks at one to see each character's build at a glance, not only weapon and sets: the three
main stats and the character's final stats, like the in-game character screen or Enka/Akasha cards.
The usual card stays as it is; the detailed one is a second view of the same picture.

## Goals
- A switch **Normale | Dettagliata** in the card dialog of:
  - KQM Theorycrafting's team card (`KqmShareMenu.tsx`, `TeamPicture`, `renderKqmCard`);
  - KQM Compare's comparison card (`compare/CompareCardButton.tsx`, `renderKqmCompareCard`).
- Detailed view: under each member's weapon and sets, a block with
  - one line with the three main stats: sands, goblet, circlet (e.g. `Sabbie ATT% · Calice DAN Cryo ·
    Corona DAN CRIT`);
  - the final stats, out of combat: HP, ATK, DEF, Elemental Mastery, CRIT Rate, CRIT DMG, Energy
    Recharge, the character's element DMG Bonus.
- Comparison card: the block in both halves (A and B). In B, a value that differs from A is marked
  with the card's existing "changed" tone **only when both sides have the same character in that
  slot**: the fixed members (so re-tuned teammates show) and the swapped slot when the same
  character enters (e.g. Yae Miko C0 → C1). When a different character enters (Yae Miko → Mitya),
  its stats are shown plain, with no comparison marks (user: comparing two different characters'
  stats makes no sense).
- Every text and number in the site's language (Italian/English), decimal comma in Italian, like the
  rest of the cards.
- Download/copy, file name and hidden record work as today; the hidden record says which view it is.

## Non-goals
- Changing the normal card (pixel-identical: the draw-call hash test `renderKqmCard.test.ts` stays
  green unchanged).
- Stats with team buffs, rotation states or per-attack values.
- Other cards (character build card, Team optimize card, constellation/compare charts).
- Substat roll counts or substat values (the user chose final stats).

## Anti-goals
- A number on the card that disagrees with how the KQM result was calculated (same level 90, weapon,
  artifacts, constellation and talents as the run).
- Any write to the database or team state to produce the stats.
- Text cut off or overlapping in the detailed view, in either language.

## Definitions
**Out of combat** = what the in-game character screen shows: the character alone at level 90 /
ascension 6 with the run's constellation and KQM talents, its KQM weapon and five KQM artifacts
(main stats + fixed and distributed rolls), the set 2-piece bonuses and weapon/set stats that need no
condition. No conditional effects (weapon passives that need a trigger, 4-piece bonuses with a
condition, constellation conditionals), no teammates' buffs, no elemental resonance, no extra buffs
from KQM settings. (Resonance excluded: my call, so a member's stats do not change with the team.)

## Constraints (from the code)
- KQM builds: `KqmBuild { weapon, sets, mains, rolls }` (`libs/gi/ui/src/util/teamOpt/kqm.ts`).
  `kqmArtData(build)` / `kqmWeaponData(build.weapon, ck)` turn one into calculation data;
  `kqmTeamOverrides` shows how a page computes a result's builds (`getTeamDataWith` in
  `teamOpt/data.ts`, with `arts`, `weapons`, `characters` overrides). The out-of-combat stats use the
  same overrides for that member without `extraConditionals`, `conditionalOverrides`, `bonusStats`,
  and with conditionals and teammates' contributions off.
- KQM Compare's B lives on a sandbox database (`compareSwapKqm` returns `sandbox`, `resultB`); B's
  stats are computed on that sandbox, A's on the user's database.
- Card data builders: `kqmTeamCardData` (`kqmTeamCard.ts`), `compareCardData.ts`; drawing in
  `renderKqmCard.tsx` (`drawKqmCard`, `kqmCardHeight`) and `renderKqmCompareCard.tsx`.
- Dialog: `CardImageDialog` has a `header` slot (used for view tabs in the constellation picture);
  the switch goes there.
- Main-stat value labels exist in `KqmBuildView.tsx` (`mainStatLabel`, `artifactStatValue`); stat
  names from `statName`/keymap (Italian already official).
- Fork rules: branch `claude/vigilant-cannon-aqwxna`, PR to `juanlab` of Juan0177/Juan-optimizer only.
  `TeamOptimize/DESIGN.md` (labels, squares, gold only for the main action) and WCAG 2.1 AA for the
  dialog control.

## Approaches
1. **Second view of the same card (chosen)**: an optional `details` per member in the card data;
   the renderer adds a block under the sets when present and grows the card's height. The switch in
   the dialog picks which data is drawn. One renderer, the normal card untouched when `details` is
   absent.
2. A separate detailed card renderer: duplicates the layout code of both cards; every future change
   to the card would be made twice. Dropped.
3. A second picture appended under the card (stats sheet): two images to share, not "at a glance".
   Dropped.

## Design
### Dialog
```
Card squadra                       [Normale | Dettagliata]
┌──────────── preview ────────────┐
│ ...                              │
└──────────────────────────────────┘
                     [Copia] [Scarica]
```
The last choice is remembered in the browser (localStorage, per-viewer convenience); default
Normale. Switching re-renders the preview.

### Member block (detailed)
```
│ Visione di giada R1        │
│ Disincanto nell'ombra prof.│
├────────────────────────────┤
│ Sabbie ATT%                │
│ Calice DAN Cryo            │
│ Corona DAN CRIT            │
├────────────────────────────┤
│ PS            18.420       │
│ ATT            2.315       │
│ DIF              812       │
│ ME                80       │
│ Tasso CRIT     68,4%       │
│ DAN CRIT      172,0%       │
│ Ricarica      128,0%       │
│ Bonus DAN Cryo 61,6%       │
```
Stat icons optional (builder's call, if they read at card size). Labels short enough for the member
column in both languages (e.g. "Ricarica" for Energy Recharge if the full name does not fit).
The table on the right (damage, share, field, ER) and the rotation/notes rows stay as they are; the
card simply gets taller.

## Left to the builder
- Where the stats are computed (page hook vs a pure helper in `teamOpt`) and on which thread; the
  dialog may show its placeholder while they compute.
- Exact typography, spacing, icons; column width checks for long names (both languages).
- How the ER shown in the stats relates to the table's ER column (the table keeps the run's value;
  the stats block shows the out-of-combat value; if they can differ, say so in a card note).

## Done when
- With the user's save (`Tsaritsa - Yae - Odette - Danica`): KQM Theorycrafting team card and a
  KQM Compare card (Yae → Mitya) download in both views, Italian and English; the detailed view shows
  the three main stats and the eight final stats for every member (both halves of the comparison);
  values checked by hand against the character page with the same build for one member.
- The normal card is pixel-identical (existing hash test unchanged).
- Unit tests for the stats helper (one known build → expected values) and for the card data with
  details; typecheck, lint, tests pass; axe no violations on the dialog (three themes); no overflow at
  360/390 px in the dialog.
