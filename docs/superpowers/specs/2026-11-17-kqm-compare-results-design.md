# KQM Compare — B's KQM results screen (addendum)

## Intent
After a comparison the user wants the same KQM screens KQM Theorycrafting shows, for team B:
"non vedo la schermata che mi fa il ranking delle armi, artefatti, scelta investimento (roll) kqm",
then, with a screenshot of KQM Theorycrafting's results: "Manca anche questo".

## Goals
- Under the A/B summary, a section with KQM Theorycrafting's results screen for **B**, the same
  components (`KqmResults` and what it renders), read only with respect to the user's data:
  - the setup line (constellation, ER, talents, artifact quality and rolls, weapons and sets
    counted, ER source, rotation played);
  - the four member tiles: DPS, share of team, ER, weapon and set icons, roll counts;
  - the selected member's build panel: stats, main stats, rolls, ER reached / required;
  - "Weapons" and "Artifact sets" rankings with Team DPS and "vs best", "Show all", "Copy as a table".
- Rankings are computed for the **entering member** (the only one searched); the fixed members
  show their locked builds (no rankings: theirs are KQM Theorycrafting's).
- Picking another weapon or set in the rankings (the inspector) recomputes **on B's sandbox**, never
  on the real team.
- The A/B summary still arrives first (as now); the rankings fill in after (like KQM Theorycrafting's
  preliminary → final), with progress; leaving the tab cancels.

## Non-goals / anti-goals
- No changes to KQM Theorycrafting's own screen or results; no writes to the user's DB, team
  storage or `teamKqmResults`.
- Do not let any B view call the engine with the real database for team B.

## Constraints
- Today the compare run stops right after `compareTeamKqm`'s preview (rankings skipped,
  `compareSwapKqm.ts:~568`), and the Auto path (`from` + `only`) produces no rankings by design
  (`kqm.ts` KqmRunArgs.from doc). Rankings for one member with teammates fixed need the engine's
  ranking pass for that member (any engine change only as optional parameters with unchanged
  defaults).
- `KqmResults` (KqmMode.tsx:1774) takes `teamId`, `members`, `result`, `runSettings`, … and its
  inspector compares through the engine with the page's database: B must pass the sandbox.

## Left to the builder
- How to keep the sandbox alive for the inspector (hold it in the run's state, drop on reset/leave).
- Whether KqmResults needs an optional `database` prop or a context provider swap.
