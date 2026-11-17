import { stygianBossIcons } from '@genshin-optimizer/gi/assets'
import type { ElementWithPhyKey } from '@genshin-optimizer/gi/consts'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type { Team } from '@genshin-optimizer/gi/db'
import { useDatabase, useTeam } from '@genshin-optimizer/gi/db-ui'
import { ElementIcon } from '@genshin-optimizer/gi/svgicons'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type {
  StygianBoss,
  StygianDifficultyKey,
  StygianPhaseKey,
} from '@genshin-optimizer/gi/ui'
import {
  appliedStygianPreset,
  currentStygianSeason,
  StygianResSummary,
  stygianBosses,
  stygianBossName,
  stygianBossTitle,
  stygianDifficulties,
  stygianEnemy,
  stygianPhaseName,
  stygianPresetKey,
} from '@genshin-optimizer/gi/ui'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  alpha,
  Box,
  ButtonBase,
  Collapse,
  InputBase,
  Link,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FieldLabel,
  focusSx,
  hairline,
  numSx,
  Pill,
  quickSx,
  Segmented,
  selectedSx,
  tokens,
  type,
} from '../TeamOptimize/ui'
import { GameText } from './GameText'

const WIKI_RES =
  'https://genshin-impact.fandom.com/wiki/Resistance#Base_Enemy_Resistances'
const IMMUNE = Number.MAX_VALUE

const compact = (digits: number) =>
  new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumSignificantDigits: digits,
  })

type Mode = 'custom' | 'stygian'

/**
 * The enemy the team's damage is for, set one of two ways: by hand (its level, each element's
 * RES, DEF shred) or as a Stygian Onslaught boss, picked from its catalogue (the game's icons and
 * text; its HP and RES per phase, stygian.moe's)
 */
export function EnemyPanel({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const team = useTeam(teamId)
  const applied = team && appliedStygianPreset(team)
  const database = useDatabase()
  const [mode, setMode] = useState<Mode>(applied ? 'stygian' : 'custom')
  // Custom: the enemy is the team's own from now on (the boss's numbers, to edit); a boss is set
  // by picking one in the catalogue
  const pickMode = (next: Mode) => {
    setMode(next)
    if (next === 'custom' && team?.enemyPreset)
      database.teams.set(teamId, (team) => {
        delete team.enemyPreset
      })
  }
  if (!team) return null
  return (
    <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <Segmented
        value={mode}
        onChange={pickMode}
        aria-label={t('enemy.mode', 'How the enemy is set')}
        options={[
          { value: 'custom', label: t('enemy.custom', 'Custom RES') },
          {
            value: 'stygian',
            label: t('enemy.stygian', 'Stygian Onslaught boss'),
          },
        ]}
      />
      {mode === 'custom' ? (
        <CustomEnemy teamId={teamId} team={team} />
      ) : (
        <StygianCatalogue teamId={teamId} team={team} />
      )}
    </Box>
  )
}

/* ---------- by hand ---------- */

/** A number field that saves when left (or on Enter) */
function NumberField({
  value,
  onChange,
  suffix,
  disabled,
  placeholder,
  'aria-label': ariaLabel,
  width = 64,
}: {
  value: number
  onChange: (value: number) => void
  suffix?: string
  disabled?: boolean
  placeholder?: string
  'aria-label': string
  width?: number
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const save = () => {
    const n = Number.parseFloat(text.replace(',', '.'))
    if (Number.isFinite(n) && n !== value) onChange(n)
    else setText(String(value))
  }
  return (
    <InputBase
      value={disabled ? '' : text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      inputProps={{ inputMode: 'decimal', 'aria-label': ariaLabel }}
      endAdornment={
        suffix ? (
          <Box
            component="span"
            sx={{ color: 'text.secondary', fontSize: 13, ml: 0.25 }}
          >
            {suffix}
          </Box>
        ) : undefined
      }
      sx={{
        width,
        height: 32,
        px: 1,
        borderRadius: tokens.radius.control,
        bgcolor: giTokens.panelDark,
        boxShadow: `inset 0 0 0 1px ${giTokens.hairlineStrong}`,
        fontSize: 14,
        fontWeight: 600,
        ...numSx,
        ...quickSx,
        '& input': { textAlign: 'right', p: 0 },
        '&.Mui-focused': {
          boxShadow: `inset 0 0 0 1px ${alpha(giTokens.gold, 0.7)}`,
        },
        '&.Mui-disabled': { opacity: 0.6 },
      }}
    />
  )
}

function CustomEnemy({ teamId, team }: { teamId: string; team: Team }) {
  const { t } = useTranslation(['page_team', 'sheet_gen'])
  const database = useDatabase()
  const { enemyOverride } = team
  const set = (key: keyof Team['enemyOverride'], value: number | undefined) =>
    database.teams.set(teamId, (team) => {
      if (value === undefined) delete team.enemyOverride[key]
      else team.enemyOverride[key] = value
    })
  const allTen = allElementWithPhyKeys.every(
    (e) => (enemyOverride[`${e}_enemyRes_`] ?? 10) === 10
  )
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {/* the level and the team's DEF shred */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 3,
          rowGap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FieldLabel>{t('enemy.level', 'Level')}</FieldLabel>
          <NumberField
            value={enemyOverride.enemyLevel ?? 100}
            onChange={(v) =>
              set('enemyLevel', Math.max(1, Math.min(200, Math.round(v))))
            }
            aria-label={t('enemy.level', 'Level')}
            width={60}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FieldLabel
            tip={t(
              'enemy.defRedTip',
              'DEF lowered by the team (Lisa’s A4, Zhongli’s… see each kit): the enemy’s DEF is multiplied by 1 − this.'
            )}
          >
            {t('enemy.defRed', 'DEF reduction')}
          </FieldLabel>
          <NumberField
            value={enemyOverride.enemyDefRed_ ?? 0}
            onChange={(v) => set('enemyDefRed_', Math.max(0, Math.min(100, v)))}
            suffix="%"
            aria-label={t('enemy.defRed', 'DEF reduction')}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FieldLabel
            tip={t(
              'enemy.defIgnTip',
              'DEF ignored by the attacker (Raiden’s C2, Nahida’s C2…).'
            )}
          >
            {t('enemy.defIgn', 'DEF ignored')}
          </FieldLabel>
          <NumberField
            value={enemyOverride.enemyDefIgn_ ?? 0}
            onChange={(v) => set('enemyDefIgn_', Math.max(0, Math.min(100, v)))}
            suffix="%"
            aria-label={t('enemy.defIgn', 'DEF ignored')}
          />
        </Box>
      </Box>

      {/* each element's RES: a tile each */}
      <Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 1,
          }}
        >
          <FieldLabel
            tip={t(
              'enemy.resTip',
              'The enemy’s own RES, before the team’s shred (the calculation takes it off: below 0%, the game halves what is left; enter 10%, not −10%).'
            )}
          >
            {t('enemy.res', 'RES')}
          </FieldLabel>
          <Box sx={{ flexGrow: 1 }} />
          <Pill
            disabled={allTen}
            onClick={() =>
              database.teams.set(teamId, (team) => {
                for (const e of allElementWithPhyKeys)
                  team.enemyOverride[`${e}_enemyRes_`] = 10
              })
            }
            icon={<RestartAltRoundedIcon sx={{ fontSize: 16 }} />}
          >
            {t('enemy.resetRes', 'All 10%')}
          </Pill>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(4, minmax(0, 1fr))',
            },
          }}
        >
          {allElementWithPhyKeys.map((e) => {
            const key = `${e}_enemyRes_` as const
            const value = enemyOverride[key] ?? 10
            const immune = value === IMMUNE
            const name = t(`sheet_gen:element.${e}`, {
              defaultValue: e[0].toUpperCase() + e.slice(1),
            })
            return (
              <Box
                key={e}
                sx={(theme) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  minWidth: 0,
                  pl: 1.25,
                  pr: 0.75,
                  py: 0.75,
                  borderRadius: tokens.radius.inset,
                  bgcolor: alpha(theme.palette[e].main, 0.07),
                  boxShadow: `inset 0 0 0 1px ${alpha(theme.palette[e].main, 0.22)}`,
                })}
              >
                <ElementIcon ele={e} iconProps={{ sx: { fontSize: 20 } }} />
                <Typography
                  noWrap
                  sx={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600 }}
                >
                  {name}
                </Typography>
                <NumberField
                  value={immune ? 10 : value}
                  disabled={immune}
                  placeholder={t('enemy.immune', 'Immune')}
                  onChange={(v) => set(key, Math.max(-500, Math.min(500, v)))}
                  suffix={immune ? undefined : '%'}
                  aria-label={t('enemy.resOf', {
                    defaultValue: '{{element}} RES',
                    element: name,
                  })}
                />
                <Tooltip
                  arrow
                  title={
                    immune
                      ? t('enemy.immuneOff', 'Immune: click to give it RES')
                      : t('enemy.immuneOn', 'Make it immune to this element')
                  }
                >
                  <ButtonBase
                    onClick={() => set(key, immune ? 10 : IMMUNE)}
                    aria-pressed={immune}
                    aria-label={t('enemy.immuneOf', {
                      defaultValue: 'Immune to {{element}}',
                      element: name,
                    })}
                    sx={(theme) => ({
                      width: 28,
                      height: 28,
                      borderRadius: tokens.radius.control,
                      fontSize: 17,
                      color: immune ? theme.palette[e].main : 'text.disabled',
                      bgcolor: immune
                        ? alpha(theme.palette[e].main, 0.16)
                        : 'transparent',
                      ...quickSx,
                      ...focusSx,
                      '&:hover': { color: theme.palette[e].main },
                    })}
                  >
                    ∞
                  </ButtonBase>
                </Tooltip>
              </Box>
            )
          })}
        </Box>
      </Box>
      <Typography sx={{ ...type.label, fontWeight: 400 }}>
        {t('enemy.wikiLead', 'Other enemies’ RES:')}{' '}
        <Link href={WIKI_RES} target="_blank" rel="noreferrer" color="inherit">
          {t('enemy.wiki', 'the wiki')}
          <OpenInNewIcon sx={{ fontSize: 13, ml: 0.25, verticalAlign: -2 }} />
        </Link>
      </Typography>
    </Box>
  )
}

/* ---------- Stygian Onslaught ---------- */

export const levelOf = (key: StygianDifficultyKey) =>
  stygianDifficulties.find((d) => d.key === key)!.level

function StygianCatalogue({ teamId, team }: { teamId: string; team: Team }) {
  const { t, i18n } = useTranslation(['page_team', 'stygian'])
  const database = useDatabase()
  const applied = appliedStygianPreset(team)
  const [difficulty, setDifficulty] = useState<StygianDifficultyKey>(
    applied?.difficulty ?? 'dire'
  )
  useEffect(() => {
    if (applied?.difficulty) setDifficulty(applied.difficulty)
  }, [applied?.difficulty])
  const [search, setSearch] = useState('')
  const season = currentStygianSeason()
  const apply = (boss: StygianBoss, phase: StygianPhaseKey = boss.main) =>
    database.teams.set(teamId, (team) => {
      Object.assign(
        team.enemyOverride,
        stygianEnemy(boss.id, phase, levelOf(difficulty))
      )
      team.enemyPreset = stygianPresetKey(boss.id, phase)
    })
  const pickDifficulty = (key: StygianDifficultyKey) => {
    setDifficulty(key)
    // (the boss set: at that difficulty's level)
    if (applied)
      database.teams.set(teamId, (team) => {
        team.enemyOverride.enemyLevel = levelOf(key)
      })
  }
  const query = search.trim().toLowerCase()
  const shown = (b: StygianBoss) =>
    !query || stygianBossName(t, b.id).toLowerCase().includes(query)
  const now = stygianBosses.filter(
    (b) => season?.bosses.includes(b.id) && shown(b)
  )
  const earlier = stygianBosses.filter(
    (b) => !season?.bosses.includes(b.id) && shown(b)
  )
  const until =
    season &&
    new Date(`${season.end}T00:00:00`).toLocaleDateString(i18n.language, {
      month: 'short',
      day: 'numeric',
    })
  return (
    <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
      {/* the difficulty, and a search */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Segmented
          value={difficulty}
          onChange={pickDifficulty}
          aria-label={t('enemy.difficulty', 'Difficulty')}
          options={stygianDifficulties.map((d) => ({
            value: d.key,
            label:
              d.key === 'fearless'
                ? t('enemy.fearless', {
                    defaultValue: 'Fearless · Lv. {{level}}',
                    level: d.level,
                  })
                : t('enemy.dire', {
                    defaultValue: 'Dire · Lv. {{level}}',
                    level: d.level,
                  }),
          }))}
        />
        <Box sx={{ flexGrow: 1 }} />
        <InputBase
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('enemy.search', 'Find a boss')}
          startAdornment={
            <SearchRoundedIcon
              sx={{ fontSize: 18, color: 'text.secondary', mr: 0.75 }}
            />
          }
          inputProps={{ 'aria-label': t('enemy.search', 'Find a boss') }}
          sx={{
            width: { xs: '100%', sm: 220 },
            height: 34,
            px: 1.25,
            borderRadius: tokens.radius.control,
            bgcolor: giTokens.panelDark,
            boxShadow: `inset 0 0 0 1px ${giTokens.hairlineStrong}`,
            fontSize: 14,
            '&.Mui-focused': {
              boxShadow: `inset 0 0 0 1px ${alpha(giTokens.gold, 0.7)}`,
            },
          }}
        />
      </Box>

      {/* the boss set: its details */}
      {applied && (
        <BossDetail
          boss={applied.boss}
          phase={applied.phase.key}
          difficulty={difficulty}
          onPhase={(phase) => apply(applied.boss, phase)}
        />
      )}

      {now.length > 0 && (
        <BossSection
          title={
            season
              ? t('enemy.thisSeason', {
                  defaultValue: 'This season · {{season}}',
                  season: t(`stygian:season.${season.id}`, ''),
                })
              : ''
          }
          meta={
            until &&
            t('enemy.until', { defaultValue: 'until {{date}}', date: until })
          }
          bosses={now}
          selected={applied?.boss.id}
          difficulty={difficulty}
          onPick={apply}
          large
        />
      )}
      {earlier.length > 0 && (
        <BossSection
          title={t('enemy.earlier', 'Earlier seasons')}
          bosses={earlier}
          selected={applied?.boss.id}
          difficulty={difficulty}
          onPick={apply}
        />
      )}
      {!now.length && !earlier.length && (
        <Typography sx={type.label}>
          {t('enemy.none', 'No boss by that name.')}
        </Typography>
      )}
      <Typography sx={{ ...type.label, fontWeight: 400 }}>
        {t(
          'enemy.sources',
          'Bosses, icons and descriptions: the game’s. HP and RES per phase:'
        )}{' '}
        <Link
          href="https://www.stygian.moe"
          target="_blank"
          rel="noreferrer"
          color="inherit"
        >
          stygian.moe
        </Link>
        {t('enemy.sourcesChecked', ', checked against the game data.')}
      </Typography>
    </Box>
  )
}

function BossSection({
  title,
  meta,
  bosses,
  selected,
  difficulty,
  onPick,
  large,
}: {
  title: string
  meta?: string
  bosses: StygianBoss[]
  selected?: number
  difficulty: StygianDifficultyKey
  onPick: (boss: StygianBoss) => void
  large?: boolean
}) {
  return (
    <Box component="section" sx={{ display: 'grid', gap: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography component="h3" sx={{ ...type.title, fontSize: 14 }}>
          {title}
        </Typography>
        {meta && <Typography sx={type.label}>{meta}</Typography>}
      </Box>
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: large
              ? 'repeat(3, minmax(0, 1fr))'
              : 'repeat(3, minmax(0, 1fr))',
            lg: large
              ? 'repeat(3, minmax(0, 1fr))'
              : 'repeat(4, minmax(0, 1fr))',
          },
        }}
      >
        {bosses.map((b) => (
          <BossCard
            key={b.id}
            boss={b}
            selected={b.id === selected}
            difficulty={difficulty}
            onClick={() => onPick(b)}
            large={large}
          />
        ))}
      </Box>
    </Box>
  )
}

/** A boss's icon, on the game's dark tile */
function BossIcon({ id, size }: { id: number; size: number }) {
  const src = stygianBossIcons[id]
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size > 60 ? 2.5 : 2,
        overflow: 'hidden',
        bgcolor: alpha(giTokens.parchment, 0.06),
        boxShadow: `inset 0 0 0 1px ${giTokens.hairline}`,
      }}
    >
      {src && (
        <Box
          component="img"
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          sx={{ width: '100%', height: '100%', display: 'block' }}
        />
      )}
    </Box>
  )
}

export function BossCard({
  boss,
  selected,
  difficulty,
  onClick,
  large,
}: {
  boss: StygianBoss
  selected: boolean
  difficulty: StygianDifficultyKey
  onClick: () => void
  large?: boolean
}) {
  const { t } = useTranslation(['page_team', 'stygian'])
  const main = boss.phases.find((p) => p.key === boss.main)!
  const title = stygianBossTitle(t, boss.id)
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={selected}
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1.25,
          p: 1,
          pr: 1.25,
          minWidth: 0,
          textAlign: 'left',
          borderRadius: tokens.radius.inset,
          bgcolor: giTokens.panelDark,
          boxShadow: `inset 0 0 0 1px ${giTokens.hairline}`,
          ...quickSx,
          ...focusSx,
          '&:hover': {
            bgcolor: giTokens.panelHover,
            boxShadow: `inset 0 0 0 1px ${giTokens.hairlineStrong}`,
          },
        },
        selected && selectedSx,
      ]}
    >
      <BossIcon id={boss.id} size={large ? 64 : 48} />
      <Box sx={{ minWidth: 0, flex: 1, display: 'grid', gap: 0.25 }}>
        <Box title={stygianBossName(t, boss.id)} sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: large ? 14.5 : 13.5,
              fontWeight: 650,
              lineHeight: 1.3,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
            }}
          >
            {title.name}
          </Typography>
          {title.stage && (
            <Typography noWrap sx={{ ...type.label, fontSize: 12 }}>
              {title.stage}
            </Typography>
          )}
        </Box>
        <Typography
          component="div"
          sx={{
            ...type.label,
            ...numSx,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 1,
          }}
        >
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
            {t('enemy.hp', {
              defaultValue: '{{hp}} HP',
              hp: compact(3).format(boss.hp[difficulty]),
            })}
          </Box>
          <StygianResSummary res={main.res} />
        </Typography>
      </Box>
      {selected && (
        <CheckRoundedIcon sx={{ fontSize: 20, color: giTokens.gold }} />
      )}
    </ButtonBase>
  )
}

/** The boss set: its HP, its phases, what helps against it, and its full description */
function BossDetail({
  boss,
  phase,
  difficulty,
  onPhase,
}: {
  boss: StygianBoss
  phase: StygianPhaseKey
  difficulty: StygianDifficultyKey
  onPhase: (phase: StygianPhaseKey) => void
}) {
  const { t } = useTranslation(['page_team', 'stygian'])
  const [open, setOpen] = useState(false)
  const current = boss.phases.find((p) => p.key === phase) ?? boss.phases[0]
  const tags = t(`stygian:tags.${boss.id}`, {
    returnObjects: true,
    defaultValue: {},
  }) as { good?: string; bad?: string }
  const mechanics = t(`stygian:mechanics.${boss.id}`, {
    returnObjects: true,
    defaultValue: [],
  }) as { name: string; text: string }[]
  const lore = t(`stygian:lore.${boss.id}`, { defaultValue: '' })
  return (
    <Box
      sx={(theme) => ({
        display: 'grid',
        gap: 1.5,
        p: { xs: 1.5, sm: 2 },
        borderRadius: tokens.radius.panel,
        bgcolor: alpha(theme.palette.primary.main, 0.05),
        boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.35)}`,
      })}
    >
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
        <BossIcon id={boss.id} size={76} />
        <Box sx={{ minWidth: 0, display: 'grid', gap: 0.5 }}>
          <Box>
            <Typography sx={{ ...type.section, lineHeight: 1.25 }}>
              {stygianBossTitle(t, boss.id).name}
            </Typography>
            {stygianBossTitle(t, boss.id).stage && (
              <Typography sx={{ ...type.label, fontSize: 13 }}>
                {stygianBossTitle(t, boss.id).stage}
              </Typography>
            )}
          </Box>
          <Typography sx={{ ...type.label, ...numSx }}>
            <Box
              component="span"
              sx={{ color: 'text.primary', fontWeight: 650 }}
            >
              {t('enemy.hpFull', {
                defaultValue: '{{hp}} HP',
                hp: new Intl.NumberFormat('en').format(boss.hp[difficulty]),
              })}
            </Box>
            {' · '}
            {difficulty === 'fearless'
              ? t('enemy.fearlessShort', {
                  defaultValue: 'Fearless, Lv. {{level}}',
                  level: levelOf('fearless'),
                })
              : t('enemy.direShort', {
                  defaultValue: 'Dire, Lv. {{level}}',
                  level: levelOf('dire'),
                })}
          </Typography>
          {(tags.good || tags.bad) && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                columnGap: 2,
                rowGap: 0.25,
                fontSize: 13,
              }}
            >
              {tags.good && (
                <span>
                  <Box
                    component="span"
                    sx={{ color: 'success.main', fontWeight: 650 }}
                  >
                    {t('enemy.good', 'Strong against it:')}
                  </Box>{' '}
                  <GameText text={tags.good} />
                </span>
              )}
              {tags.bad && (
                <span>
                  <Box
                    component="span"
                    sx={{ color: 'error.main', fontWeight: 650 }}
                  >
                    {t('enemy.bad', 'Weak against it:')}
                  </Box>{' '}
                  <GameText text={tags.bad} />
                </span>
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* its RES: the phase picked (the one its HP is mostly taken in, first) */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 1.5,
          rowGap: 1,
        }}
      >
        {boss.phases.length > 1 && (
          <Segmented
            size="small"
            value={current.key}
            onChange={onPhase}
            aria-label={t('enemy.phase', 'Phase')}
            options={boss.phases.map((p) => ({
              value: p.key,
              label: stygianPhaseName(t, p.key),
            }))}
          />
        )}
        <Typography
          component="div"
          sx={{ fontSize: 13.5, ...numSx, display: 'flex', gap: 1 }}
        >
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {t('enemy.res', 'RES')}
          </Box>
          <StygianResSummary res={current.res} />
        </Typography>
      </Box>

      {/* the game's own description: its mechanics, then its lore */}
      {(mechanics.length > 0 || lore) && (
        <Box>
          <ButtonBase
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            sx={{
              gap: 0.5,
              px: 0.5,
              ml: -0.5,
              borderRadius: tokens.radius.control,
              fontSize: 13.5,
              fontWeight: 650,
              color: 'text.secondary',
              ...quickSx,
              ...focusSx,
              '&:hover': { color: 'text.primary' },
            }}
          >
            <KeyboardArrowDownRoundedIcon
              sx={{
                fontSize: 20,
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform .18s',
              }}
            />
            {t('enemy.description', {
              defaultValue: 'How the fight goes ({{count}} mechanics)',
              count: mechanics.length,
            })}
          </ButtonBase>
          <Collapse in={open} timeout={180} unmountOnExit>
            <Box sx={{ display: 'grid', gap: 1.25, mt: 1, maxWidth: 820 }}>
              {mechanics.map((m) => (
                <Box key={m.name} sx={{ borderLeft: hairline, pl: 1.5 }}>
                  <Typography sx={{ ...type.title, fontSize: 14, mb: 0.25 }}>
                    {m.name}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      color: 'text.secondary',
                    }}
                  >
                    <GameText text={m.text} />
                  </Typography>
                </Box>
              ))}
              {lore && (
                <Typography
                  sx={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: 'text.secondary',
                    fontStyle: 'italic',
                  }}
                >
                  <GameText text={lore} />
                </Typography>
              )}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  )
}

/** The enemy in one line: the boss's icon and name, or "Custom", its level and RES */
export function EnemyHeadline({
  team,
  large,
}: {
  team: Team
  /** Bigger, with its stage's name and HP (a setup's) */
  large?: boolean
}) {
  const { t } = useTranslation(['page_team', 'stygian'])
  const applied = appliedStygianPreset(team)
  const { enemyOverride } = team
  const res = Object.fromEntries(
    allElementWithPhyKeys.map((e: ElementWithPhyKey) => {
      const v = enemyOverride[`${e}_enemyRes_`] ?? 10
      return [e, v === IMMUNE ? 'immune' : v]
    })
  ) as Parameters<typeof StygianResSummary>[0]['res']
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        minWidth: 0,
      }}
    >
      {applied && <BossIcon id={applied.boss.id} size={large ? 56 : 36} />}
      <Box sx={{ minWidth: 0, display: 'grid', gap: large ? 0.25 : 0 }}>
        <Typography
          noWrap={!large}
          sx={{ fontSize: large ? 15 : 14, fontWeight: 650, lineHeight: 1.3 }}
        >
          {applied
            ? large
              ? stygianBossTitle(t, applied.boss.id).name
              : stygianBossName(t, applied.boss.id)
            : t('enemy.customShort', 'Custom enemy')}
        </Typography>
        {large && applied && (
          <Typography sx={{ ...type.label, ...numSx }}>
            {[
              stygianBossTitle(t, applied.boss.id).stage,
              applied.difficulty &&
                t('enemy.hp', {
                  defaultValue: '{{hp}} HP',
                  hp: compact(3).format(applied.boss.hp[applied.difficulty]),
                }),
              applied.phase.key !== applied.boss.main &&
                stygianPhaseName(t, applied.phase.key),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        )}
        <Typography
          component="div"
          sx={{
            ...type.label,
            ...numSx,
            display: 'flex',
            flexWrap: 'wrap',
            columnGap: 1,
          }}
        >
          <span>
            {t('enemy.levelShort', {
              defaultValue: 'Lv. {{level}}',
              level: enemyOverride.enemyLevel ?? 100,
            })}
          </span>
          <StygianResSummary res={res} />
        </Typography>
      </Box>
    </Box>
  )
}
