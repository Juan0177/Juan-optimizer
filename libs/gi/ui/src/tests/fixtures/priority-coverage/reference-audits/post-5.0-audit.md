# Post-5.0 character audit (2026-11-13)

Every character released after 5.0 and every older character whose kit was buffed after 5.0 was
checked against the in-game text (talents, passives, C1–C6) and, where one exists, the pinned
kqmsim (`7bdf45f2`) or upstream gcsim (`b107b5d`). Frames were compared with an action-pair frame
matrix (each action alone and into N1 / CA / E / Q / D / J / swap, C0 and C6, both simulators
playing the same sequence).

Where the reference contradicts the game text, the app follows the game text. These differences
move the canonical benchmark gate and are listed here so they are not mistaken for app gaps.

## Reference defects (app follows the game text)

| Character | Game text | Reference | Effect on the gate |
| --- | --- | --- | --- |
| Anastasya | Burst freezes the Palestar Crown's duration | crown expires after 20 s | Stellar teams +4 to +11%; within the gate against a [patched reference](anastasya-crown-freeze.md) |
| Danica | 5th burst hit has its own Stellar-Conduct multiplier (burst5SSC) | uses the 1st hit's (burst5SSC unused) | Danica +6.5% |
| Mualani | Puffers only from Surging Bites; C1's +66% Max HP only on the first Surging Bite | any bite | Mualani −5.9% (C0), −48% (C6) |
| Pyro Traveler | Scorching Threshold attacks on the active character's damage | anyone's damage | hold team −6.3% |
| Sandrone | passive 0.7% per 100 ATK (max 14%); C4 cannon ignores DEF; C5 raises the ray | 0.35% (max 7%); no DEF ignore; no C5 | C4/C6 +9 to +11% |
| Linnea | C3 raises the Skill; C6's C1 bonus 150%; C2 CRIT DMG checks every member | Normal Attack; 300%; stops at the first non-Hydro/Geo member | C4/C6 +11 to +18% |
| Zibai | mode normals scale with the Skill talent (C3) | Normal Attack talent | C4/C6 +5% |
| Columbina | C4 flat bonus on every hit of that Gravity Interference | first hit only | small |
| Skirk | C6: one Havoc: Sever stack per N3 / N5 | a stack is spent before the cooldown check | C6 +7.8% |
| Mizuki | C1 extra attack 1000% EM (400% Stellar Swirl) | 1100% / 550% | small |
| Albedo | C6 +250% DEF goes to Fatal Blossoms | Transient Blossoms | C6 team −16% |
| Diona | C6 Stellar bonus 40% | permanent 50% | small |
| Nicole | A1 does not upgrade Nicole herself | upgrades her | small |
| Lohen | N3 three hits; C6 +2 Etches per Masterstroke | one hit; +1 per extension | C0 +9.6% |
| Illuga | skill tap deals damage | deals 0 | +32 to +51% ([audit](illuga.md)) |
| Cryo Traveler, Odette (Valeriy team) | expired Polestar fields stop collecting stacks | listener leaks | −22.7%, −16.7% ([audit](stellar-expiry-sandrone.md)) |
| Venti | (crit roll) | kqmsim crits the tapped E every iteration | Venti −5 to −7% |
| Wriothesley | Stellar C6 icicles deal 20% of the hit's original DMG | upstream gcsim 60% | Stellar C6 team −15% (+2.1% with the icicles at 20%) |
| (upstream gcsim) | Polestar Field Cryo/Electro DMG bonus (kqmsim's model, validated in the 40-case gate) | upstream's Stellar code differs | Fischl +21% in the upstream Stellar Wriothesley team |
| Alyosha | (upstream gcsim) | kqmsim's version is outdated (hitlag in frames units, N4, burst ticks) | compared with upstream instead |

## Engine rules added during the audit (gcsim parity)

- A written wait starts at the previous action's earliest cancel (gcsim's CanQueueAfter); the next
  action still waits for that action's own cancel into it.
- Attack modifiers that read the enemy's aura (Cryo resonance CRIT, Blizzard Strayer) use the aura
  before the hit's own reaction.
- Default defense halt: +3.6 frames (rounded up) of hitlag on hits that can be defense-halted and
  are not deployables.
- A zero-delay hit queued from a task lands before other tasks of that frame (gcsim applies
  `QueueAttack` with no delay at once). This fixed Nahida's extra Tri-Karma in a Baizhu team
  (+15.4% → +0.5%).
- A triggered hitlag on the acting character lengthens its current action (`extendsAction`, e.g.
  Ororon's Hypersense during his burst).
- Template jumps by body type (`templateJump`); statuses are active on their expiry frame (kits that
  line up on a frame grid use +1, e.g. Ororon's Hypersense ICD: the Ifa/Jahoda team +12.8% → +0.0%).

## Characters without a reference

Kachina and Nefer are in neither gcsim nor kqmsim. Their kits follow the game text and the game's own
ability configs (Nightsoul drain, Turbo Twirly intervals and costs, Phantasm Performance Dew cost);
action frames are estimates and are marked as such in the kits. Somnia is not in the game data and
was not audited.

## Known engine limitations (not modelled)

Energy (all benchmarks ignore burst energy), shields and being hit (Lan Yan C2, Dahlia, Kachina C6,
Skirk C6 trigger, Beidou C4/counter), particles (Razor C1 is approximated), element absorption from
gadgets or the player (Lan Yan in Pyro teams), status expiry on the expiry frame (kits that line up on
a frame grid correct it locally), Nicole's ATK evaluated in the hitter's context.

## Later corrections

- **Mitya, mode-switch Skill (2026-11-15).** The reference detonates his Gradient Beacons (Prism
  Shatter) when the Skill is tapped again to switch a Steady core to Overload. Game text: a Steady
  core consumes them "when its duration ends or another Detection Core is created", and tapping
  again within 6 s only "changes the Detection Core's state". We keep the Beacons on a switch, in
  both directions; a new tap or hold Skill on a Steady core, or its 25 s running out, still
  detonates. Reported by players; the fix is open upstream as KQM-git/kqmsim#31. Tests:
  `kqmsimKits.test.ts` (switch keeps Beacons, the DPS loop never detonates, each detonation case).
- **Sandrone, charge timing (2026-11-15).** The pinned kqmsim holds a plain charge until Decoding
  Power is full, then waits the 19 frames before Power Overdrive. gcsim's official version
  (`b107b5d`, #3269) releases it 1 frame after the most condensed beams it can fire (3, 6 with C1;
  fewer when Decoding Power is already high), repairs Fagio while she hovers (70 as the Skill is
  cast, then 10 every 0.1 s while it goes on), times normal attacks into a charge by their whole
  animation (53 / 46 / 87 frames) and lands the Prism Shots at 34 frames. We follow it: each charge
  is 23 frames shorter (CA E Q CA E CA E: 14.1 s on field instead of 15.2 s, as a TC sheet had it).
  The action timeline matches upstream frame for frame (`rotationSandroneOverdrive.test.ts`).
  Upstream's A1 reads "more than 5" Decoding Power (its values are x10); the game text says 50, which
  we keep. A charge with too much Decoding Power for 3 beams is an error upstream; here it fires the
  beams it still can (none when Fagio is full) and ends as Power Overdrive begins.
