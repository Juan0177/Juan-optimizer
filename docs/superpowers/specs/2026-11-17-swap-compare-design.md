# KQM Compare (Alpha) — design

## Intent
The user compares supports inside a team: "what does KQM Theorycrafting say if this member is
replaced by that one?". It is KQM Theorycrafting with only the entering character changed. First
case: the Tsaritsa team, Yae Miko (C1, Winter's Heavy Heart) against Mitya (Wandering Evenstar).

The overview shows, for team A (KQM Theorycrafting's result) and team B (with the swap), side by
side:
- ER requirements (each member)
- the other teammates' damage (each member's damage and share)
- DPS
- DPR (damage per rotation)

and generates a comparison card (an image, to share).

## Goals
- A new tab **"KQM Compare"** with an **Alpha** tag, after "KQM Theorycrafting" (Beta). Its own
  code and route; the existing tabs keep working exactly as they do.
- **A = KQM Theorycrafting's last result** (saved in `database.teamKqmResults`), read only. Before
  anything runs, the user **confirms that the data in KQM Theorycrafting are final** (the
  confirmation shows when that result was found). No KQM result yet: a message pointing to KQM
  Theorycrafting, nothing runs.
- **Fixed members are locked**: the three who stay keep exactly A's KQM builds, constellations and
  settings; shown, not editable.
- **The entering member is entirely unlocked**: who it is (any character with a kit model, owned
  or not), constellation, weapon and refinement, artifact sets, and its own KQM settings (the same
  per-member options KQM Theorycrafting offers, e.g. its ER calculator inputs). Weapon and sets can
  each be a fixed choice or left to the KQM search. Or: one of its **existing builds** (equipped,
  saved builds, TC builds), chosen from a list.
- **Fragment**: the user writes only the entering member's actions (e.g. `E Q`). They replace the
  leaving member's single step in KQM Theorycrafting's rotation (`Yae Miko E E E` → `Mitya E Q`).
  B's resulting rotation is shown with the replaced step highlighted. Works only when the leaving
  member appears **once** in the rotation (one step, one place, opener included); otherwise a clear
  message and nothing runs.
- **One KQM run, for B**: KQM Theorycrafting's settings and the rotation with the fragment; only
  the entering member is searched, its teammates' builds held fixed.
- Overview A vs B with Δ, and a card as a PNG (copy / download).

## Non-goals
- Changing KQM Theorycrafting, Team optimize, or how the KQM engine behaves for them.
- Re-searching the fixed members' builds for B.
- Saving team B; swapping more than one member; members appearing more than once in the rotation.

## Anti-goals (a failure even if it works)
- Any write to the user's database or to the team's saved state (`teamOpt`, `teamKqmResults`,
  rotation text/opener/timing in localStorage). KQM Compare keeps its run in memory.
- KQM Theorycrafting's results changing because KQM Compare ran.
- A fixed member's build, constellation or settings differing between A and B.
- A fragment silently landing in the wrong place, or parse warnings hidden.

## Constraints (from the code)
- Every damage path is keyed by a DB `teamId` (`teamOptMembers`, `getTeamDataWith` in
  `libs/gi/ui/src/util/teamOpt/data.ts`); the roster cannot be overridden in memory. The KQM
  workers already run on a throwaway copy: `new ArtCharDatabase(dbIndex, new SandboxStorage(entries))`
  with `entries = database.storage.entries` (`kqmBuildPool.ts:144`, `kqmBuildWorker.ts:20`). B runs on
  such a copy with the slot swapped (same `teamId`).
- `compareTeamKqm({ result, characterKey, weapon, sets, ...KqmRunArgs })` (`kqm.ts:1163`):
  "re-rank one member for a chosen weapon/set pair, keeping every teammate's build fixed".
  `KqmRunArgs.from` / `only` (`kqm.ts:1103-1137`): start from another run's builds, search only some
  members. `KqmResult` (`kqm.ts:213`): `after.total` (DPR), `after.members` (per-member damage),
  `energyRecharge[ck] = { target, minimum, value }`, `played.rotationTime`, `builds`,
  `constellations`. KQM constellations come from `teamOpt.kqm.constellations` (`kqm.ts:114`).
- Saved KQM run: `database.teamKqmResults.getRun(teamId)` → `{ savedAt, members, run }`
  (`TeamKqmResultsEntry.ts`); `useKqmRun.ts:66-90` shows how the page reads it back.
- Rotation: `kqmReplayOf(database, gender, i18n, teamId, teamOpt, text?)` (`useKqmRun.ts:184`) →
  `kqmRotationReplay` (`RotationWriter.tsx`), which reads the opener from localStorage
  (`teamOptRotationOpener_<teamId>`); `parseRotation(text, names)` (`rotation/parse.ts:285`).
- Card: canvas 2D, `renderKqmCard(KqmCardData)` / `shareStyle.ts` / `CardImageDialog`
  (`libs/gi/ui/src/components/character/buildCard/`), used as in `TeamPicture` (`KqmShareMenu.tsx`).
- Tabs: `TeamCharacterSelector.tsx:220-245` (KQM tab with `BetaBadge`), routes in
  `libs/gi/page-team/src/index.tsx` (`KQM_PATH`, `kqmRoute`, `kqmTheorycraftingEnabled`).
- Fork rules: branch `claude/vigilant-cannon-aqwxna`, PR to `juanlab` of Juan0177/Juan-optimizer only,
  never to upstream GO or Stellar. Follow `TeamOptimize/DESIGN.md` (labels only, ⓘ tooltips, gold
  only for the main action, squares) and WCAG 2.1 AA.

## Approaches
1. **Throwaway copy of the database (chosen)**, inside its own KQM Compare tab: A read from KQM
   Theorycrafting, B computed on a sandbox copy with the slot swapped, teammates fixed.
2. Teach the engine hypothetical rosters: rewrites the core taken from Stellar, every future sync
   would conflict. Dropped.
3. Reuse KQM Theorycrafting's comparison as is: it cannot swap the character. Dropped; its engine
   (`compareTeamKqm`, teammates fixed) is what approach 1 runs.

The user picked 1, as a separate Alpha tab so nothing that works is touched.

## Design
### Screen
```
KQM Compare  [Alpha]
A: risultato KQM Theorycrafting del 17/11, 14:32
Esce  [Anastasya🔒] [Yae Miko●] [Odette🔒] [Danica🔒]
Entra [Mitya ▾]  C[0▾]
      Arma [Astro del vespro errante ▾ | Auto] R[1▾]   Set [Auto ▾]
      Build (•) KQM  ( ) esistente [— ▾]
      Impostazioni KQM di Mitya ▸ (ER calculator inputs, …)
Frammento di Mitya  [E Q            ]
 B  Danica E -> Odette E E -> [Mitya E Q] -> Danica Q -> …
⚠ messages (no KQM result; leaving member found 0 or 2+ times; parse warnings)
[✓] I dati in KQM Theorycrafting sono definitivi
                                                  [Confronta]
────────────────────────────────────────────────────────────
                     A: Yae Miko      B: Mitya       Δ
DPR                  …                …            −x%
DPS                  …                …            −x%
Tempo rotazione      19,4 s           20,2 s
Anastasya🔒  danno   …  49%           …  53%       +x%
             ER      135%             150%
Yae → Mitya  danno   …  28%           …  20%
             ER      120%             110%
Odette🔒 …
Danica🔒 …
                                                [Crea card]
```
- Fixed members: their builds as in A (weapon, sets, constellation), shown read only.
- ER: `energyRecharge[ck].target` per side; when a fixed member's build no longer reaches B's
  target, the row says so (warning colour).
- Δ in status colours (gain/loss) with sign and percent; numbers tabular, right-aligned.
- Run shows progress; leaving the tab cancels. "Confronta" is disabled until the confirmation is
  ticked and the fragment is valid.
- Strings in the `juanlab` namespace (Italian and English).

### Card
Canvas picture in the style of `renderKqmCard`: team name, A vs B with avatars, DPR, DPS,
rotation time, each member's damage/share and ER, both rotations, "Juan-optimizer" mark;
`CardImageDialog` for copy / download.

### Computation (testable without UI)
- `swapFragment(text, opener, names, out, inName, fragment)` → `{ text, opener, replaced } |
  { error }`: finds the leaving member's single step (parser, so names/nicknames/opener are
  handled) and replaces it with `<inName> <fragment>`.
- `compareSwapKqm({ database, teamId, gender, i18n, saved, swap, onStep, isCancelled })` →
  `{ a: Side, b: Side }`, `Side = { dpr, dps, rotationTime, members: { key, damage, share, er,
  erValue, build }[] }`. A from `saved`; B: sandbox copy → add the character if missing → new team
  char → swap the `loadoutData` slot → set the entering member's KQM settings/constellation in the
  copy's `teamOpt.kqm` → one-member KQM search with teammates fixed, playing the swapped rotation.

## Left to the builder
- Which engine entry point searches one member with teammates fixed when weapon or sets are
  "Auto" (`compareTeamKqm` takes a fixed weapon/sets pair; `from` + `only` keeps weapons/sets).
  If "Auto" needs engine changes beyond small optional parameters, ship fixed weapon + sets first
  and say so.
- Holding an existing (inventory) build fixed for the entering member: same rule, ship KQM-only
  first if it needs engine changes.
- Passing the swapped opener to the replay (a small optional parameter on `kqmRotationReplay` /
  `kqmReplayOf`, default unchanged).
- Worker vs main thread (the UI must stay responsive); talent levels for a character not owned
  (match KQM mode); card layout details (both themes, phone size).

## Done when
- With the user's save (`Tsaritsa - Yae - Odette - Danica`), after a KQM Theorycrafting run with
  `Danica E -> Odette E E -> Yae Miko E E E -> Danica Q -> Anastasya hE N2 Q N5 E E E N2`: out
  Yae Miko, in Mitya (C0, Wandering Evenstar R1), fragment `E Q` → the overview shows A (equal to
  KQM Theorycrafting) and B with DPR, DPS, shares and ER; the fixed members' builds are identical
  on both sides; the card downloads.
- A rotation where the leaving member appears twice is refused with a message; no KQM result →
  message, nothing runs.
- The database, `teamOpt`, `teamKqmResults` and the team's localStorage are identical before and
  after.
- Unit tests: fragment substitution (once / zero / twice / nickname / opener), no writes, fixed
  members unchanged; typecheck, lint and existing tests pass; axe shows no violations on the tab
  (three themes).
