import { objPathValue } from '@genshin-optimizer/common/util'
import type {
  CharacterKey,
  ElementWithPhyKey,
} from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { ElementIcon } from '@genshin-optimizer/gi/svgicons'
import type { TeamData, TeamOptEvaluation } from '@genshin-optimizer/gi/ui'
import { resolveInfo } from '@genshin-optimizer/gi/ui'
import type { CalcResult } from '@genshin-optimizer/gi/uidata'
import { Box, Tooltip, Typography } from '@mui/material'
import { type ReactNode, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRateFull } from './format'
import { MemberAvatar } from './MemberAvatar'
import { numSx, SubsectionTitle, tokens, type } from './ui'

/** A part of the whole: who or what dealt it, its colour, its damage */
interface Slice {
  key: string
  label: string
  color: string
  value: number
  icon?: ReactNode
}

/** The element a hit deals (a reaction's damage counts as the element it deals) */
const REACTION_ELEMENT: Record<string, string> = {
  overloaded: 'pyro',
  burning: 'pyro',
  superconduct: 'cryo',
  electrocharged: 'electro',
  lunarcharged: 'electro',
  stellarconduct: 'electro',
  shattered: 'physical',
  bloom: 'dendro',
  hyperbloom: 'dendro',
  burgeon: 'dendro',
  lunarbloom: 'dendro',
  lunarcrystallize: 'geo',
  crystallize: 'geo',
  stellarswirl: 'anemo',
}
const ELEMENTS = [
  'pyro',
  'hydro',
  'electro',
  'cryo',
  'anemo',
  'geo',
  'dendro',
  'physical',
] as const

/** An attack's element, from its member's data (its talent's own, an infusion, or its reaction's) */
function attackElement(
  teamData: TeamData | undefined,
  characterKey: CharacterKey,
  attack: TeamOptAttack
): string {
  const data = teamData?.[characterKey]?.target
  const node = data
    ? (objPathValue(data.getDisplay(), attack.path) as CalcResult | undefined)
    : undefined
  const info = node?.info ? resolveInfo(node.info) : undefined
  const variant = info?.variant as string | undefined
  const sub = info?.subVariant as string | undefined
  if (!variant) return 'physical'
  if (variant === 'physical' && attack.infusionAura) return attack.infusionAura
  if (variant === 'swirl')
    return sub && (ELEMENTS as readonly string[]).includes(sub) ? sub : 'anemo'
  if (variant === 'stellarconduct' && sub === 'cryo') return 'cryo'
  if ((ELEMENTS as readonly string[]).includes(variant)) return variant
  return REACTION_ELEMENT[variant] ?? 'physical'
}

/**
 * The rings' colours: each element's hue from the game, its lightness set for the dark panel and
 * spread so that a team's elements stay apart (also for red-green colour blindness), and a second
 * shade of the same hue for a second member of one element. Checked with the data-viz palette
 * validator (OKLab ΔE, dark surface #212124): the common teams' elements pass (Lunar-Charged,
 * National, Freeze, Hyperbloom, Burgeon, Geo), and each element's pair of shades passes. The names
 * and icons beside the ring always say which is which.
 */
const CHART: Record<string, [string, string]> = {
  pyro: ['#c21a13', '#e16e34'],
  hydro: ['#2955d3', '#3995f8'],
  electro: ['#ba6fd1', '#864089'],
  cryo: ['#43a0c2', '#236889'],
  anemo: ['#04764c', '#40a894'],
  geo: ['#bf8608', '#865400'],
  dendro: ['#7fa51b', '#3f7005'],
  physical: ['#69625d', '#99928d'],
}
const chartColor = (element: string, shade = 0) =>
  (CHART[element] ?? CHART['physical'])[shade % 2]

/**
 * The team's damage, split two ways: by member and by element. Each a ring with its parts listed
 * beside it (name, share, damage); hovering a part (in the ring or the list) shows it in the
 * middle.
 */
export function DamageShare({
  members,
  evaluation,
  attacks,
  teamData,
  rotationTime,
}: {
  members: CharacterKey[]
  evaluation: TeamOptEvaluation
  /** The rotation's attacks, as the evaluation counts them (per member, in order) */
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
  teamData: TeamData | undefined
  rotationTime?: number
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen', 'sheet_gen'])
  const byMember = useMemo<Slice[]>(() => {
    // (members of one element: the second its other shade, so the parts stay apart)
    const used = new Map<string, number>()
    return members.map((ck) => {
      const element = getCharEle(ck)
      const n = used.get(element) ?? 0
      used.set(element, n + 1)
      return {
        key: ck,
        label: t(`charNames_gen:${ck}`, ck),
        color: chartColor(element, n),
        value: Math.max(0, evaluation.members?.[ck] ?? 0),
        icon: <MemberAvatar characterKey={ck} size={22} />,
      }
    })
  }, [members, evaluation, t])
  const byElement = useMemo<Slice[]>(() => {
    const sums = new Map<string, number>()
    for (const ck of members) {
      const list = attacks[ck] ?? []
      // (an evaluation without its attacks' damage: no element split)
      const damage = evaluation.attacks?.[ck] ?? []
      list.forEach((attack, i) => {
        const value = damage[i] ?? 0
        if (value <= 0) return
        const element = attackElement(teamData, ck, attack)
        sums.set(element, (sums.get(element) ?? 0) + value)
      })
    }
    return [...sums]
      .sort((a, b) => b[1] - a[1])
      .map(([element, value]) => ({
        key: element,
        label: t(`sheet_gen:element.${element}`, {
          defaultValue: element[0].toUpperCase() + element.slice(1),
        }),
        color: chartColor(element),
        value,
        icon: (
          <ElementIcon
            ele={element as ElementWithPhyKey}
            iconProps={{ sx: { fontSize: 18 } }}
          />
        ),
      }))
  }, [members, attacks, evaluation, teamData, t])

  return (
    <Box
      component="section"
      aria-label={t('teamOpt.kqm.share', 'Damage share')}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <SubsectionTitle
        info={t(
          'teamOpt.kqm.shareTip',
          'How the team’s damage splits: by who deals it, and by the element it deals (a reaction’s damage counts as its element, Lunar-Charged as Electro).'
        )}
      >
        {t('teamOpt.kqm.share', 'Damage share')}
      </SubsectionTitle>
      <Box
        sx={{
          border: `1px solid ${tokens.hairlineStrong}`,
          borderRadius: tokens.radius.inset,
          p: { xs: 1.5, sm: 2 },
          // (as tall as the table beside it, its rings in the middle)
          flex: 1,
          alignContent: 'center',
          display: 'grid',
          gap: { xs: 2.5, sm: 2 },
          gridTemplateColumns: 'minmax(0, 1fr)',
          '@container (min-width: 520px)': {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          },
        }}
      >
        <Ring
          title={t('teamOpt.kqm.shareMembers', 'By member')}
          slices={byMember}
          rotationTime={rotationTime}
        />
        {byElement.length > 0 && (
          <Ring
            title={t('teamOpt.kqm.shareElements', 'By element')}
            slices={byElement}
            rotationTime={rotationTime}
            // (the team's damage is in the other ring's middle: this one leads with its element)
            lead
          />
        )}
      </Box>
    </Box>
  )
}

const SIZE = 156
const THICK = 20
/** The surface gap between parts, in pixels along the ring's middle */
const GAP = 2

/** An annular sector from `a0` to `a1` (radians, 0 at the top, clockwise) */
function arc(a0: number, a1: number, r: number, inner: number) {
  const c = SIZE / 2
  const point = (a: number, rad: number) =>
    `${(c + rad * Math.sin(a)).toFixed(2)} ${(c - rad * Math.cos(a)).toFixed(2)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return [
    `M ${point(a0, r)}`,
    `A ${r} ${r} 0 ${large} 1 ${point(a1, r)}`,
    `L ${point(a1, inner)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${point(a0, inner)}`,
    'Z',
  ].join(' ')
}

/** One split: the ring (its total, or the part hovered, in the middle) and its parts listed */
function Ring({
  title,
  slices,
  rotationTime,
  lead,
}: {
  title: string
  slices: Slice[]
  rotationTime?: number
  /** In the middle, the largest part (not the total) when nothing is hovered */
  lead?: boolean
}) {
  const { t } = useTranslation('page_team')
  const titleId = useId()
  const [hover, setHover] = useState<string>()
  const total = slices.reduce((s, x) => s + x.value, 0)
  const shown = slices.filter((s) => s.value > 0)
  const r = SIZE / 2 - 1
  const inner = r - THICK
  const mid = (r + inner) / 2
  const gap = shown.length > 1 ? GAP / mid : 0
  let at = 0
  const parts = shown.map((s) => {
    const span = (s.value / total) * Math.PI * 2
    const a0 = at + gap / 2
    const a1 = at + Math.max(span - gap / 2, gap / 2 + 0.001)
    at += span
    return {
      ...s,
      d: span >= Math.PI * 2 - 1e-6 ? undefined : arc(a0, a1, r, inner),
    }
  })
  const focus = hover
    ? shown.find((s) => s.key === hover)
    : lead
      ? shown.reduce<Slice | undefined>(
          (top, s) => (!top || s.value > top.value ? s : top),
          undefined
        )
      : undefined
  const pct = (v: number) =>
    total ? `${((v / total) * 100).toFixed(v / total < 0.1 ? 1 : 0)}%` : '–'
  const unit = rotationTime
    ? t('teamOpt.kqm.dps', 'DPS')
    : t('teamOpt.kqm.dmg', 'DMG')

  return (
    <Box aria-labelledby={titleId} sx={{ minWidth: 0 }}>
      <Typography id={titleId} sx={{ ...type.label, mb: 1.25 }}>
        {title}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        {/* the ring: each part a sector, 2 px apart; the middle says what is hovered */}
        <Box
          sx={{
            position: 'relative',
            width: SIZE,
            height: SIZE,
            flex: '0 0 auto',
            mx: 'auto',
          }}
        >
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="img"
            aria-label={`${title}: ${shown.map((s) => `${s.label} ${pct(s.value)}`).join(', ')}`}
          >
            {parts.map((p) => (
              <Tooltip
                key={p.key}
                followCursor
                title={`${p.label}: ${pct(p.value)} · ${formatRateFull(p.value, rotationTime)} ${unit}`}
              >
                {p.d ? (
                  // biome-ignore lint/a11y/noStaticElementInteractions: a hover highlight only (every part is listed beside the ring)
                  <path
                    d={p.d}
                    fill={p.color}
                    opacity={hover && hover !== p.key ? 0.28 : 1}
                    onMouseEnter={() => setHover(p.key)}
                    onMouseLeave={() => setHover(undefined)}
                    style={{ transition: 'opacity .15s', cursor: 'default' }}
                  />
                ) : (
                  // biome-ignore lint/a11y/noStaticElementInteractions: a hover highlight only (every part is listed beside the ring)
                  <circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={mid}
                    fill="none"
                    stroke={p.color}
                    strokeWidth={THICK}
                    onMouseEnter={() => setHover(p.key)}
                    onMouseLeave={() => setHover(undefined)}
                  />
                )}
              </Tooltip>
            ))}
          </svg>
          <Box
            sx={{
              position: 'absolute',
              inset: THICK + 8,
              display: 'grid',
              placeContent: 'center',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography
              sx={{ fontSize: 19, fontWeight: 650, lineHeight: 1.15, ...numSx }}
            >
              {focus ? pct(focus.value) : formatRateFull(total, rotationTime)}
            </Typography>
            <Typography
              sx={{
                ...type.label,
                fontSize: 11.5,
                mt: 0.25,
                maxWidth: SIZE - 2 * THICK - 24,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {focus ? focus.label : t('teamOpt.kqm.teamDps', 'team DPS')}
            </Typography>
          </Box>
        </Box>
        {/* the parts, largest share first in the element split; names in ink, the swatch is the key */}
        <Box
          component="ul"
          sx={{
            listStyle: 'none',
            m: 0,
            p: 0,
            // (capped: each part's figures stay beside its name on a wide screen)
            flex: '1 1 180px',
            maxWidth: 300,
            minWidth: 0,
            display: 'grid',
            gap: 0.25,
          }}
        >
          {slices.map((s) => (
            <Box
              component="li"
              key={s.key}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(undefined)}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                alignItems: 'center',
                columnGap: 1,
                px: 0.75,
                py: 0.5,
                borderRadius: 1.5,
                bgcolor: hover === s.key ? 'action.hover' : 'transparent',
                opacity: hover && hover !== s.key ? 0.6 : 1,
                transition: 'opacity .15s, background-color .15s',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '3px',
                    bgcolor: s.color,
                    flex: '0 0 auto',
                  }}
                />
                {s.icon}
              </Box>
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 550,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.label}
              </Typography>
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 650,
                  textAlign: 'right',
                  ...numSx,
                }}
              >
                {pct(s.value)}
                <Box
                  component="span"
                  sx={{
                    display: 'block',
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: 'text.secondary',
                  }}
                >
                  {formatRateFull(s.value, rotationTime)}
                </Box>
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}
