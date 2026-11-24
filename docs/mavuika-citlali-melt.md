# Mavuika and Citlali: why her charged attacks melt or not

Investigated after Stellar Optimizer 1.40.4 (merged into Juan-optimizer in PR #54). We had
reported to Stellar that Mavuika's Flamestrider charged attacks never Melt with Citlali. The
reaction engine turned out to be right. The result depends on the rotation, and the hit list had a
display bug that hid how the melting hits are counted.

## Summary

| Finding | Status |
|---|---|
| The reaction engine (`libs/gi/ui/src/util/teamOpt/rotation/reactions.ts`) | Matches gcsim's `pkg/reactable` line by line, including Melt (`melt.go`), attach and refresh. No change. |
| The element application of the hits involved | Mavuika, Citlali, Bennett and Xilonen use the same element, durability, ICD tag and ICD group as gcsim. Examples: Flamestrider CA, sprint and N use `MavuikaFlamestrider` / Default; Frostfall Storm uses `CitlaliFrostfallStorm` (90 f, `[1, 0]`) every 59 f; Ice Storm is 2U. No change. |
| Whether Mavuika's CAs melt | Depends on the aura on the enemy when her burst combo starts. With `Citlali E Q N1`, 5 of the 13 CAs in the combo melt, the same as Prydwen counts. With `Citlali E Q` or `Citlali E N1 Q`, none melt. Covered by a test. |
| "(Melt) (Melt)" in the hit list | Bug, fixed. |

## How the aura behaves

Rules, as in gcsim:

- A Cryo hit on a Pyro aura is a reverse Melt (×1.5). It removes `0.5 × its durability` of Pyro,
  and as a trigger it never leaves Cryo behind (`a.Reacted`, so no `AttachOrRefill`).
- A Pyro hit on a Cryo aura is a forward Melt (×2). It removes up to `2 × its durability` of Cryo,
  so 1U of Pyro clears the 0.8U Cryo aura completely, and it leaves no Pyro behind either.
- Mavuika's Flamestrider hits apply Pyro once every 3 hits or 2.5 s (Default ICD group). Each
  application refreshes the Pyro aura to 0.8U.
- Citlali's Frostfall Storm applies 1U of Cryo about every 2 s.

So the fight settles into one of two stable states.

**Pyro state.** Mavuika's Pyro is on the enemy. Each Frostfall Storm tick reverse-melts and takes
0.5U off the aura. Mavuika refreshes it to 0.8U before a second tick can clear it. Citlali's hits
melt, and Mavuika's hits never do.

**Cryo state.** Citlali's Cryo is on the enemy. Each Pyro hit that Mavuika applies forward-melts
and clears it. The enemy is then clean, so the next Frostfall Storm tick lays Cryo again. Each of
Mavuika's applying hits melts, and the hits between them (ICD) do no reaction at all.

What decides the state is which element lands first on a clean enemy after Ice Storm. Ice Storm is
2U of Cryo, and it clears the Pyro left by the opener.

Trace with `Citlali E Q N1` (seconds; durability in gcsim units, 25 = 1U):

```
26.63 Citlali  cryo 50  R [pyro:19.3] -> []          Ice Storm (clears the Pyro)
27.60 Citlali  cryo 25    []          -> [cryo:20.0] N1 (lays Cryo)
28.20 Citlali  cryo 25    [cryo:18.7] -> [cryo:20.0] Frostfall Storm
28.22 Mavuika  pyro 25  R [cryo:20.0] -> []          Flamestrider Charged Attack (Cyclic), Melt
28.72 Citlali  cryo 25    []          -> [cryo:20.0] Spiritvessel Skull
29.98 Mavuika  pyro 25  R [cryo:17.3] -> []          Sunfell Slice, Melt
...
```

Trace with `Citlali E Q` (the Prydwen rotation as we had written it):

```
26.63 Citlali  cryo 50  R [pyro:19.3] -> []          Ice Storm (clears the Pyro)
27.28 Mavuika  pyro 25    []          -> [pyro:20.0] Flamestrider Charged Attack (Cyclic): Pyro first
27.57 Citlali  cryo 25  R [pyro:19.4] -> [pyro:6.9]  Frostfall Storm, reverse Melt
29.12 Mavuika  pyro 25    []          -> [pyro:20.0] Sunfell Slice
...                                                  (Pyro state for the rest of the combo)
```

`Citlali E N1 Q` doesn't help. N1 lands on the opener's Pyro and reverse-melts. Then Ice Storm
clears the enemy, and Mavuika's Pyro lands first again.

The test is `libs/gi/ui/src/tests/rotationMavuikaCitlaliMelt.test.ts`. For the rotation
`Mavuika E C -> Bennett E -> Xilonen E N2 -> Bennett Q -> <Citlali> -> Mavuika E C Q CD C3F D CF D CF D CD C2`
it expects:

- 5 of the 14 charged attacks melt with `Citlali E Q N1`: the 13 of the combo, plus the opener's C, which doesn't melt.
- None melt with `Citlali E Q` or `Citlali E N1 Q`.

Stellar's template "Mavuika, Citlali, Xilonen, Bennett" (Prydwen / KQM) already writes
`Citlali E Q N1`.

The difference in damage is large. Our Mavuika C2R1, Xilonen, Citlali and Bennett team, with
the same gear and the rotation above, went from 165,524 team DPS with `Citlali E Q` to 253,365
with `Citlali E Q N1` (Juan-optimizer, after the 1.40.4 merge).

## The display bug

`rotationAttacks` (simulate.ts) already writes the reaction into an attack's description, for
example `Frostfall Storm (Melt)`. The rotation writer's hit list then added it again:
`Frostfall Storm (Melt) (Melt)`. In Italian this showed as "Tifone glaciale (Fusione) (Fusione)".
Because of the extra tag, the list split each attack in two: the melting hits became an attack of
their own, instead of a "Melt" part of the same attack.

The fix is in `libs/gi/page-team/src/TeamOptimize/hitLabel.ts`. `attackHitLabel` adds the
reaction only when the description doesn't end with it already. `RotationWriter.tsx` uses it.
It's tested in `hitLabel.test.ts`.

## What we got wrong in the report

Point 1 of our report to Stellar ("Mavuika's charged attacks never melt with Citlali") was a
wrong diagnosis. Our version of the Prydwen rotation lacked the N1 after Citlali's burst. The
form-switch fix in 1.40.2 (point 2) was a real bug, and Stellar fixed it.
