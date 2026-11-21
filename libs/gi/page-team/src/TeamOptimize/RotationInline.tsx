import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  KqmBuild,
  RotationAction,
  RotationMember,
  RotationStep,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import { parseRotation } from '@genshin-optimizer/gi/ui'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Collapse,
  Divider,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import {
  Fragment,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import { laneColor } from './RotationTimeline'
import {
  FIRST_ROTATIONS,
  firstRotations,
  openerCounted,
  STEADY_RANGE,
} from './RotationTiming'
import {
  applyWritten,
  editorSx,
  exampleRotation,
  insertWord,
  type RotationWriterHandle,
  rotationIdOf,
  saveRotationTiming,
  simulateWritten,
  useAppliedRotation,
  useEditedByHand,
  useMemberNames,
  useRotationSettings,
  useRotationText,
  useSimTeam,
  useWriterOpen,
  WriterQuickRow,
  type WrittenRotation,
  writtenHits,
  writtenSeconds,
} from './RotationWriter'
import {
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  tokens,
  type,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

// (Windows has none of the first three: Consolas or Cascadia Mono there)
const mono =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Mono", "Liberation Mono", monospace'
const shortcut =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘ Enter'
    : 'Ctrl+Enter'

/**
 * The rotation as text, on the page: read as the members' steps, a click opens the writer dialog
 * (`writer`) to change it; before there is one, typed here and "Use this rotation" turns it into
 * the team's attacks.
 */
export function RotationInline({
  teamId,
  members,
  setTeamOpt,
  writer,
  replaces,
  disabled,
  kqm,
  kqmBuilds,
  trailing,
}: {
  /** At the line's right end, beside the rotation (its time) */
  trailing?: ReactNode
  /** KQM theorycrafting's settings, on its tab: previewed at its constellations, no own gear */
  kqm?: TeamOptKqm
  /** With KQM: the shown result's builds, whose weapon and set effects the preview plays */
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
  writer: RotationWriterHandle
  /** The team has attacks already: using the text replaces them */
  replaces: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  // (the tab's own rotation: Team optimize's, or KQM's)
  const rid = rotationIdOf(teamId, kqm)
  const { applied, text, setText, isDraft } = useRotationText(rid)
  const settings = useRotationSettings(rid)
  const editedByHand = useEditedByHand(teamId, !!kqm)
  const names = useMemberNames(members)
  const team = useSimTeam(members, kqm, kqmBuilds)
  // (the attacks a rotation leaves are the tab's: at the members' own constellations, or KQM's
  // without the shown builds' gear)
  const ownTeam = useSimTeam(members, kqm)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [focused, setFocused] = useState(false)
  // read as steps once there is a rotation (a click opens the writer); a text field before
  const editing = focused || !applied.trim()
  // typed and not used yet: played as it is typed (behind the typing)
  const pending = isDraft && !!text.trim()
  // (played once typing pauses: a play takes tens of ms, too long to run on every key)
  const typed = pending ? text : ''
  const [settled, setSettled] = useState(typed)
  // (not while the writer is open: it plays the same text, and this panel is behind it)
  const writing = useWriterOpen(writer)
  useEffect(() => {
    if (writing) return
    const timer = setTimeout(
      () => startTransition(() => setSettled(typed)),
      typed ? 220 : 0
    )
    return () => clearTimeout(timer)
  }, [typed, writing])
  const { opener, timing, frameData } = settings
  const isKqm = !!kqm
  const play = useMemo(
    () =>
      (value: string, as: typeof team = team) => {
        try {
          return {
            result: simulateWritten({
              kqm: isKqm,
              text: value,
              opener,
              timing,
              frameData,
              team: as,
              names,
              members,
              database,
              teamId,
              gender,
              openerWarning: (warning) =>
                t('teamOpt.writer.openerWarning', {
                  defaultValue: 'Opener: {{warning}}',
                  warning,
                }),
            }),
          }
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      },
    [
      isKqm,
      opener,
      timing,
      frameData,
      team,
      names,
      members,
      database,
      teamId,
      gender,
      t,
    ]
  )
  const played = useMemo(() => play(settled), [play, settled])
  const result: WrittenRotation | undefined = played.result
  const stale = settled !== text
  const warnings = [
    ...new Set([
      ...(played.error ? [played.error] : []),
      ...(result?.sim?.warnings ?? result?.rotation.warnings ?? []),
    ]),
  ]

  const submit = () => {
    if (disabled || !pending) return
    const now = kqm
      ? play(text, ownTeam).result
      : stale
        ? play(text).result
        : result
    if (!now?.sim) return
    const undo = applyWritten({
      database,
      teamId,
      members,
      setTeamOpt,
      result: now,
      text,
      opener,
      timing,
      frameData,
      kqm: !!kqm,
      constellations: ownTeam.constellations,
    })
    if (undo) writer.onApplied(undo)
    inputRef.current?.blur()
    setFocused(false)
  }
  const canUse = pending && (stale || !!result?.sim)
  // a team without attacks or text: the field is the way in (roomy, its words and button shown);
  // attacks made another way: one quiet line until something is typed
  const fresh = !replaces && !text.trim()
  const useLabel = replaces
    ? t('teamOpt.writer.replace', 'Replace rotation')
    : t('teamOpt.writer.apply', 'Use this rotation')

  if (!editing)
    return (
      <Box
        sx={{
          ...insetSx,
          ...quickSx,
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: 'stretch',
          minHeight: 44,
          '&:hover': { borderColor: tokens.hairlineStrong },
        }}
      >
        <ButtonBase
          component="div"
          onClick={writer.openWriter}
          disabled={disabled}
          aria-label={`${t('teamOpt.writer.edit', 'Edit rotation')}: ${applied}`}
          sx={{
            ...focusSx,
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 1,
            px: 1.5,
            py: 1,
            borderRadius: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            '&:hover .rotation-edit, &.Mui-focusVisible .rotation-edit': {
              opacity: 1,
            },
          }}
        >
          <RotationReadout
            text={applied}
            opener={opener}
            first={firstRotations(timing)}
            counted={openerCounted(timing)}
            names={names}
          />
          {editedByHand && (
            <Tooltip
              arrow
              title={t(
                'teamOpt.writer.handEditedTip',
                'Its attacks were changed by hand after the rotation was played. Changing the rotation or how many rotations count plays it again and replaces those changes (Undo stays possible for a few seconds).'
              )}
            >
              <Box
                component="span"
                sx={{
                  alignSelf: 'flex-start',
                  flexShrink: 0,
                  ml: 'auto',
                  px: 0.75,
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 600,
                  lineHeight: '20px',
                  whiteSpace: 'nowrap',
                  color: tokens.gold,
                  border: `1px solid ${alpha(tokens.gold, 0.4)}`,
                }}
              >
                {t('teamOpt.writer.handEdited', 'Attacks edited')}
              </Box>
            </Tooltip>
          )}
          <EditRoundedIcon
            className="rotation-edit"
            sx={{
              ml: editedByHand ? 0 : 'auto',
              alignSelf: 'flex-start',
              mt: 0.25,
              fontSize: 16,
              color: 'text.secondary',
              opacity: 0.45,
              flexShrink: 0,
              transition: 'opacity .12s',
            }}
          />
        </ButtonBase>
        {/* (beside the line, not in it: setting it does not open the writer) */}
        {trailing && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexShrink: 0,
              px: 1,
              py: { xs: 0.5, sm: 0 },
              borderLeft: { xs: 0, sm: hairline },
              borderTop: { xs: hairline, sm: 0 },
            }}
          >
            {trailing}
          </Box>
        )}
      </Box>
    )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <TextField
        multiline
        minRows={fresh ? 2 : 1}
        maxRows={8}
        fullWidth
        value={text}
        disabled={disabled}
        placeholder={exampleRotation(names.map((n) => n.name))}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            inputRef.current?.blur()
          }
        }}
        inputRef={inputRef}
        inputProps={{
          spellCheck: false,
          'aria-label': t('teamOpt.writer.loop', 'Rotation'),
        }}
        sx={editorSx}
      />
      <Collapse in={focused || fresh} timeout={180} unmountOnExit>
        <WriterQuickRow
          members={members}
          onInsert={(word) => insertWord(inputRef.current, text, word, setText)}
        />
      </Collapse>
      {(pending || fresh) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1,
            rowGap: 0.75,
          }}
        >
          <Box
            role="status"
            sx={{
              ...type.label,
              ...numSx,
              opacity: stale ? 0.55 : 1,
              transition: 'opacity .12s',
            }}
          >
            {result?.sim &&
              `${(writtenSeconds(result) ?? 0).toFixed(1)} s · ${t(
                'teamOpt.writer.hitCount',
                {
                  defaultValue: '{{count}} hits',
                  count: Math.round(writtenHits(result) * 10) / 10,
                }
              )}`}
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {isDraft && !!applied.trim() && (
            <Button
              size="small"
              variant="text"
              color="inherit"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setText(applied)}
              disabled={disabled}
              sx={{ color: 'text.secondary', ...quickSx }}
            >
              {t('teamOpt.writer.revertShort', 'Revert')}
            </Button>
          )}
          <Tooltip arrow title={canUse ? shortcut : ''}>
            <span>
              <Button
                size="small"
                variant="contained"
                disabled={disabled || !canUse}
                onMouseDown={(e) => e.preventDefault()}
                onClick={submit}
                sx={canUse && !disabled ? giCtaSx : undefined}
              >
                {useLabel}
              </Button>
            </span>
          </Tooltip>
        </Box>
      )}
      {pending && !!warnings.length && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.25,
            opacity: stale ? 0.55 : 1,
          }}
        >
          {warnings.map((w) => (
            <Typography key={w} variant="body2" color="warning.main">
              {w}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  )
}

/** An optional action's alternative, as written ("/N3") */
const otherwiseCode = (a: RotationAction): string =>
  a.otherwise?.length ? `/${a.otherwise.map(actionCode).join('')}` : ''

/** An action as the writer's short code */
const actionCode = (a: RotationAction): string => {
  switch (a.kind) {
    case 'skill':
      return `${a.hold ? 'hE' : 'E'}${a.stacks ? `[stacks=${a.stacks}]` : ''}${a.optional ? '?' : ''}${otherwiseCode(a)}`
    case 'burst':
      return `${a.optional ? 'Q?' : 'Q'}${otherwiseCode(a)}`
    case 'normal':
      return `N${a.count ?? 1}`
    case 'charged':
      return a.cancel
        ? 'CA[cancel]'
        : a.beams
          ? `CA[beams=${a.beams}]`
          : a.bullets
            ? `CA[bullets=${a.bullets}]`
            : a.spins
              ? `C${a.spins}${a.final ? 'F' : ''}`
              : 'CA'
    case 'plunge':
      return `${a.height === 'high' ? 'HP' : a.height === 'low' ? 'LP' : 'P'}${
        a.collision
          ? a.collision === 1
            ? '[collision]'
            : `[collision=${a.collision}]`
          : ''
      }`
    case 'dash':
      return `D${a.optional ? '?' : ''}${otherwiseCode(a)}`
    case 'jump':
      return 'J'
    case 'wait': {
      // (as written when it reads well: W90f, W1.5; else seconds to 2 decimals, never 0.0166…)
      const seconds = a.count ?? 0
      const frames = Math.round(seconds * 60)
      if (a.walk)
        return /^WK(\d+(\.\d{1,2})?f?)?$/i.test(a.text ?? '')
          ? a.text
          : `WK${frames}f`
      return /^W\d+(\.\d{1,2})?f?$/i.test(a.text ?? '')
        ? a.text
        : Math.abs(frames - seconds * 60) < 1e-6 && frames % 6
          ? `W${frames}f`
          : `W${+seconds.toFixed(2)}`
    }
    default:
      return a.text
  }
}

/** The rotation in use, read as its steps: who acts (in their element's colour), then what */
export function RotationReadout({
  text,
  opener,
  first,
  counted,
  names,
}: {
  text: string
  opener: string
  /** Rotations counted from the start, else undefined */
  first?: number
  /** Whether the opener is counted (the first of them; else a setup before the start) */
  counted: boolean
  names: RotationMember[]
}) {
  const { t } = useTranslation('page_team')
  const parsed = useMemo(() => parseRotation(text, names), [text, names])
  const openerSteps = useMemo(
    () => (opener.trim() ? parseRotation(opener, names).steps : []),
    [opener, names]
  )
  const nameOf = (ck: CharacterKey) =>
    names.find((n) => n.characterKey === ck)?.name ?? ck
  // what the reader cannot show as steps is shown as written
  if (parsed.warnings.length || !parsed.steps.length)
    return (
      <Box
        component="span"
        sx={{
          fontFamily: mono,
          fontSize: 14,
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          minWidth: 0,
        }}
      >
        {text}
      </Box>
    )
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1,
        rowGap: 0.75,
        minWidth: 0,
      }}
    >
      {!!openerSteps.length && (
        <>
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 1,
              rowGap: 0.5,
            }}
          >
            <Box component="span" sx={type.label}>
              {t('teamOpt.writer.opener', 'First rotation only')}
            </Box>
            {openerSteps.map((step, i) => (
              <Fragment key={i}>
                {i > 0 && <Arrow />}
                <Step
                  step={step}
                  name={nameOf(step.characterKey)}
                  muted={!counted}
                />
              </Fragment>
            ))}
          </Box>
          <Box
            aria-hidden
            sx={{ width: '1px', height: 18, bgcolor: tokens.hairlineStrong }}
          />
        </>
      )}
      {/* (the first rotation alone, counted from the start: the rotation is not played) */}
      {parsed.steps.map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <Arrow />}
          <Step
            step={step}
            name={nameOf(step.characterKey)}
            muted={first === 1 && counted && !!openerSteps.length}
          />
        </Fragment>
      ))}
      {parsed.loopsTo && (
        <>
          <Arrow />
          <Tooltip
            arrow
            title={t('teamOpt.writer.loopsTo', {
              defaultValue: 'Loops back to {{name}}',
              name: nameOf(parsed.loopsTo),
            })}
          >
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.375,
                color: 'text.secondary',
              }}
            >
              <ReplayRoundedIcon sx={{ fontSize: 15 }} />
              <MemberAvatar characterKey={parsed.loopsTo} size={18} />
            </Box>
          </Tooltip>
        </>
      )}
    </Box>
  )
}

function Arrow() {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ color: 'text.secondary', opacity: 0.5, fontSize: 13 }}
    >
      →
    </Box>
  )
}

/** One step: the member, then their actions in the writer's codes */
function Step({
  step,
  name,
  muted,
}: {
  step: RotationStep
  name: string
  muted?: boolean
}) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 0.625,
        rowGap: 0.25,
        minWidth: 0,
        opacity: muted ? 0.7 : 1,
      }}
    >
      <MemberAvatar characterKey={step.characterKey} size={20} />
      {/* (the name and its codes on one baseline: the two fonts sit differently in their boxes,
          so centred they drift apart on some systems, e.g. Consolas on Windows) */}
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          columnGap: 0.625,
          rowGap: 0.25,
          minWidth: 0,
        }}
      >
        <Box
          component="span"
          sx={(theme) => ({
            color: laneColor(theme, step.characterKey),
            fontWeight: 650,
            fontSize: 13.5,
            whiteSpace: 'nowrap',
          })}
        >
          {name}
        </Box>
        {step.actions.map((a, j) => (
          <Box
            key={j}
            component="span"
            sx={{
              fontFamily: mono,
              fontSize: 13.5,
              color: 'text.primary',
              letterSpacing: '0.01em',
            }}
          >
            {actionCode(a)}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * The rotations a tab counts (Team optimize's, or KQM's own), on the page beside the rotation: the
 * steady pace (the default), or the first 1–6 from the start. Changing it plays the rotation in
 * use again with it (Undo as for using a rotation).
 */
export function RotationsSetting({
  teamId,
  members,
  setTeamOpt,
  writer,
  disabled,
  kqm,
  compact,
}: {
  /** KQM theorycrafting's settings, on its tab: its own rotation, at its constellations */
  kqm?: TeamOptKqm
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
  writer: RotationWriterHandle
  disabled?: boolean
  /** A chip at the end of the rotation's line, its choices in a menu */
  compact?: boolean
}) {
  const { t } = useTranslation('page_team')
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const database = useDatabase()
  const { gender } = useDBMeta()
  const rid = rotationIdOf(teamId, kqm)
  const applied = useAppliedRotation(rid)
  const { opener, timing, frameData } = useRotationSettings(rid)
  const names = useMemberNames(members)
  // (the tab's: the members' own constellations, or KQM's)
  const ownTeam = useSimTeam(members, kqm)
  const first = firstRotations(timing)
  // (undefined: the steady pace)
  const set = (rotations: number | undefined) => {
    const { rotations: _previous, ...rest } = timing
    apply(rotations === undefined ? rest : { ...rest, rotations })
  }
  // (counted from the start: the first rotation written apart is the first rotation, or a setup
  // played before the start, not counted)
  const setOpenerCounted = (counted: boolean) => {
    const { openerSetup: _setup, ...rest } = timing
    apply(counted ? rest : { ...rest, openerSetup: true })
  }
  const apply = (next: typeof timing) => {
    if (applied.trim()) {
      try {
        const result = simulateWritten({
          kqm: !!kqm,
          text: applied,
          opener,
          timing: next,
          frameData,
          team: ownTeam,
          names,
          members,
          database,
          teamId,
          gender,
          openerWarning: (warning) => warning,
        })
        if (result?.sim) {
          const undo = applyWritten({
            database,
            teamId,
            members,
            setTeamOpt,
            result,
            text: applied,
            opener,
            timing: next,
            frameData,
            kqm: !!kqm,
            constellations: ownTeam.constellations,
          })
          if (undo) writer.onApplied(undo)
          return
        }
      } catch {
        // (a rotation that does not play: the setting is still saved)
      }
    }
    saveRotationTiming(database, rid, next)
  }
  const steadyLabel = t('teamOpt.timing.steady', {
    defaultValue: 'Steady DPS (rot {{from}}–{{to}})',
    ...STEADY_RANGE,
  })
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
  const firstLabel = (n: number) =>
    n === 1
      ? t('teamOpt.timing.firstOne', 'First rotation')
      : t('teamOpt.timing.firstN', {
          defaultValue: 'First {{count}} rotations',
          count: n,
        })
  if (compact) {
    const choose = (rotations: number | undefined) => {
      setMenu(null)
      if (rotations !== first) set(rotations)
    }
    const check = (on: boolean) => (
      <CheckRoundedIcon
        sx={{ fontSize: 16, mr: 1, opacity: on ? 1 : 0, color: tokens.gold }}
      />
    )
    return (
      <>
        <Tooltip arrow title={tip} placement="top">
          <ButtonBase
            onClick={(e) => setMenu(e.currentTarget)}
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={!!menu}
            aria-label={`${t('teamOpt.timing.counted', 'Counted')}: ${
              first === undefined ? steadyLabel : firstLabel(first)
            }`}
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
            <RepeatRoundedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
            {first === undefined ? steadyLabel : firstLabel(first)}
            <ExpandMoreRoundedIcon
              sx={{ fontSize: 16, color: 'text.secondary' }}
            />
          </ButtonBase>
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
            !!opener.trim() && [
              <Divider key="divider" />,
              <Tooltip
                key="opener"
                arrow
                placement="left"
                title={t(
                  'teamOpt.timing.openerCountedTip',
                  'Your “First rotation only” (in the rotation writer). On: it is the first rotation, and counted. Off: played before the start as a setup and not counted; its cooldowns, summons and auras carry into the rotations.'
                )}
              >
                <MenuItem
                  onClick={() => setOpenerCounted(!!timing.openerSetup)}
                  sx={{ fontSize: 13.5 }}
                >
                  <Checkbox
                    size="small"
                    checked={!timing.openerSetup}
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
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FieldLabel tip={tip}>
        {t('teamOpt.timing.counted', 'Counted')}
      </FieldLabel>
      <Segmented
        size="small"
        aria-label={t('teamOpt.timing.counted', 'Counted')}
        value={first === undefined ? 'repeat' : 'start'}
        onChange={(key) => set(key === 'repeat' ? undefined : (first ?? 1))}
        options={[
          {
            value: 'repeat',
            label: steadyLabel,
            disabled,
          },
          {
            value: 'start',
            label: t('teamOpt.timing.fromStart', 'From the start'),
            disabled,
          },
        ]}
      />
      {first !== undefined && (
        <>
          <Typography component="span" sx={type.label}>
            {t('teamOpt.timing.first', 'First')}
          </Typography>
          <Segmented
            size="small"
            aria-label={t(
              'teamOpt.timing.rotationsFromStart',
              'Rotations from the start'
            )}
            value={String(first)}
            onChange={(key) => set(Number(key))}
            options={FIRST_ROTATIONS.map((n) => ({
              value: String(n),
              label: String(n),
              disabled,
            }))}
          />
          {!!opener.trim() && (
            <Tooltip
              arrow
              title={t(
                'teamOpt.timing.openerCountedTip',
                'Your “First rotation only” (in the rotation writer). On: it is the first rotation, and counted. Off: played before the start as a setup and not counted; its cooldowns, summons and auras carry into the rotations.'
              )}
            >
              <Box
                component="label"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.25,
                  cursor: disabled ? 'default' : 'pointer',
                  whiteSpace: 'nowrap',
                  ...type.label,
                }}
              >
                <Checkbox
                  size="small"
                  checked={!timing.openerSetup}
                  disabled={disabled}
                  onChange={(_, checked) => setOpenerCounted(checked)}
                  sx={{ p: 0.5 }}
                />
                {t('teamOpt.timing.openerCounted', 'Opener counted')}
              </Box>
            </Tooltip>
          )}
        </>
      )}
    </Box>
  )
}
