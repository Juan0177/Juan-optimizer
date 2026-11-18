# KQM Compare: same character in and out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In KQM Compare the leaving character can also be the entering one (e.g. Yae Miko C0 → C1), teammates locked.

**Architecture:** The engine already keys B's settings by character key; let `key === out` through the member check and keep that character's bonus stats. The tab offers the leaving character in "Entra", prefills its own fragment, and names the swap `Name C0 → C1`.

**Tech Stack:** React + MUI, TypeScript, vitest, i18next (`juanlab` namespace).

**Spec:** `docs/superpowers/specs/2026-11-18-compare-same-character-design.md`

## Global Constraints

- Branch `claude/vigilant-cannon-aqwxna`; PR to `juanlab` of Juan0177/Juan-optimizer only (never upstream GO or Stellar).
- No writes to the user's database, `teamOpt`, `teamKqmResults` or the team's localStorage (sandbox only).
- The different-character path (Yae Miko → Mitya) behaves exactly as today; existing tests unchanged.
- Strings in `libs/gi/localization/assets/locales/{it,en}/juanlab.json`, Italian with official game terms.
- Commit messages in Italian, ending with the session trailer lines given in the task brief.

## Review Focus

- Same character, same constellation, same weapon/sets ("nothing changes"): runs, label `Yae Miko → Yae Miko`, Δ ≈ 0, no crash. (Task 1 test)
- Picking the leaving character, then another, then back: fragment prefill follows the pick and never overwrites text the user typed for the current pick. (Task 2 test)
- A team member other than the leaving one is still refused (`inTeam`). (Task 1 test)
- Leaving member appearing 0 or 2+ times: prefill is empty and the existing refusal shows. (Task 2 test)
- The comparison card's badge and the overview row use the same label. (Task 2 test)

---

### Task 1: Engine accepts the same character

**Files:**
- Modify: `libs/gi/page-team/src/TeamOptimize/compare/compareSwapKqm.ts` (member check ~line 401; `swappedTeamOpt` bonusStats ~line 270)
- Test: `libs/gi/page-team/src/TeamOptimize/compare/compareSwapKqm.test.ts`

**Interfaces:**
- Produces: `compareSwapKqm` accepts `swapIn.key === out`; result shape unchanged.

- [ ] **Step 1: Write the failing tests** in the `compareSwapKqm` describe, using the file's `setup()`/`argsOf()`/`snapshot()` helpers:
  - `it('compares the leaving character with itself at another constellation')`: `swapIn: { ...MITYA, key: <argsOf(s).out>, constellation: 1 }` (fixed weapon/sets as MITYA's shape requires for that character — use the out member's weapon/sets from A's build) → no `error`; `b.members` has the out key with `constellation === 1`; every fixed member's `build` deep-equals A's; `snapshot(s)` unchanged.
  - `it('runs a same-character swap that changes nothing')`: same key, A's constellation, A's weapon/sets → no error; `b.dpr` within 0.5% of `a.dpr`.
  - Keep the existing `'refuses a character already in the team'` (Odette → `inTeam`) passing.
  - `it('keeps the character’s own bonus stats when it re-enters')`: base teamOpt with `bonusStats[out]` set → B's teamOpt (via the sandbox in the result) still has it; for a different entering character it is still dropped.
- [ ] **Step 2: Run** `npx vitest run libs/gi/page-team/src/TeamOptimize/compare/compareSwapKqm.test.ts` → the new tests FAIL (`inTeam`).
- [ ] **Step 3: Implement**: the member check refuses only `keys.includes(key) && key !== out`; in `swappedTeamOpt` delete `bonusStats[out]` only when `key !== out`. Check `sandboxOf` and `teamB` for any other `in !== out` assumption (e.g. `sameBuild` checks, `keysB`) and fix only what the tests show.
- [ ] **Step 4: Run** the same command → all PASS; then `npx vitest run libs/gi/page-team` → all PASS.
- [ ] **Step 5: Commit** `KQM Compare: lo stesso personaggio può uscire ed entrare (motore)`.

### Task 2: Tab, prefill and labels

**Files:**
- Modify: `compare/swapFragment.ts` (new export), `compare/KqmCompare.tsx` (`candidates` ~line 283, fragment state ~line 259), `compare/CompareOverview.tsx` (~line 123), `compare/compareCardData.ts` (badge ~line 212, `swap` ~line 243)
- Test: `compare/swapFragment.test.ts`, `compare/compareCardData.test.ts`, `compare/KqmCompare.test.tsx`
- Locales: `it/juanlab.json`, `en/juanlab.json` if any new string

**Interfaces:**
- Consumes: Task 1 (engine accepts `key === out`).
- Produces:
  - `memberActions(text: string, opener: string, names: Record<string, CharacterKey>, out: CharacterKey): string | undefined` in `swapFragment.ts` — the actions of `out`'s single step (opener included, same cutting as `swapFragment`), `undefined` when it appears 0 or 2+ times. (Match the `names` parameter type to `swapFragment`'s.)
  - `swapLabel(outName: string, inName: string, consOut: number, consIn: number): string` in `compareCardData.ts` — different names: `"Yae Miko → Mitya"`; same name, different constellations: `"Yae Miko C0 → C1"`; same name, same constellation: `"Yae Miko → Yae Miko"`.

- [ ] **Step 1: Write the failing tests**
  - `swapFragment.test.ts`: `memberActions('Danica E -> Odette E E -> Yae Miko E E E -> Danica Q', '', names, 'YaeMiko') === 'E E E'`; nickname/opener case like the existing `swapFragment` tests; twice → `undefined`; absent → `undefined`.
  - `compareCardData.test.ts`: `swapLabel` three cases above; the card data's `changed.badge` and `swap` use it (same-character context → `'Yae Miko C0 → C1'`).
  - `KqmCompare.test.tsx`: the "Entra" options include the leaving character and still exclude the other members; choosing the leaving character fills the fragment with its actions; choosing another character clears a prefill; text the user typed is not overwritten when re-picking the same character.
- [ ] **Step 2: Run** `npx vitest run libs/gi/page-team/src/TeamOptimize/compare` → new tests FAIL.
- [ ] **Step 3: Implement**: `candidates` keeps `k === out`; on picking `inKey === out` set the fragment to `memberActions(...)` only if the field is empty or still holds the previous prefill; overview row label and card badge from `swapLabel` with A's and B's constellations of that slot.
- [ ] **Step 4: Run** `npx vitest run libs/gi/page-team` → PASS; `npx tsc -p libs/gi/page-team/tsconfig.lib.json --noEmit` error count = baseline (42); `npx biome check` on touched files clean.
- [ ] **Step 5: Commit** `KQM Compare: confronto dello stesso personaggio con un'altra costellazione`.

### Task 3: Real-data check (controller)

- [ ] Production build served locally; with the user's save (`Tsaritsa - Yae - Odette - Danica`, A from KQM Theorycrafting): out Yae Miko, in Yae Miko C1, fragment prefilled `E E E` → B runs; overview shows `Yae Miko C0 → C1`; fixed members identical; card downloads (it + en); storage snapshot identical before/after; Yae → Mitya still works.
