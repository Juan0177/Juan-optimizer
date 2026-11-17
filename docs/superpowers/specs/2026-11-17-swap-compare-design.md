# KQM Compare (Alpha) — design

## Intent
The user wants to ask "what if I swap this member for that one?" and see how the team changes, in
KQM terms (every member on a KQM build), without saving anything. First case: the Tsaritsa team,
Yae Miko (C1, Winter's Heavy Heart) against Mitya (Wandering Evenstar). The two rotations are the
same except for the swapped member's slot, so doing it by hand (two teams, two rotations, two KQM
runs) is tedious.

The overview shows, for team A (as is) and team B (with the swap), side by side:
- ER requirements (each member)
- the other teammates' damage (each member's damage and share)
- DPS
- DPR (damage per rotation)

and generates a comparison card (an image, to share).

## Goals
- A new tab **"KQM Compare"** with an **Alpha** tag, next to "KQM Theorycrafting" (Beta), in the
  team page's tab row. Its own code; the existing tabs keep working exactly as they do.
- First thing asked: the member who leaves and the character who enters (any character with a kit
  model, owned or not), with the entering one's constellation, weapon and refinement.
- Build of the entering character: **KQM** (searched by the KQM engine, like the others) or one of
  its **existing builds** (equipped, saved builds, TC builds), chosen from a list; the weapon is the
  build's.
- **A is KQM Theorycrafting's own result.** KQM Compare does not ask for a rotation or settings:
  it uses what is in KQM Theorycrafting (its rotation, its settings and its last result, saved in
  `database.teamKqmResults`). Before anything runs, the user **confirms that the data in KQM
  Theorycrafting are final** (the confirmation shows when that result was found). No KQM result
  yet: a message pointing to KQM Theorycrafting, nothing runs.
- KQM Compare asks only:
  - the member who leaves and the character who enters (+ constellation, weapon, build);
  - the **fragment**: only the entering member's actions (e.g. `E Q`), replacing the leaving
    member's single step in KQM Theorycrafting's rotation (e.g. `Yae Miko E E E` → `Mitya E Q`).
    B's resulting rotation is shown with the replaced step highlighted.
  - Works only when the leaving member appears **once** in the rotation (one step, one place,
    opener included). Otherwise: a clear message, nothing runs.
- Computation: **one** KQM run, for B, with KQM Theorycrafting's settings and the rotation with
  the fragment, searching every member's build (the entering member's too, unless an existing
  build was chosen). A is not rerun.
- Overview A vs B with Δ, and a card as a PNG (copy / download).

## Non-goals
- Changing KQM Theorycrafting, Team optimize or the KQM engine's behaviour for them.
- Saving team B, or swapping more than one member.
- Members who appear more than once in the rotation (refused, see above).

## Anti-goals (a failure even if it works)
- Any write to the user's database or to the team's saved state (`teamOpt`, `teamOpt.kqm` results,
  rotation text/opener/timing in localStorage). KQM Compare keeps its runs in memory.
- KQM Theorycrafting results changing because KQM Compare ran.
- A fragment silently landing in the wrong place, or parse warnings hidden.

## Constraints (from the code)
- Every damage path is keyed by a DB `teamId` (`teamOptMembers`, `getTeamDataWith` in
  `libs/gi/ui/src/util/teamOpt/data.ts`); the roster cannot be overridden in memory. The KQM
  workers already run on a throwaway copy: `new ArtCharDatabase(dbIndex, new SandboxStorage(entries))`
  (`kqmBuildPool.ts`, `kqmBuildWorker.ts`). B uses such a copy with the slot swapped (same `teamId`).
- KQM run: `runKqm` / `optimizeTeamKqm` (`kqm.ts`) returns `KqmResult`: `after` (DPR = `total`,
  per-member damage), `energyRecharge[ck] = { target, minimum, value }`, `played.rotationTime`,
  `builds`, `constellations`. `kqmRotationReplay` (`RotationWriter.tsx:531`) turns the text into
  attacks with KQM gear.
- Rotation text: `parseRotation(text, names)` (`rotation/parse.ts`); names must be the team's
  members; unknown names are skipped with a warning.
- Card: canvas 2D, `renderKqmCard` / `shareStyle.ts` / `CardImageDialog` (`BuildCardButton.tsx:124`),
  as in `TeamPicture` (`KqmShareMenu.tsx`).
- Fork rules: branch `claude/vigilant-cannon-aqwxna`, PR to `juanlab` of Juan0177/Juan-optimizer only,
  never to upstream GO or Stellar. Follow `TeamOptimize/DESIGN.md` (labels only, ⓘ tooltips, gold
  only for the main action, squares) and WCAG 2.1 AA.

## Approaches
1. **Throwaway copy of the database (chosen)**, now inside its own KQM Compare tab: A on the team
   as is, B on a sandbox copy with the slot swapped; both through the KQM engine.
2. Teach the engine hypothetical rosters: rewrites the core taken from Stellar, every future sync
   would conflict. Dropped.
3. Reuse the KQM Theorycrafting comparison as is: no swap, no existing-build choice. Dropped; its
   KQM approach is kept inside approach 1.

The user picked 1, as a separate Alpha tab so nothing that works is touched.

## Design
### Tab
`KQM Compare` + `Alpha` chip, after `KQM Theorycrafting` (Beta). Shown in KQM mode's place in the
team page; its route is its own (e.g. `.../kqm-compare`).

### Screen
```
Esce  [Anastasya] [Yae Miko●] [Odette] [Danica]
Entra [Mitya ▾]  C[0▾]  Arma [Astro del vespro errante ▾] R[1▾]
Build (•) KQM  ( ) esistente [— ▾]
Frammento di Mitya  [E Q            ]   (replaces "Yae Miko E E E")
 B  Danica E -> Odette E E -> [Mitya E Q] -> Danica Q -> …
⚠ messages (no KQM result; leaving member found 0 or 2+ times; parse warnings)

[✓] I dati in KQM Theorycrafting sono definitivi (risultato del 17/11, 14:32)
                                                  [Confronta]
────────────────────────────────────────────────────────────
                     A: Yae Miko      B: Mitya       Δ
DPR                  …                …            −x%
DPS                  …                …            −x%
Tempo rotazione      19,4 s           20,2 s
Anastasya   danno    …  49%           …  53%       +x%
            ER       135%             150%
Yae → Mitya danno    …  28%           …  20%
            ER       120%             110%
Odette  …
Danica  …
                                                [Crea card]
```
- Run shows progress for B; leaving the tab cancels.
- Δ in status colours (gain/loss) with sign and percent; numbers tabular, right-aligned.
- ER = the KQM result's `energyRecharge[ck].target` for each side.
- Strings in the `juanlab` namespace (Italian and English).

### Card
Canvas picture in the style of `renderKqmCard`: team name, A vs B with avatars, DPR, DPS,
rotation time, each member's damage/share and ER, both rotations, "Juan-optimizer" mark;
`CardImageDialog` for copy / download.

### Computation (one function, testable without UI)
`compareSwapKqm(database, teamId, { out, in: { key, constellation, weapon, refinement, build:
'kqm' | buildRef }, text, fragment, settings })` → `{ a: Side, b: Side, warnings }`,
`Side = { dpr, dps, rotationTime, members: { key, damage, share, er, build }[] }`.
- Fragment: find the leaving member's single step in KQM Theorycrafting's rotation text (via the
  parser, so names, nicknames and the opener are handled), replace it with
  `<entering name> <fragment>`.
- A: read KQM Theorycrafting's saved result (`teamKqmResults.getRun(teamId)`), read only.
- B: sandbox copy → add the character if missing → new team char → swap the `loadoutData` slot →
  KQM run with the edited text; an existing build is held fixed for the entering member.

## Left to the builder
- Worker vs main thread (reuse the KQM pool if cheap; the UI must stay responsive).
- How KQM settings (standard, ER calculator settings, etc.) are taken: the team's saved KQM
  settings, read only; the entering member inherits the leaving member's field time.
- Talent levels for a character that is not owned (match KQM mode).
- Holding one member's existing build fixed in a KQM run: if the KQM engine cannot do it without
  changing its code paths, ship KQM-only first and say so.
- Card layout details (both themes' colours, phone size).

## Done when
- With the user's save (`Tsaritsa - Yae - Odette - Danica`), out Yae Miko, in Mitya (C0, Wandering
  Evenstar R1, KQM), after a KQM Theorycrafting run with `Danica E -> Odette E E -> Yae Miko E E E
  -> Danica Q -> Anastasya hE N2 Q N5 E E E N2`, fragment `E Q`: the overview shows A and B with DPR, DPS,
  shares and ER; the card downloads.
- A rotation where the leaving member appears twice is refused with a message.
- "Confronta" stays disabled until the user confirms KQM Theorycrafting's data are final, and
  with no KQM result it says to run KQM Theorycrafting first; A's numbers equal KQM
  Theorycrafting's.
- The database, `teamOpt` and the team's localStorage are identical before and after; KQM
  Theorycrafting shows the same results as before.
- Unit tests: fragment substitution (once / zero / twice / nickname / opener), no writes;
  typecheck, lint and existing tests pass; axe shows no violations on the tab (three themes).
