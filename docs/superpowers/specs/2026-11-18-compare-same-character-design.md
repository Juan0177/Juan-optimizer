# KQM Compare: the same character in and out — short design

**Intent.** The user wants to compare one support at two constellations (or weapons) inside a team,
teammates locked: Tsaritsa team, Yae Miko C0 out → Yae Miko C1 in. KQM Theorycrafting cannot do it
without re-searching everyone and overwriting result A.

**Goals.**
- The "Entra" list also offers the leaving character (only it among the current members).
- When the entering character is the leaving one, the fragment is prefilled with its own actions in
  A's rotation (e.g. `E E E`), still editable; picking another character clears the prefill as today.
- Constellation, weapon/refinement (fixed or Auto), sets, KQM settings: as for any entering member.
- Overview, B's results section, card: wherever the swap is named, show `Yae Miko C0 → C1` (same
  name: the constellation change; when constellations are also equal, `Yae Miko → Yae Miko` with the
  differing weapon/sets as today).
- Italian and English strings (juanlab namespace).

**Non-goals / anti-goals.** No engine change beyond what the same key needs; the fixed members stay
exactly as in A; no writes to the database or saved team state (the sandbox copy only); the
different-character swap behaves exactly as today.

**Constraints (code).** `compare/KqmCompare.tsx` `candidates` filters out every member;
`compare/compareSwapKqm.ts` keys B's settings by character key (`swapEntry` deletes `out` then sets
`key`: same key works), `swappedTeamOpt` drops `attacks[out]` and `bonusStats[out]`, the sandbox
`swapSlot` creates a new team char for the key and points the slot at it (the user's own character
keeps its saved constellation; KQM reads `teamOpt.kqm.constellations`). `swapFragment` already finds
the step by name. Checks: whatever compares A's and B's members by key must treat the swapped slot
as the entering member, not as a fixed one.

**Approach.** Only one sensible way: let the same key through and fix the places that assume
`in !== out` (the alternative, a separate "constellation compare" mode, would duplicate the tab).

**Done when.** With the user's save: out Yae Miko (C0 in A), in Yae Miko C1, fragment prefilled
`E E E` → B runs, overview shows the C0 → C1 label, the three fixed members identical to A, card
downloads; the existing Yae → Mitya path unchanged; unit tests for same-key settings (constellation
set, attacks/bonusStats of the member kept or re-derived consistently) and for the prefill; typecheck,
lint, tests pass; storage identical before/after.

**Left to the builder.** Whether B should keep A's `attacks`/`bonusStats` entries for the same
character (my call: keep the bonus stats the user set for that character, re-derive attacks from the
rotation as for any entering member); label wording.
