import {
  BootstrapTooltip,
  InfoTooltipInline,
} from '@genshin-optimizer/common/ui'
import { artifactAsset } from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  CharacterKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import { getArtSetStat } from '@genshin-optimizer/gi/stats'
import { StatIcon } from '@genshin-optimizer/gi/svgicons'
import type { KqmBuild } from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  ArtifactSetTooltip,
  KQM_FIXED_ROLLS,
  kqmArtifactStats,
  kqmBuildRarity,
  kqmChosenRolls,
  kqmWeaponData,
  quickTooltipProps,
  statName,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import { getMainStatValue } from '@genshin-optimizer/gi/util'
import type { TooltipProps } from '@mui/material'
import { Box, Tooltip, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { mainStatLabel } from './format'
import { WeaponDetails, WeaponThumb } from './TeamOptResults'
import { hairline, numSx, type } from './ui'

const numberFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
export const artifactStatValue = (key: string, value: number) =>
  key.endsWith('_')
    ? `${(value * 100).toFixed(1)}%`
    : numberFormat.format(value)

export function KqmBuildView({
  characterKey,
  build,
  equipment,
}: {
  characterKey: CharacterKey
  build: KqmBuild
  equipment?: ReactNode
}) {
  const { t } = useTranslation('page_team')
  const weapon = kqmWeaponData(build.weapon, characterKey)
  const order = [
    'critRate_',
    'critDMG_',
    'enerRech_',
    'eleMas',
    build.mains.goblet.endsWith('_dmg_') ? build.mains.goblet : 'heal_',
    'atk_',
    'atk',
    'hp_',
    'hp',
    'def_',
    'def',
  ]
  // (a 4★ set: four of its pieces are 4★, one of sands, goblet and circlet the 5★ off-piece)
  const rarity = kqmBuildRarity(build)
  const tier = !!build.standard && build.standard !== 'kqms'
  const fourStar = rarity.four
  const slotFour = (slot: 'sands' | 'goblet' | 'circlet') =>
    fourStar >= 4 && (build.mains.off ?? 'circlet') !== slot
  const stats = kqmArtifactStats(build).sort(
    (a, b) => order.indexOf(a.key) - order.indexOf(b.key)
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      {equipment ?? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BootstrapTooltip title={<WeaponDetails weapon={weapon} />}>
            <Box>
              <WeaponThumb weapon={weapon} highlight={false} />
            </Box>
          </BootstrapTooltip>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
              <WeaponName weaponKey={weapon.key} />
            </Typography>
            <SetLines sets={build.sets} />
          </Box>
        </Box>
      )}
      {/* the three main stats that are chosen: one aligned row each */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
            {t('teamOpt.kqm.mainStats', 'Main stats')}
          </Typography>
          {fourStar > 0 && (
            <InfoTooltipInline
              title={
                tier
                  ? t('teamOpt.kqm.fourStarTipTier', {
                      defaultValue:
                        '{{count}} of the five artifacts are 4★ (this set’s pieces): a 4★ piece has a +16 main stat, 2 fewer upgrades, and each roll 0.8 of a 5★ one’s.',
                      count: fourStar,
                    })
                  : t('teamOpt.kqm.fourStarTip', {
                      defaultValue:
                        '{{count}} of the five artifacts are 4★ (this set’s pieces). By KQM Standards a 4★ piece has a +16 main stat, 0.8 of a 5★ piece’s substats and 2 fewer distributed rolls: this build places {{rolls}}.',
                      count: fourStar,
                      rolls: rarity.rolls,
                    })
              }
            />
          )}
        </Box>
        {(['sands', 'goblet', 'circlet'] as const).map((slot, i) => (
          <Box
            key={slot}
            sx={{
              display: 'grid',
              gridTemplateColumns: '64px minmax(0, 1fr) auto',
              alignItems: 'baseline',
              columnGap: 1,
              py: 0.75,
              borderTop: i ? hairline : undefined,
            }}
          >
            <Typography sx={{ ...type.label, fontSize: 12 }}>
              {t(`teamOpt.kqm.${slot}`)}
            </Typography>
            <Typography sx={{ fontSize: 13.5, minWidth: 0, lineHeight: 1.4 }}>
              {mainStatLabel(build.mains[slot])}
              {fourStar > 0 && (
                <Box
                  component="span"
                  sx={{ ml: 0.75, fontSize: 11.5, color: 'text.secondary' }}
                >
                  {slotFour(slot) ? '4★' : '5★'}
                </Box>
              )}
            </Typography>
            <Typography
              sx={{
                fontSize: 14,
                fontWeight: 600,
                textAlign: 'right',
                ...numSx,
              }}
            >
              {artifactStatValue(
                build.mains[slot],
                slotFour(slot)
                  ? getMainStatValue(build.mains[slot], 4, 16)
                  : getMainStatValue(build.mains[slot], 5, 20)
              )}
            </Typography>
          </Box>
        ))}
      </Box>
      <Box
        component="section"
        aria-label={t('teamOpt.kqm.artifactTotals', 'Artifact totals')}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
            {t('teamOpt.kqm.artifactTotals', 'Artifact totals')}
          </Typography>
          <InfoTooltipInline
            title={t(
              'teamOpt.kqm.artifactTotalsTip',
              'Main stats, fixed and distributed rolls from all five artifacts. Excludes weapon, character and set bonuses.'
            )}
          />
          {/* where this build's added rolls went (redistributed for another weapon or set) */}
          <Box sx={{ ml: 'auto' }}>
            <KqmRollLine build={build} />
          </Box>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            columnGap: 2.5,
          }}
        >
          {stats.map(({ key, total, main, fixed, distributed, rolls }, i) => (
            <Tooltip
              key={key}
              arrow
              title={
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    columnGap: 2,
                    rowGap: 0.5,
                    ...numSx,
                  }}
                >
                  <span>{t('teamOpt.kqm.mainStats', 'Main stats')}</span>
                  <span>{artifactStatValue(key, main)}</span>
                  <span>{t('teamOpt.kqm.fixedRolls', 'Fixed rolls')}</span>
                  <span>{artifactStatValue(key, fixed)}</span>
                  <span>
                    {t('teamOpt.kqm.distributedRolls', 'Distributed rolls')} (
                    {rolls})
                  </span>
                  <span>{artifactStatValue(key, distributed)}</span>
                </Box>
              }
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  columnGap: 1,
                  py: 0.75,
                  minWidth: 0,
                  cursor: 'help',
                  borderTop: i >= 2 ? hairline : undefined,
                }}
              >
                <Typography
                  sx={{
                    ...type.label,
                    fontSize: 12,
                    lineHeight: 1.4,
                    minWidth: 0,
                  }}
                >
                  {statName(key)}
                  {['hp_', 'atk_', 'def_'].includes(key) ? '%' : ''}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    ...numSx,
                  }}
                >
                  +{artifactStatValue(key, total)}
                </Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

/** A roll count as shown: whole, or to one decimal (a tier's random share, a 4★ piece's 0.8) */
const rollCount = (n: number) =>
  Math.abs(n - Math.round(n)) < 0.05 ? `${Math.round(n)}` : n.toFixed(1)

/**
 * Where a build's rolls went, compactly: each substat given any, as its icon and count (most
 * first). KQMS: its distributed rolls, the hover card adding the 2 fixed of every substat. A tier:
 * each stat's rolls, the hover card splitting them into the wanted lines and upgrades it chose and
 * the random ones, with the set's total.
 */
export function KqmRollLine({
  build,
}: {
  build: Pick<KqmBuild, 'rolls' | 'sets' | 'mains' | 'standard' | 'layout'>
}) {
  const { t } = useTranslation('page_team')
  const tier = !!build.standard && build.standard !== 'kqms'
  const chosen = kqmChosenRolls(build)
  const fixed = tier ? 0 : KQM_FIXED_ROLLS
  const totalOf = (key: SubstatKey) =>
    tier ? (build.rolls[key] ?? 0) : fixed + (build.rolls[key] ?? 0)
  const given = (Object.entries(chosen) as [SubstatKey, number][])
    .filter(([, n]) => n > 0)
    .map(([key]) => [key, tier ? totalOf(key) : chosen[key]!] as const)
    .sort(([, a], [, b]) => b - a)
  if (!given.length) return null
  const rows = tier
    ? allSubstatKeys
        .filter((key) => totalOf(key) >= 0.05)
        .sort((a, b) => totalOf(b) - totalOf(a))
    : given.map(([key]) => key)
  const setTotal = allSubstatKeys.reduce((a, key) => a + totalOf(key), 0)
  const name = (key: string) =>
    `${statName(key)}${['hp_', 'atk_', 'def_'].includes(key) ? '%' : ''}`
  const head = { fontSize: 11, color: 'text.secondary', textAlign: 'right' }
  const cell = { textAlign: 'right', py: 0.5, borderTop: hairline }
  return (
    <BootstrapTooltip
      placement="bottom"
      disableInteractive
      {...quickTooltipProps}
      title={
        <Box sx={{ width: 256, py: 0.25, ...numSx }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.75 }}>
            {t('teamOpt.kqm.rollsTitle', 'Substat rolls')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto auto auto',
              columnGap: 1.5,
              alignItems: 'center',
              fontSize: 12.5,
            }}
          >
            <span />
            <Box sx={head}>
              {tier
                ? t('teamOpt.kqm.rollsRandom', 'Random')
                : t('teamOpt.kqm.rollsFixed', 'Fixed')}
            </Box>
            <Box sx={head}>
              {tier
                ? t('teamOpt.kqm.rollsWanted', 'Wanted')
                : t('teamOpt.kqm.rollsAdded', 'Added')}
            </Box>
            <Box sx={head}>{t('teamOpt.kqm.rollsTotal', 'Total')}</Box>
            {rows.map((key) => {
              const total = totalOf(key)
              const wanted = chosen[key] ?? 0
              return (
                <Fragment key={key}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      minWidth: 0,
                      py: 0.5,
                      borderTop: hairline,
                      '& svg': { fontSize: 14, flexShrink: 0 },
                    }}
                  >
                    <StatIcon statKey={key} />
                    <Box
                      component="span"
                      sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {name(key)}
                    </Box>
                  </Box>
                  <Box sx={{ ...cell, color: 'text.secondary' }}>
                    {rollCount(tier ? total - wanted : fixed)}
                  </Box>
                  <Box sx={cell}>{rollCount(wanted)}</Box>
                  <Box sx={{ ...cell, fontWeight: 600 }}>
                    {rollCount(total)}
                  </Box>
                </Fragment>
              )
            })}
          </Box>
          <Typography sx={{ ...type.label, mt: 0.75 }}>
            {t('teamOpt.kqm.rollsSetTotal', {
              defaultValue:
                '{{rolls}} rolls on the five artifacts (45 at most)',
              rolls: rollCount(setTotal),
            })}
          </Typography>
        </Box>
      }
    >
      <Box
        component="span"
        aria-label={t('teamOpt.kqm.rollsLabelStandard', {
          defaultValue: 'Substat rolls: {{rolls}}',
          rolls: given
            .map(([key, n]) => `${name(key)} ${rollCount(n)}`)
            .join(', '),
        })}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 1.25,
          rowGap: 0.25,
          fontSize: 12.5,
          fontWeight: 600,
          color: 'text.primary',
          cursor: 'help',
          ...numSx,
        }}
      >
        {given.map(([key, n]) => (
          <Box
            key={key}
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              whiteSpace: 'nowrap',
              '& svg': { fontSize: 13, color: 'text.secondary' },
            }}
          >
            <StatIcon statKey={key} />
            {rollCount(n)}
          </Box>
        ))}
      </Box>
    </BootstrapTooltip>
  )
}

/** A corner number on an equipment tile (refinement, pieces in a set) */
const cornerSx = {
  position: 'absolute',
  right: 2,
  bottom: 0,
  fontSize: '0.625rem',
  fontWeight: 700,
  lineHeight: 1.5,
  textShadow: '0 0 3px rgba(0, 0, 0, 0.9), 0 1px 2px rgba(0, 0, 0, 0.8)',
} as const

/**
 * A member card's equipment at a glance: the weapon, then each set's flower with its piece count
 * (details in their tooltips)
 */
export function KqmGearIcons({
  characterKey,
  build,
  size = 34,
}: {
  characterKey: CharacterKey
  build: Pick<KqmBuild, 'weapon' | 'sets'>
  size?: number
}) {
  const { t } = useTranslation('page_team')
  const weapon = kqmWeaponData(build.weapon, characterKey)
  const sets = Object.entries(build.sets) as [ArtifactSetKey, number][]
  return (
    <Box
      role="group"
      aria-label={t('teamOpt.kqm.equipment', 'Equipment')}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}
    >
      <BootstrapTooltip
        title={<WeaponDetails weapon={weapon} />}
        {...quickTooltipProps}
      >
        <Box data-weapon={weapon.key}>
          <WeaponThumb weapon={weapon} highlight={false} size={size} />
        </Box>
      </BootstrapTooltip>
      {sets.map(([setKey, n]) => (
        <ArtifactSetTooltip key={setKey} setKey={setKey} numInSet={n}>
          <Box
            data-set={setKey}
            className={`grad-${Math.max(...(getArtSetStat(setKey)?.rarities ?? [5]))}star`}
            sx={{
              position: 'relative',
              width: size,
              height: size,
              flexShrink: 0,
              borderRadius: 1.5,
              overflow: 'hidden',
            }}
          >
            <Box
              component="img"
              src={artifactAsset(setKey, 'flower')}
              alt=""
              sx={{ width: '100%', height: '100%', display: 'block' }}
            />
            <Typography component="span" sx={cornerSx}>
              {n}
            </Typography>
          </Box>
        </ArtifactSetTooltip>
      ))}
    </Box>
  )
}

export function SetLines({
  sets,
  tooltipPlacement,
}: {
  sets: KqmBuild['sets']
  /** Where the sets' tooltips open (default: above) */
  tooltipPlacement?: TooltipProps['placement']
}) {
  const { t } = useTranslation('page_team')
  if (!Object.keys(sets).length)
    return (
      <Typography
        component="span"
        sx={{ fontSize: 13, color: 'text.secondary' }}
      >
        {t('teamOpt.kqm.noSetBonus', 'No set bonus')}
      </Typography>
    )
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 1.25,
        rowGap: 0.25,
        minWidth: 0,
      }}
    >
      {(Object.entries(sets) as [ArtifactSetKey, number][]).map(
        ([setKey, n]) => (
          <ArtifactSetTooltip
            key={setKey}
            setKey={setKey}
            numInSet={n}
            placement={tooltipPlacement}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <Box
                component="img"
                src={artifactAsset(setKey, 'flower')}
                alt=""
                sx={{ width: 18, height: 18, flexShrink: 0 }}
              />
              <Typography component="span" sx={{ fontSize: 13 }}>
                <Box
                  component="span"
                  sx={{ color: 'text.secondary', ...numSx }}
                >
                  {n}×
                </Box>{' '}
                <ArtifactSetName setKey={setKey} />
              </Typography>
            </Box>
          </ArtifactSetTooltip>
        )
      )}
    </Box>
  )
}
