# KQM Compare — B's KQM results screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show, under KQM Compare's A/B summary, KQM Theorycrafting's results screen for team B (setup line, member tiles, build panel, weapon and set rankings for the entering member, inspector), computed on B's sandbox.

**Architecture:** `compareSwapKqm` returns B's headline result first (as now) and then continues the entering member's ranking pass on the same sandbox, reporting the final `KqmResult` with `rankings[inKey]`; the sandbox is kept for the inspector. `KqmResults` gets an optional database override so its inspector runs on the sandbox. KqmCompare renders it read only.

**Tech Stack:** React 18, MUI 5, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-kqm-compare-results-design.md` (plus `docs/superpowers/specs/2026-11-17-swap-compare-design.md`).

## Global Constraints
- No writes to the user's DB, `teamOpt`, `teamKqmResults` or team localStorage; nothing of B ever runs on the real database.
- KQM Theorycrafting's screen and engine behave exactly as before; shared-code edits only as optional parameters/props with unchanged defaults.
- The A/B summary still appears as soon as B's build is known; rankings fill in afterwards with progress; leaving the tab or resetting cancels.
- New strings under `kqmCompare.*` (juanlab, it + en). WCAG 2.1 AA, responsive to 360px, DESIGN.md rules.
- Branch `claude/vigilant-cannon-aqwxna`, PR to `juanlab` of Juan0177/Juan-optimizer only.

## Review Focus
- Inspector click in B's rankings → must compute on the sandbox (assert the real DB untouched and the swapped member present).
- Cancel during the ranking pass → headline result stays shown, no error, nothing written.
- Auto mode (weapon+sets searched) → rankings still produced for the entering member.
- Changing inputs after a run → the B results screen is marked stale like the summary.
- Phone width 360px → no horizontal overflow from the embedded results screen.

---

### Task 1: Engine — rankings for the entering member, sandbox kept
**Files:** Modify `libs/gi/page-team/src/TeamOptimize/compare/compareSwapKqm.ts`; test `compare/compareSwapKqm.test.ts`; engine files in `libs/gi/ui/src/util/teamOpt/kqm.ts` only if an optional parameter is needed.
**Interfaces — Produces:** `compareSwapKqm(args & { onPreview?: (b: { a: Side; b: Side; resultB: KqmResult }) => void })` resolving to `{ a: Side; b: Side; resultB: KqmResult; sandbox: ArtCharDatabase; teamOptB: TeamOpt }` (or the existing error union); `resultB.rankings[inKey]` filled; `resultB.optimized` = `[inKey]`.
- [ ] Failing tests: fixed path → `resultB.rankings[inKey]` has weapons and sets entries; Auto path → same; `onPreview` called before resolution with B's headline; cancel after preview → resolves with the preview's result and `rankings` empty, no throw; storage snapshot unchanged; fixed members' builds unchanged.
- [ ] Implement: let `compareTeamKqm` run its ranking pass (stop waiting only on cancel); for Auto, run the one-member ranking with teammates fixed (optional engine parameter if the `from`+`only` path skips rankings).
- [ ] Tests pass, suite green, typecheck baseline (42 / 2); commit.

### Task 2: KqmResults on another database
**Files:** Modify `libs/gi/page-team/src/TeamOptimize/KqmMode.tsx` (`KqmResults` and whatever it passes the database to: inspector/compare hooks, share menu); test in `KqmUx.test.tsx` or a new test.
**Interfaces — Produces:** optional props `database?: ArtCharDatabase` and `readOnly?: boolean` on `KqmResults` (defaults: page database, false). With `readOnly`: no discard, no "use these builds"/equip, no save to `teamKqmResults`, no share of B as if it were the team; inspector comparisons use `database`.
- [ ] Failing tests: with a database prop the inspector's compare call receives it; with readOnly the discard/apply controls are absent; without props, rendering identical to before (existing tests unchanged).
- [ ] Implement; tests; commit.

### Task 3: B's results section in KQM Compare
**Files:** Modify `compare/KqmCompare.tsx` (or a new `compare/CompareResults.tsx`), locales; test `compare/KqmCompare.test.tsx`.
**Interfaces — Consumes:** Task 1's result (`resultB`, `sandbox`, `teamOptB`), Task 2's props.
- [ ] Failing tests: after a run the section "Risultati KQM di B" renders KqmResults with `database=sandbox`, `readOnly`, `members` of B; while rankings are pending it shows progress; stale inputs mark it stale; reset/leave drops the sandbox.
- [ ] Implement; tests; commit.

### Task 4: Real-data check
- [ ] Build, serve, run on the user's save (out Yae, in Mitya, Auto and fixed Wandering Evenstar R1, fragment `E Q`): summary first, then rankings; click a weapon in the ranking → recomputed (real DB snapshot unchanged); axe 0 in 3 themes; 360px no overflow; screenshots for the user.
