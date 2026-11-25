import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { RotationMember } from '@genshin-optimizer/gi/ui'
import { holdsSkill, kitModels } from '@genshin-optimizer/gi/ui'
import type { TFunction } from 'i18next'

export interface WriterQuickToken {
  text: string
  key: string
  label: string
  /** Set on kit-specific chips so the UI can colour their dot by the member's lane */
  characterKey?: CharacterKey
}

export interface WriterSyntaxRow {
  code: string
  meaning: string
  characterKey?: CharacterKey
}

/** Characters whose rotations commonly use plunges (or enable team plunges) */
const PLUNGE_MEMBERS = new Set<CharacterKey>([
  'Xianyun',
  'Xiao',
  'Gaming',
  'Varesa',
  'KaedeharaKazuha',
  'Venti',
  'Diluc',
  'Albedo',
])

function teamCapabilities(
  members: readonly { characterKey: CharacterKey }[],
  names: readonly RotationMember[]
) {
  const keys = members.map((m) => m.characterKey)
  const has = (k: CharacterKey) => keys.includes(k)
  const nameOf = (k: CharacterKey) =>
    names.find((n) => n.characterKey === k)?.name ?? k
  const holdMembers = keys.filter((k) => holdsSkill(k))
  const entryMembers = keys.filter((k) => !!kitModels[k]?.onSwapIn)
  const plungeMembers = keys.filter((k) => PLUNGE_MEMBERS.has(k))
  return { keys, has, nameOf, holdMembers, entryMembers, plungeMembers }
}

/**
 * Quick-insert action chips and tooltips tailored to the characters currently in the team:
 * omits irrelevant chips (like `hE`, `P`, `entry`) when nobody on the team uses them, keeps
 * tooltips focused on this team, and surfaces kit-specific syntax chips for teammates that have them.
 */
export function teamQuickTokens(
  members: readonly { characterKey: CharacterKey }[],
  names: readonly RotationMember[],
  t: TFunction
): WriterQuickToken[] {
  const { has, nameOf, holdMembers, entryMembers, plungeMembers } =
    teamCapabilities(members, names)

  const tokens: WriterQuickToken[] = [
    {
      text: 'E',
      key: 'skill',
      label: holdMembers.length
        ? t('teamOpt.writer.token.skill', 'Elemental Skill (tap)')
        : t('teamOpt.writer.token.skillOnly', 'Elemental Skill'),
    },
  ]

  if (holdMembers.length) {
    const parts = [
      t('teamOpt.writer.token.holdTeam', {
        defaultValue: 'Elemental Skill (hold): {{names}}',
        names: holdMembers.map(nameOf).join(', '),
      }),
    ]
    if (has('Beidou'))
      parts.push(
        t(
          'teamOpt.writer.token.holdBeidou',
          'Beidou: 2 Polaris stacks, hE[stacks=1] for 1'
        )
      )
    tokens.push({ text: 'hE', key: 'hold', label: parts.join(' · ') })
  }

  tokens.push(
    {
      text: 'Q',
      key: 'burst',
      label: t('teamOpt.writer.token.burst', 'Elemental Burst'),
    },
    {
      text: 'N3',
      key: 'normal',
      label: t('teamOpt.writer.token.normal', 'Normal attacks: N1 to N6 hits'),
    }
  )

  const caNotes: string[] = []
  if (has('Sandrone'))
    caNotes.push(
      t(
        'teamOpt.writer.token.caSandrone',
        'Sandrone: 3 condensed beams, CA[beams=2] for 2 (up to 6 from C1)'
      )
    )
  if (has('Mavuika'))
    caNotes.push(
      t(
        'teamOpt.writer.token.caMavuika',
        'Mavuika: C3F spins 3 times then finisher; C2D spins 2 times then dash'
      )
    )
  if (has('Arlecchino'))
    caNotes.push(
      t(
        'teamOpt.writer.token.caArlecchino',
        'Arlecchino: CA[cancel] absorbs the Blood-Debt Directive without landing the hit'
      )
    )
  if (has('Chasca'))
    caNotes.push(
      t(
        'teamOpt.writer.token.caChasca',
        'Chasca: CA[bullets=4] fires after 4 bullets (6 by default)'
      )
    )
  if (has('Lyney'))
    caNotes.push(
      t(
        'teamOpt.writer.token.caLyney',
        'Lyney: CA[weakspot] counts a weakspot hit'
      )
    )
  const caBase = t('teamOpt.writer.token.chargedBase', 'Charged Attack')
  tokens.push({
    text: 'CA',
    key: 'charged',
    label: caNotes.length ? `${caBase} (${caNotes.join('; ')})` : caBase,
  })

  if (plungeMembers.length) {
    tokens.push({
      text: 'P',
      key: 'plunge',
      label: t(
        'teamOpt.writer.token.plunge',
        'Plunging Attack (HP: high plunge, LP: low plunge; HP[collision] adds the hit on the way down)'
      ),
    })
  }

  tokens.push(
    {
      text: 'D',
      key: 'dash',
      label: has('Wanderer')
        ? t(
            'teamOpt.writer.token.dashWanderer',
            'Dash (Wanderer: D?/CA dashes only with Descent, otherwise CA)'
          )
        : t('teamOpt.writer.token.dash', 'Dash'),
    },
    {
      text: 'J',
      key: 'jump',
      label: t('teamOpt.writer.token.jump', 'Jump'),
    },
    {
      text: 'W1',
      key: 'wait',
      label:
        has('Tartaglia') || has('Iansan')
          ? t(
              'teamOpt.writer.token.wait',
              'Wait: W1.5 is 1.5 s, W90f is 90 frames; WK is a walk (WK11f: 11 frames)'
            )
          : t(
              'teamOpt.writer.token.waitBasic',
              'Wait: W1.5 is 1.5 s, W90f is 90 frames'
            ),
    }
  )

  if (entryMembers.length) {
    tokens.push({
      text: 'entry',
      key: 'swap',
      label: t('teamOpt.writer.token.swapTeam', {
        defaultValue:
          'Swap in only: {{names}} swap-in effect (a name alone mid-rotation is the same)',
        names: entryMembers.map(nameOf).join(', '),
      }),
    })
  }

  // Kit-specific shortcuts for characters actually in this team
  if (has('Beidou'))
    tokens.push({
      text: 'hE[stacks=1]',
      key: 'beidouStacks',
      characterKey: 'Beidou',
      label: t(
        'teamOpt.writer.syntax.stacks',
        'Beidou: hold for 1 Polaris stack (0.8 s each; hE alone holds for 2, the maximum bonus)'
      ),
    })
  if (has('Sandrone'))
    tokens.push({
      text: 'CA[beams=2]',
      key: 'sandroneBeams',
      characterKey: 'Sandrone',
      label: t(
        'teamOpt.writer.syntax.beams',
        'Sandrone: release after 2 condensed beams (3 by default, up to 6 from C1)'
      ),
    })
  if (has('Arlecchino'))
    tokens.push({
      text: 'CA[cancel]',
      key: 'arlecchinoCancel',
      characterKey: 'Arlecchino',
      label: t(
        'teamOpt.writer.syntax.cancel',
        'Arlecchino: cancel the Charged Attack before it hits. She still absorbs the Blood-Debt Directive (Bond of Life, C2’s Bloodfire), but the attack never lands, so it doesn’t use up the aura for Melt'
      ),
    })
  if (has('Chasca'))
    tokens.push({
      text: 'CA[bullets=4]',
      key: 'chascaBullets',
      characterKey: 'Chasca',
      label: t(
        'teamOpt.writer.syntax.bullets',
        'Chasca: fire after loading 4 bullets (6 by default)'
      ),
    })
  if (has('Mavuika'))
    tokens.push({
      text: 'C3F',
      key: 'mavuikaSpins',
      characterKey: 'Mavuika',
      label: t(
        'teamOpt.writer.syntax.spins',
        'Mavuika: 3 Flamestrider spins, then the finisher · 2 spins, then a dash (no finisher)'
      ),
    })
  if (has('Lyney'))
    tokens.push({
      text: 'CA[weakspot]',
      key: 'lyneyWeakspot',
      characterKey: 'Lyney',
      label: t(
        'teamOpt.writer.syntax.weakspot',
        'Lyney: Charged Attack weakspot hit'
      ),
    })
  if (has('Iansan'))
    tokens.push({
      text: 'N3[movement=4]',
      key: 'iansanMovement',
      characterKey: 'Iansan',
      label: t(
        'teamOpt.writer.syntax.movement',
        'After any action: the metres the active member moves with it, each normal attack counted (gcsim’s movement). Only Iansan’s Kinetic Energy Scale uses it: 0.67 Nightsoul points a metre while another member is on the field, 6 m an action when not written'
      ),
    })
  if (has('Tartaglia'))
    tokens.push({
      text: 'WK',
      key: 'tartagliaWalk',
      characterKey: 'Tartaglia',
      label: t(
        'teamOpt.writer.syntax.walk',
        'Walk 1 frame · 11 frames (an action: Tartaglia’s next Skill is his walking one)'
      ),
    })
  if (has('Wanderer'))
    tokens.push({
      text: 'D?/CA',
      key: 'wandererDash',
      characterKey: 'Wanderer',
      label: t(
        'teamOpt.writer.syntax.dashReady',
        'Wanderer: dash only with Descent, otherwise a Charged Attack'
      ),
    })

  tokens.push({
    text: '->',
    key: 'next',
    label: t('teamOpt.writer.token.next', 'Next step or another member'),
  })

  return tokens
}

/**
 * Syntax reference rows tailored to the current team: team-specific mechanics first, followed by
 * concise universal syntax without unrelated characters' options.
 */
export function teamSyntaxRows(
  members: readonly { characterKey: CharacterKey }[],
  names: readonly RotationMember[],
  t: TFunction
): { teamRows: WriterSyntaxRow[]; generalRows: WriterSyntaxRow[] } {
  const { has, nameOf, holdMembers, entryMembers, plungeMembers } =
    teamCapabilities(members, names)
  const firstName = names[0]?.name ?? 'Name'

  const teamRows: WriterSyntaxRow[] = []
  if (holdMembers.length) {
    teamRows.push({
      code: 'hE',
      meaning: t('teamOpt.writer.syntax.holdTeam', {
        defaultValue: 'Held Elemental Skill ({{names}})',
        names: holdMembers.map(nameOf).join(', '),
      }),
      ...(holdMembers.length === 1 && { characterKey: holdMembers[0] }),
    })
  }
  if (entryMembers.length) {
    teamRows.push({
      code: 'entry',
      meaning: t('teamOpt.writer.syntax.entryTeam', {
        defaultValue:
          'Swap in only for {{names}} swap-in effect (a name alone mid-rotation is the same)',
        names: entryMembers.map(nameOf).join(', '),
      }),
      ...(entryMembers.length === 1 && { characterKey: entryMembers[0] }),
    })
  }
  if (plungeMembers.length) {
    teamRows.push({
      code: 'HP · LP',
      meaning: t(
        'teamOpt.writer.syntax.plunge',
        'A high or low plunge (P alone: the character’s usual one). HP[collision] adds the collision hit on the way down; HP[collision=0.5] counts it on half of them'
      ),
      ...(plungeMembers.length === 1 && { characterKey: plungeMembers[0] }),
    })
  }
  if (has('Beidou'))
    teamRows.push({
      code: 'hE[stacks=1]',
      characterKey: 'Beidou',
      meaning: t(
        'teamOpt.writer.syntax.stacks',
        'Beidou: hold for 1 Polaris stack (0.8 s each; hE alone holds for 2, the maximum bonus)'
      ),
    })
  if (has('Sandrone'))
    teamRows.push({
      code: 'CA[beams=2]',
      characterKey: 'Sandrone',
      meaning: t(
        'teamOpt.writer.syntax.beams',
        'Sandrone: release after 2 condensed beams (3 by default, up to 6 from C1)'
      ),
    })
  if (has('Arlecchino'))
    teamRows.push({
      code: 'CA[cancel]',
      characterKey: 'Arlecchino',
      meaning: t(
        'teamOpt.writer.syntax.cancel',
        'Arlecchino: cancel the Charged Attack before it hits. She still absorbs the Blood-Debt Directive (Bond of Life, C2’s Bloodfire), but the attack never lands, so it doesn’t use up the aura for Melt'
      ),
    })
  if (has('Chasca'))
    teamRows.push({
      code: 'CA[bullets=4]',
      characterKey: 'Chasca',
      meaning: t(
        'teamOpt.writer.syntax.bullets',
        'Chasca: fire after loading 4 bullets (6 by default)'
      ),
    })
  if (has('Mavuika'))
    teamRows.push({
      code: 'C3F · C2D',
      characterKey: 'Mavuika',
      meaning: t(
        'teamOpt.writer.syntax.spins',
        'Mavuika: 3 Flamestrider spins, then the finisher · 2 spins, then a dash (no finisher)'
      ),
    })
  if (has('Lyney'))
    teamRows.push({
      code: 'CA[weakspot]',
      characterKey: 'Lyney',
      meaning: t(
        'teamOpt.writer.syntax.weakspot',
        'Lyney: Charged Attack weakspot hit'
      ),
    })
  if (has('Iansan'))
    teamRows.push({
      code: 'N3[movement=4]',
      characterKey: 'Iansan',
      meaning: t(
        'teamOpt.writer.syntax.movement',
        'After any action: the metres the active member moves with it, each normal attack counted (gcsim’s movement). Only Iansan’s Kinetic Energy Scale uses it: 0.67 Nightsoul points a metre while another member is on the field, 6 m an action when not written'
      ),
    })
  if (has('Tartaglia'))
    teamRows.push({
      code: 'WK · WK11f',
      characterKey: 'Tartaglia',
      meaning: t(
        'teamOpt.writer.syntax.walk',
        'Walk 1 frame · 11 frames (an action: Tartaglia’s next Skill is his walking one)'
      ),
    })
  if (has('Wanderer'))
    teamRows.push({
      code: 'D?/CA',
      characterKey: 'Wanderer',
      meaning: t(
        'teamOpt.writer.syntax.dashReady',
        'Wanderer: dash only with Descent, otherwise a Charged Attack'
      ),
    })

  const generalRows: WriterSyntaxRow[] = [
    {
      code: `${firstName} E Q`,
      meaning: t(
        'teamOpt.writer.syntax.step',
        'A step: who acts, then their actions. Names can be short (bina, ei).'
      ),
    },
    {
      code: '->',
      meaning: t(
        'teamOpt.writer.syntax.next',
        'Next step. Also →, >, a comma or a new line.'
      ),
    },
    {
      code: holdMembers.length ? 'E / tE · hE' : 'E',
      meaning: holdMembers.length
        ? t('teamOpt.writer.syntax.skill', 'Elemental Skill, tapped · held')
        : t('teamOpt.writer.syntax.skillTapOnly', 'Elemental Skill'),
    },
    {
      code: 'Q',
      meaning: t('teamOpt.writer.syntax.burst', 'Elemental Burst'),
    },
    {
      code: 'N1 – N6',
      meaning: t(
        'teamOpt.writer.syntax.normal',
        'A normal attack string of that many hits'
      ),
    },
    {
      code: 'N3-4',
      meaning: t(
        'teamOpt.writer.syntax.normalFrom',
        'The string carrying on: its 3rd to 4th hits, after an action that keeps it going (N2 after a Skill starts over)'
      ),
    },
    {
      code: 'CA',
      meaning: t('teamOpt.writer.syntax.charged', 'Charged Attack'),
    },
    {
      code: plungeMembers.length ? 'P · D · J' : 'D · J',
      meaning: plungeMembers.length
        ? t('teamOpt.writer.syntax.moves', 'Plunge · dash · jump')
        : t('teamOpt.writer.syntax.dashJump', 'Dash · jump'),
    },
    {
      code: '4[N5 CD] · 4N5CD',
      meaning: t(
        'teamOpt.writer.syntax.repeat',
        'A group that many times (up to 20), as N5 CD four times'
      ),
    },
    {
      code: 'W1.5 · W90f',
      meaning: t(
        'teamOpt.writer.syntax.wait',
        'Wait 1.5 s · 90 frames, from when the next action could start (gcsim’s wait)'
      ),
    },
    {
      code: 'E? · Q?',
      meaning: t(
        'teamOpt.writer.syntax.ready',
        'Only when ready: left out, not waited for (ER calc: Q? defaults to every 2nd burst)'
      ),
    },
    {
      code: 'Q?/N3 · Q/N3 · EQ/E',
      meaning: t(
        'teamOpt.writer.syntax.otherwise',
        'Only when ready, otherwise the actions after "/" (no spaces inside; ER calc defaults to every 2nd burst)'
      ),
    },
    {
      code: '(note) · A/B',
      meaning: t(
        'teamOpt.writer.syntax.notes',
        'Ignored · the first one is played'
      ),
    },
    {
      code: `-> ${firstName}`,
      meaning: t(
        'teamOpt.writer.syntax.loop',
        'End with the first member: where the rotation loops'
      ),
    },
  ]

  return { teamRows, generalRows }
}
