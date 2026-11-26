import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type {
  ParsedRotation,
  RotationAction,
  RotationTimingSettings,
  SimulationResult,
} from '@genshin-optimizer/gi/ui'
import {
  actionFrameKey,
  CharacterName,
  FIRST_ROTATIONS,
  firstRotations,
  flatActions,
  frameOverrides,
  openerActions,
  STEADY_RANGE,
  seconds as plainSeconds,
} from '@genshin-optimizer/gi/ui'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Divider,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import i18next from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { localizeDecimal } from './format'
import { MemberAvatar } from './MemberAvatar'
import { focusSx, numSx, quickSx, tokens, type } from './ui'

export {
  DEFAULT_SWAP_FRAMES,
  FIRST_ROTATIONS,
  firstRotations,
  flatActions,
  frameOverrides,
  openerActions,
  openerCounted,
  pingToSwapFrames,
  type RotationTimingSettings,
  STEADY_COUNTED,
  STEADY_RANGE,
  STEADY_REPEATS,
  swapFramesToPing,
  type TimingEdit,
  timingPing,
  withPing,
  withSwapFrames,
} from '@genshin-optimizer/gi/ui'

/** Frames as seconds with 2 decimals, in the site's decimal separator ("1.25" / "1,25") */
export const seconds = (frames: number) =>
  localizeDecimal(
    plainSeconds(frames),
    i18next.isInitialized ? i18next.language : undefined
  )

/**
 * Dropdown for choosing which rotations are counted: Steady DPS (the repeating pace) or the
 * first 1–6 rotations from the start (with an "Opener counted" toggle when an opener is written).
 * Shared by the rotation line (`pill`) and the Write rotation modal (`outlined`).
 */
export function RotationsDropdown({
  timing,
  hasOpener,
  onChange,
  disabled,
  variant = 'pill',
}: {
  timing: RotationTimingSettings
  hasOpener: boolean
  onChange: (next: RotationTimingSettings) => void
  disabled?: boolean
  variant?: 'pill' | 'outlined'
}) {
  const { t } = useTranslation('page_team')
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const first = firstRotations(timing)
  const steadyLabel = t('teamOpt.timing.steady', {
    defaultValue: 'Steady DPS (rot {{from}}–{{to}})',
    ...STEADY_RANGE,
  })
  const firstLabel = (n: number) =>
    n === 1
      ? t('teamOpt.timing.firstOne', 'First rotation')
      : t('teamOpt.timing.firstN', {
          defaultValue: 'First {{count}} rotations',
          count: n,
        })
  const currentLabel = first === undefined ? steadyLabel : firstLabel(first)
  const tip = (
    <Box component="span" sx={{ display: 'grid', gap: 1 }}>
      <span>
        <Box component="strong" sx={{ display: 'block' }}>
          {steadyLabel}
        </Box>
        {t('teamOpt.timing.steadyTip', {
          defaultValue:
            'The default. Played {{to}} times in a row, rotations {{from}}–{{to}} averaged: the pace once cooldowns carry over.',
          ...STEADY_RANGE,
        })}
      </span>
      <span>
        <Box component="strong" sx={{ display: 'block' }}>
          {t('teamOpt.timing.firstTipTitle', 'First 1–6 rotations')}
        </Box>
        {t(
          'teamOpt.timing.firstTip',
          'Counted from the start, every cooldown ready, like a timed challenge.'
        )}
      </span>
    </Box>
  )
  const choose = (rotations: number | undefined) => {
    setMenu(null)
    if (rotations === first) return
    const { rotations: _previous, ...rest } = timing
    onChange(rotations === undefined ? rest : { ...rest, rotations })
  }
  const toggleOpenerCounted = () => {
    const { countOpener: _count, ...rest } = timing
    onChange(timing.countOpener ? rest : { ...rest, countOpener: true })
  }
  const check = (on: boolean) => (
    <CheckRoundedIcon
      sx={{ fontSize: 16, mr: 1, opacity: on ? 1 : 0, color: tokens.gold }}
    />
  )
  const ariaLabel = `${t('teamOpt.timing.counted', 'Counted')}: ${currentLabel}`

  return (
    <>
      <Tooltip arrow title={menu ? '' : tip} placement="top">
        <span>
          {variant === 'outlined' ? (
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              disabled={disabled}
              onClick={(e) => setMenu(e.currentTarget)}
              startIcon={<RepeatRoundedIcon fontSize="small" />}
              endIcon={<ExpandMoreRoundedIcon fontSize="small" />}
              aria-haspopup="menu"
              aria-expanded={!!menu}
              aria-label={ariaLabel}
              sx={(theme) => ({
                borderColor:
                  first !== undefined
                    ? alpha(theme.palette.primary.main, 0.6)
                    : 'divider',
                color: first !== undefined ? 'primary.main' : 'text.primary',
                bgcolor:
                  first !== undefined
                    ? alpha(theme.palette.primary.main, 0.1)
                    : 'transparent',
                whiteSpace: 'nowrap',
                ...numSx,
                '& .MuiButton-endIcon': { ml: 0.25 },
              })}
            >
              {currentLabel}
            </Button>
          ) : (
            <ButtonBase
              onClick={(e) => setMenu(e.currentTarget)}
              disabled={disabled}
              aria-haspopup="menu"
              aria-expanded={!!menu}
              aria-label={ariaLabel}
              sx={{
                ...quickSx,
                ...focusSx,
                height: 28,
                pl: 0.875,
                pr: 0.5,
                gap: 0.5,
                borderRadius: 999,
                border: '1px solid transparent',
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'text.primary',
                '&:hover': {
                  bgcolor: alpha(giTokens.parchment, 0.05),
                  borderColor: tokens.hairlineStrong,
                },
                '&.Mui-disabled': { opacity: 0.5 },
              }}
            >
              <RepeatRoundedIcon
                sx={{ fontSize: 15, color: 'text.secondary' }}
              />
              {currentLabel}
              <ExpandMoreRoundedIcon
                sx={{ fontSize: 16, color: 'text.secondary' }}
              />
            </ButtonBase>
          )}
        </span>
      </Tooltip>
      <Menu
        anchorEl={menu}
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 200, mt: 0.5 } } }}
      >
        <MenuItem
          selected={first === undefined}
          onClick={() => choose(undefined)}
          sx={{ fontSize: 13.5, ...numSx }}
        >
          {check(first === undefined)}
          {steadyLabel}
          <Box component="span" sx={{ ...type.label, ml: 1 }}>
            {t('teamOpt.timing.default', 'default')}
          </Box>
        </MenuItem>
        <Divider sx={{ my: '4px !important' }} />
        {FIRST_ROTATIONS.map((n) => (
          <MenuItem
            key={n}
            selected={first === n}
            onClick={() => choose(n)}
            sx={{ fontSize: 13.5, ...numSx }}
          >
            {check(first === n)}
            {firstLabel(n)}
          </MenuItem>
        ))}
        {first !== undefined &&
          hasOpener && [
            <Divider key="divider" />,
            <Tooltip
              key="opener"
              arrow
              describeChild
              placement="left"
              title={t(
                'teamOpt.timing.openerCountedTip',
                'Your “First rotation only” (in the rotation writer). Off (default): played before the start as a setup and not counted; its cooldowns, summons and auras carry into the rotations. On: it is the first rotation, and counted.'
              )}
            >
              <MenuItem onClick={toggleOpenerCounted} sx={{ fontSize: 13.5 }}>
                <Checkbox
                  size="small"
                  checked={!!timing.countOpener}
                  sx={{ p: 0, mr: 1 }}
                  tabIndex={-1}
                />
                {t('teamOpt.timing.openerCounted', 'Opener counted')}
              </MenuItem>
            </Tooltip>,
          ]}
      </Menu>
    </>
  )
}

/**
 * This rotation's steps: when each action starts and how many frames it takes before the next one,
 * each editable for this rotation only (on top of the characters' frame data). A step is selected
 * with its timeline block (and selects it); the selected one links to its character's frame data.
 */
export function StepTiming({
  rotation,
  sim,
  settings,
  setSettings,
  selected,
  onSelect,
  onEditCharacter,
}: {
  rotation: ParsedRotation
  sim: SimulationResult
  settings: RotationTimingSettings
  setSettings: (s: RotationTimingSettings) => void
  selected?: number
  onSelect?: (index: number | undefined) => void
  /** Opens the step's action in its character's frame data (every rotation) */
  onEditCharacter?: (characterKey: CharacterKey, actionKey: string) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const flat = flatActions(rotation)
  const opener = openerActions(rotation)
  const overrides = frameOverrides(rotation, settings.edits)
  // the kept rotation's actions, grouped into consecutive turns on the field
  const start = sim.start
  const turns: {
    characterKey: CharacterKey
    start: number
    rows: SimulationResult['actions']
  }[] = []
  const timeline = [...sim.actions, ...(sim.waits ?? [])].sort(
    (x, y) =>
      x.start - y.start ||
      (x.index ?? x.openerIndex ?? -1) - (y.index ?? y.openerIndex ?? -1)
  )
  for (const a of timeline) {
    const last = turns[turns.length - 1]
    if (last && last.characterKey === a.characterKey) last.rows.push(a)
    else turns.push({ characterKey: a.characterKey, start: a.start, rows: [a] })
  }
  const setFrames = (index: number, frames: number | undefined) => {
    const edits = { ...settings.edits }
    const f = flat[index]
    if (frames === undefined || !f) delete edits[index]
    else
      edits[index] = {
        characterKey: f.characterKey,
        text: f.action.text,
        frames,
      }
    setSettings({ ...settings, edits })
  }
  // the selected step (from the timeline): into view
  useEffect(() => {
    if (selected === undefined) return
    requestAnimationFrame(() =>
      document
        .getElementById(`step-${selected}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    )
  }, [selected])
  const grid = 'minmax(0, 1fr) 52px 92px 28px'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        sx={(theme) => ({
          display: 'grid',
          gridTemplateColumns: grid,
          columnGap: 1,
          alignItems: 'center',
          px: 2,
          py: 0.75,
          position: 'sticky',
          top: 0,
          zIndex: 1,
          bgcolor: theme.palette.contentNormal.main,
          borderBottom: `1px solid ${theme.palette.divider}`,
        })}
      >
        <Typography variant="caption" color="text.secondary">
          {t('teamOpt.timing.action', 'Action')}
        </Typography>
        <Tooltip
          arrow
          title={t(
            'teamOpt.timing.startTip',
            'When the action starts, in seconds from the start of the rotation.'
          )}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ...hintSx, textAlign: 'right', justifySelf: 'end' }}
          >
            {t('teamOpt.timing.start', 'Starts')}
          </Typography>
        </Tooltip>
        <Tooltip
          arrow
          title={t(
            'teamOpt.timing.framesTip',
            'Frames until the next action can start. Lower it for a faster cancel, raise it for slower play or a pause. Hits already started still land on time.'
          )}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ...hintSx, textAlign: 'right', justifySelf: 'end' }}
          >
            {t('teamOpt.timing.frames', 'Frames')}
          </Typography>
        </Tooltip>
        <span />
      </Box>
      <Box sx={{ pb: 1 }}>
        {turns.map((turn, ti) => (
          <Box key={`${turn.characterKey}-${turn.start}`} sx={{ pt: 1 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                mb: 0.25,
              }}
            >
              <MemberAvatar characterKey={turn.characterKey} size={22} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                <CharacterName
                  characterKey={turn.characterKey}
                  gender={gender}
                />
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 'auto', fontVariantNumeric: 'tabular-nums' }}
              >
                {ti + 1}
              </Typography>
            </Box>
            {turn.rows.map((a) => {
              const index = a.index
              // (the opener's own actions, counted from the start: named, not edited here)
              const action =
                index !== undefined
                  ? flat[index]?.action
                  : a.openerIndex !== undefined
                    ? opener[a.openerIndex]?.action
                    : undefined
              const isEdited = index !== undefined && index in overrides
              const isSelected = index !== undefined && index === selected
              return (
                <Box
                  key={`${a.start}-${index ?? 'entry'}`}
                  id={index !== undefined ? `step-${index}` : undefined}
                  onClick={() =>
                    index !== undefined &&
                    onSelect?.(isSelected ? undefined : index)
                  }
                  sx={(theme) => ({
                    display: 'grid',
                    gridTemplateColumns: grid,
                    columnGap: 1,
                    alignItems: 'center',
                    minHeight: 36,
                    pl: 5.25,
                    pr: 2,
                    cursor: index !== undefined ? 'pointer' : 'default',
                    scrollMarginTop: 40,
                    bgcolor: isSelected
                      ? alpha(theme.palette.primary.main, 0.1)
                      : 'transparent',
                    boxShadow: isSelected
                      ? `inset 2px 0 0 ${theme.palette.primary.main}`
                      : 'none',
                    transition: 'background-color .12s',
                    '&:hover': {
                      bgcolor: isSelected
                        ? alpha(theme.palette.primary.main, 0.12)
                        : alpha(theme.palette.text.primary, 0.04),
                    },
                  })}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    color={action ? 'text.primary' : 'text.secondary'}
                  >
                    {action ? (
                      <>
                        <Box
                          component="span"
                          sx={{
                            mr: 0.75,
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 12,
                            color: 'text.secondary',
                          }}
                        >
                          {action.text}
                        </Box>
                        {a.variant?.label ?? actionName(t, action)}
                      </>
                    ) : (
                      <Tooltip
                        arrow
                        title={t(
                          'teamOpt.timing.entryTip',
                          'Played automatically when this character comes on field.'
                        )}
                      >
                        <span style={hintSx}>
                          {t('teamOpt.timing.entry', 'Entry (automatic)')}
                        </span>
                      </Tooltip>
                    )}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {seconds(a.start - start)}
                  </Typography>
                  {index !== undefined ? (
                    <Box onClick={(e) => e.stopPropagation()}>
                      <FramesInput
                        value={a.frames}
                        defaultValue={a.defaultFrames ?? a.frames}
                        min={action?.kind === 'wait' ? 0 : 1}
                        onChange={(v) =>
                          setFrames(
                            index,
                            v === (a.defaultFrames ?? a.frames) ? undefined : v
                          )
                        }
                        label={`${action ? (a.variant?.label ?? actionName(t, action)) : ''} ${t('teamOpt.timing.frames', 'Frames')}`}
                      />
                    </Box>
                  ) : (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        textAlign: 'right',
                        pr: 1.25,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {a.frames}
                    </Typography>
                  )}
                  {isEdited ? (
                    <Tooltip
                      arrow
                      title={t('teamOpt.timing.resetOne', {
                        defaultValue: 'Reset to {{frames}} frames',
                        frames: a.defaultFrames,
                      })}
                    >
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          setFrames(index!, undefined)
                        }}
                        aria-label={t('teamOpt.timing.resetOne', {
                          defaultValue: 'Reset to {{frames}} frames',
                          frames: a.defaultFrames,
                        })}
                        sx={{ p: 0.25 }}
                      >
                        <RestartAltIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <span />
                  )}
                  {isSelected &&
                    action &&
                    action.kind !== 'wait' &&
                    onEditCharacter && (
                      <Box
                        sx={{ gridColumn: '1 / -1', pb: 0.75, mt: -0.25 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ButtonBase
                          onClick={() =>
                            onEditCharacter(
                              a.characterKey,
                              a.frameKey ?? actionFrameKey(action)
                            )
                          }
                          sx={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: 'primary.main',
                            borderRadius: 1,
                            px: 0.5,
                            ml: -0.5,
                            '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          {t(
                            'teamOpt.timing.editEvery',
                            'Edit for every rotation'
                          )}
                        </ButtonBase>
                      </Box>
                    )}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** A dotted underline: this label has an explanation on hover */
export const hintSx = {
  cursor: 'help',
  textDecoration: 'underline dotted',
  textUnderlineOffset: 3,
} as const

export function actionName(
  t: ReturnType<typeof useTranslation>['t'],
  a: RotationAction
): string {
  switch (a.kind) {
    case 'skill':
      return a.stacks
        ? t('teamOpt.timing.kind.skillHoldStacks', {
            defaultValue: 'Skill (hold, {{count}} stacks)',
            defaultValue_one: 'Skill (hold, {{count}} stack)',
            count: a.stacks,
          })
        : a.hold
          ? t('teamOpt.timing.kind.skillHold', 'Skill (hold)')
          : t('teamOpt.timing.kind.skill', 'Skill')
    case 'burst':
      return t('teamOpt.timing.kind.burst', 'Burst')
    case 'normal':
      return t('teamOpt.timing.kind.normal', {
        defaultValue: 'Normal attack ×{{count}}',
        count: a.count ?? 1,
      })
    case 'charged':
      return a.beams
        ? t('teamOpt.timing.kind.chargedBeams', {
            defaultValue: 'Charged attack, {{count}} beams',
            count: a.beams,
          })
        : a.spins
          ? a.final
            ? t('teamOpt.timing.kind.chargedSpinsFinal', {
                defaultValue:
                  'Charged attack, {{count}} spins and the finisher',
                count: a.spins,
              })
            : t('teamOpt.timing.kind.chargedSpins', {
                defaultValue: 'Charged attack, {{count}} spins',
                count: a.spins,
              })
          : t('teamOpt.timing.kind.charged', 'Charged attack')
    case 'plunge':
      return t('teamOpt.timing.kind.plunge', 'Plunge')
    case 'dash':
      return t('teamOpt.timing.kind.dash', 'Dash')
    case 'jump':
      return t('teamOpt.timing.kind.jump', 'Jump')
    case 'wait':
      return t('teamOpt.timing.kind.wait', 'Wait')
    case 'swap':
      return t('teamOpt.timing.kind.swap', 'Swap in')
  }
}

/**
 * A frame count: typed directly, committed on blur or Enter (each change replays the rotation).
 * Edited values are gold, with the default in their tooltip.
 */
export function FramesInput({
  value,
  defaultValue,
  min,
  onChange,
  label,
  large,
  unit = 'f',
  tip,
}: {
  value: number
  defaultValue: number
  min: number
  onChange: (v: number) => void
  label: string
  large?: boolean
  /** The suffix: f (frames) or ms */
  unit?: string
  /** Replaces the tooltip (frames in seconds, or the default when edited) */
  tip?: string
}) {
  const { t } = useTranslation('page_team')
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const edited = value !== defaultValue
  const commit = () => {
    if (draft === undefined) return
    const n = Math.round(Number(draft))
    setDraft(undefined)
    if (draft.trim() !== '' && Number.isFinite(n)) onChange(Math.max(min, n))
  }
  const input = (
    <InputBase
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(undefined)
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          setDraft(undefined)
          onChange(Math.max(min, value + (e.key === 'ArrowUp' ? 1 : -1)))
        }
      }}
      inputProps={{
        inputMode: 'numeric',
        'aria-label': label,
        style: { textAlign: 'right' },
      }}
      endAdornment={
        <Box
          component="span"
          sx={{ fontSize: 12, color: 'text.secondary', ml: 0.5 }}
        >
          {unit}
        </Box>
      }
      sx={(theme) => ({
        width: large ? '100%' : 84,
        maxWidth: large ? 104 : undefined,
        px: 1,
        py: 0,
        borderRadius: 1,
        fontSize: large ? 18 : 14,
        fontWeight: large ? 700 : edited ? 700 : 500,
        fontVariantNumeric: 'tabular-nums',
        color: edited ? 'primary.main' : 'text.primary',
        border: `1px solid ${
          edited
            ? alpha(theme.palette.primary.main, 0.6)
            : alpha(theme.palette.text.primary, 0.14)
        }`,
        bgcolor: edited
          ? alpha(theme.palette.primary.main, 0.08)
          : 'transparent',
        '&.Mui-focused': {
          borderColor: 'primary.main',
          boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.25)}`,
        },
        '& input': { py: large ? 0.25 : 0.5 },
      })}
    />
  )
  if (tip || unit !== 'f')
    return tip ? (
      <Tooltip arrow placement="left" title={tip}>
        {input}
      </Tooltip>
    ) : (
      input
    )
  return edited ? (
    <Tooltip
      arrow
      placement="left"
      title={t('teamOpt.timing.default', {
        defaultValue: 'Default: {{frames}} frames ({{seconds}} s)',
        frames: defaultValue,
        seconds: seconds(defaultValue),
      })}
    >
      {input}
    </Tooltip>
  ) : (
    <Tooltip
      arrow
      placement="left"
      title={t('teamOpt.timing.inSeconds', {
        defaultValue: '{{seconds}} s',
        seconds: seconds(value),
      })}
    >
      {input}
    </Tooltip>
  )
}
