import { useBoolState } from '@genshin-optimizer/common/react-util'
import { DropdownButton, SuspenseTooltip } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack, TeamOptBuffOwner } from '@genshin-optimizer/gi/db'
import {
  initTeamOptAttack,
  TEAM_OPT_MAX_ATTACKS,
} from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type {
  BuffRef,
  TeamData,
  TeamDataOverrides,
  TeamOptEvaluation,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  buffRefKey,
  CharacterName,
  DataContext,
  sameBuff,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import AddIcon from '@mui/icons-material/Add'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox'
import type { ButtonBaseProps } from '@mui/material'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Collapse,
  IconButton,
  MenuItem,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { HTMLAttributes, ReactNode } from 'react'
import {
  forwardRef,
  memo,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { TargetSelectorModal } from '../CharacterDisplay/Tabs/TabOptimize/Components/TargetSelectorModal'
import { AttackEditor, AttackFiguresContext } from './AttackEditor'
import { AttackName } from './AttackName'
import {
  groupAttacks,
  holdsItem,
  type MemberGear,
  totalHits,
} from './attackGroups'
import type { TeamBuff } from './buffs'
import { describe } from './buffs'
import type { ExpandStore } from './expandStore'
import { formatDamage, formatHits, formatRate } from './format'
import { MemberAvatar } from './MemberAvatar'
import {
  EmptyLine,
  focusSx,
  numSx,
  quickSx,
  selectedSx,
  tokens,
  type,
} from './ui'

/** One member's rotation: its attacks, what each deals, and the member's share of the team */
export function MemberRotation({
  teamId,
  member,
  teamData,
  attacks,
  setAttacks,
  evaluation,
  buffs,
  mainStatAssumptionLevel,
  members,
  onField,
  rotationTime,
  footer,
  expanded = true,
  expandStore,
  onToggle,
  disabled,
  figures = true,
  played = false,
  overrides,
  gear,
}: {
  teamId: string
  member: TeamOptMember
  teamData: TeamData | undefined
  attacks: TeamOptAttack[]
  setAttacks: (update: (attacks: TeamOptAttack[]) => TeamOptAttack[]) => void
  evaluation: TeamOptEvaluation | undefined
  /** The buffs that can affect this member's attacks */
  buffs: TeamBuff[]
  mainStatAssumptionLevel: number
  /** The team (who may be on the field) */
  members: TeamOptMember[]
  /** Who is on the field by default */
  onField: CharacterKey
  /** How long one rotation takes (seconds): its damage is then shown per second */
  rotationTime?: number
  /** The member's settings, under its rotation */
  footer?: ReactNode
  /** Its attacks are shown (the header opens and closes them, for every member at once) */
  expanded?: boolean
  /** …read from this shared flag instead: flipping it re-renders the header and the fold only */
  expandStore?: ExpandStore
  onToggle?: () => void
  /** A run is going: its attacks can't be edited */
  disabled?: boolean
  /**
   * Damage figures with the members' own builds, in the attack editor and the rows (KQM
   * theorycrafting has none: it never counts those builds)
   */
  figures?: boolean
  /**
   * The attacks are the ones KQM theorycrafting played for its builds: shown as they are, not
   * edited here (the written rotation is)
   */
  played?: boolean
  /**
   * The builds an attack's figures and buffs are read with in the editor (KQM theorycrafting's
   * builds shown: `kqmTeamOverrides`), instead of the members' own
   */
  overrides?: TeamDataOverrides
  /**
   * The weapon and sets each member's build holds (KQM theorycrafting's builds shown): its played
   * attacks carry the buff states of every weapon and set it could pick, which then name no part
   */
  gear?: MemberGear
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const { characterKey, teamChar } = member
  const data = teamData?.[characterKey]?.target
  const [showPicker, onShowPicker, onHidePicker] = useBoolState()
  const [editing, setEditing] = useState<number | undefined>()
  // several attacks picked to remove at once
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  // what a removal can be undone to, for a few seconds and while nothing else changed
  const [undo, setUndo] = useState<{
    before: TeamOptAttack[]
    after: string
    count: number
  }>()
  // what the last import of a multi-target did
  const [imported, setImported] = useState<{ added: number; updated: number }>()
  useEffect(() => {
    if (!undo) return undefined
    const timer = setTimeout(() => setUndo(undefined), 8000)
    return () => clearTimeout(timer)
  }, [undo])
  useEffect(() => {
    if (!imported) return undefined
    const timer = setTimeout(() => setImported(undefined), 5000)
    return () => clearTimeout(timer)
  }, [imported])
  const undoable = !!undo && undo.after === JSON.stringify(attacks)
  const remove = (indices: ReadonlySet<number>) => {
    if (!indices.size) return
    const after = attacks.filter((_, i) => !indices.has(i))
    setUndo({
      before: attacks,
      after: JSON.stringify(after),
      count: indices.size,
    })
    setAttacks(() => after)
  }
  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  // (the same handlers every render: a click re-renders only the rows it changes)
  const latest = useRef({ selecting, remove })
  latest.current = { selecting, remove }
  const onRowClick = useCallback((i: number) => {
    if (!latest.current.selecting) return setEditing(i)
    // (from the latest selection: clicks may come faster than renders)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }, [])
  const onRowRemove = useCallback(
    (i: number) => latest.current.remove(new Set([i])),
    []
  )
  const groups = useMemo(() => groupAttacks(attacks), [attacks])
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set())
  const onGroupClick = useCallback(
    (key: string, indices: readonly number[]) => {
      if (!latest.current.selecting)
        return setOpenGroups((prev) => toggled(prev, key))
      setSelected((prev) => {
        const all = indices.every((i) => prev.has(i))
        const next = new Set(prev)
        for (const i of indices) {
          if (all) next.delete(i)
          else next.add(i)
        }
        return next
      })
    },
    []
  )
  const onGroupRemove = useCallback(
    (indices: readonly number[]) => latest.current.remove(new Set(indices)),
    []
  )
  const hits = totalHits(attacks)
  const buffOf = useBuffNames(buffs, teamData)
  const offText = t('teamOpt.rotation.conditionOff', 'off')
  // each grouped attack's parts, named by what sets them apart; with `gear`, parts that differ only
  // in the effects of gear nobody holds are one
  const parts = useMemo(
    () =>
      new Map(
        groups
          .filter(({ indices }) => indices.length > 1)
          .map(({ key, indices }) => {
            const labels = partLabels(
              indices.map((i) => attacks[i]),
              onField,
              buffOf,
              offText,
              gear && ((owner, item) => holdsItem(gear, owner, item))
            )
            if (!gear)
              return [
                key,
                indices.map((i, n) => ({ indices: [i], label: labels[n] })),
              ]
            const byLabel = new Map<
              string,
              { indices: number[]; label: PartLabel }
            >()
            indices.forEach((i, n) => {
              const label = labels[n]
              const id = `${label.onField ? (attacks[i].onField ?? onField) : ''}|${label.conditions.map((c) => c.key).join('/')}`
              const part = byLabel.get(id)
              if (part) part.indices.push(i)
              else byLabel.set(id, { indices: [i], label })
            })
            return [key, [...byLabel.values()]]
          })
      ),
    [groups, attacks, onField, buffOf, offText, gear]
  )

  const damage = evaluation?.members[characterKey]
  const share =
    evaluation && evaluation.total > 0 && damage !== undefined
      ? damage / evaluation.total
      : undefined
  const full = attacks.length >= TEAM_OPT_MAX_ATTACKS

  const addAttack = (path: string[], multi?: number) => {
    onHidePicker()
    const attack = initTeamOptAttack(path, multi && multi > 0 ? multi : 1)
    // start from the member's own settings: its reaction and infusion
    if (teamChar.reaction) attack.reaction = teamChar.reaction
    if (teamChar.infusionAura) attack.infusionAura = teamChar.infusionAura
    setAttacks((list) => [...list, attack])
    setEditing(attacks.length)
  }
  /**
   * Adds a multi-target's attacks. One already in the rotation (the same attack, reaction,
   * infusion and hit mode) is updated instead: its hits and bonus stats from the multi-target,
   * its buff settings kept. Importing again does not add them twice.
   */
  const importTargets = (index: number) => {
    const targets = teamChar.customMultiTargets[index]?.targets ?? []
    const next = [...attacks]
    const matched = new Set<number>()
    let added = 0
    let updated = 0
    for (const {
      path,
      weight,
      hitMode,
      reaction,
      infusionAura,
      bonusStats,
    } of targets) {
      const attack: TeamOptAttack = { path, hits: weight, hitMode }
      if (reaction) attack.reaction = reaction
      if (infusionAura) attack.infusionAura = infusionAura
      if (Object.keys(bonusStats).length) attack.bonusStats = bonusStats
      // (each attack of the rotation stands for one target: a multi-target may list one twice)
      const at = next.findIndex(
        (a, i) => !matched.has(i) && sameAttack(a, attack)
      )
      if (at >= 0) {
        matched.add(at)
        const { bonusStats: _b, ...rest } = next[at]
        next[at] = {
          ...rest,
          hits: attack.hits,
          ...(attack.bonusStats ? { bonusStats: attack.bonusStats } : {}),
        }
        updated++
      } else if (next.length < TEAM_OPT_MAX_ATTACKS) {
        matched.add(next.length)
        next.push(attack)
        added++
      }
    }
    setAttacks(() => next)
    setImported({ added, updated })
  }
  const dataContextValue = useMemo(
    () => data && teamData && { data, teamData },
    [data, teamData]
  )
  const editingAttack = editing === undefined ? undefined : attacks[editing]

  return (
    // a column of the team's panel (the panel draws the lines between members)
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        bgcolor: tokens.inset,
      }}
    >
      {/* the member, its attacks and its share of the rotation: also the button that shows or
          hides every member's attacks (a chevron says which) */}
      <FoldButton
        store={expandStore}
        expanded={expanded}
        foldable={!!onToggle}
        component="div"
        role="button"
        tabIndex={onToggle ? 0 : -1}
        disabled={!onToggle}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (onToggle && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onToggle()
          }
        }}
        sx={(theme) => ({
          display: 'block',
          textAlign: 'left',
          width: '100%',
          position: 'relative',
          cursor: onToggle ? 'pointer' : 'default',
          ...quickSx,
          ...focusSx,
          '&.Mui-focusVisible': { outlineOffset: -2 },
          '&:hover': onToggle
            ? { bgcolor: alpha(theme.palette.text.primary, 0.035) }
            : {},
          '&:hover .member-chevron': { color: 'text.primary', opacity: 1 },
          '&.Mui-disabled': { pointerEvents: 'none' },
        })}
      >
        <Box sx={{ px: 1.5, pt: 1.375, pb: 1.25, pr: onToggle ? 4.25 : 1.5 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.125,
              minHeight: 34,
            }}
          >
            <MemberAvatar characterKey={characterKey} size={32} />
            <Box sx={{ minWidth: 0, flexGrow: 1, lineHeight: 1.25 }}>
              <Typography
                noWrap
                sx={{
                  ...type.body,
                  fontWeight: 650,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.25,
                }}
              >
                <CharacterName characterKey={characterKey} gender={gender} />
              </Typography>
              <Typography
                noWrap
                sx={{ ...type.label, fontSize: 12, lineHeight: 1.25, ...numSx }}
              >
                {t('teamOpt.rotation.hitCount', {
                  defaultValue_one: '{{hits}} hit',
                  defaultValue_other: '{{hits}} hits',
                  count: hits,
                  hits: formatHits(hits),
                })}
              </Typography>
            </Box>
            {!!damage && (
              <Tooltip
                placement="top"
                title={t(
                  'teamOpt.rotation.memberShareTip',
                  'DPS, and its share of the team’s damage'
                )}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    flexShrink: 0,
                    lineHeight: 1.25,
                    ...numSx,
                  }}
                >
                  <Typography
                    component="span"
                    sx={{
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                      lineHeight: 1.25,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatRate(damage, rotationTime)}
                    <Box
                      component="span"
                      sx={{
                        ...type.label,
                        fontSize: 11,
                        fontWeight: 500,
                        ml: 0.375,
                      }}
                    >
                      {rotationTime
                        ? t('teamOpt.rotation.dps', 'DPS')
                        : t('teamOpt.rotation.dmg', 'DMG')}
                    </Box>
                  </Typography>
                  {share !== undefined && (
                    <Typography
                      component="span"
                      sx={{
                        ...type.label,
                        fontSize: 11.5,
                        fontWeight: 600,
                        lineHeight: 1.25,
                        textAlign: 'right',
                      }}
                    >
                      {Math.round(share * 100)}%
                    </Typography>
                  )}
                </Box>
              </Tooltip>
            )}
          </Box>
          {/* (its place is kept while there is no damage yet: nothing moves when it comes) */}
          <ShareBar
            share={damage ? share : undefined}
            characterKey={characterKey}
            sx={{ mt: 1.25 }}
          />
        </Box>
        {onToggle && <FoldChevron store={expandStore} expanded={expanded} />}
      </FoldButton>

      <Fold store={expandStore} expanded={expanded}>
        <Box
          component="fieldset"
          disabled={disabled}
          sx={{
            border: 0,
            p: 0,
            m: 0,
            minWidth: 0,
            pointerEvents: disabled ? 'none' : undefined,
            opacity: disabled ? 0.6 : 1,
            transition: 'opacity .18s',
          }}
        >
          {/* its attacks, one line each */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.25,
              px: 0.75,
              pb: 1,
              flexGrow: 1,
            }}
          >
            {groups.map(({ key, indices }) => {
              const rowProps = {
                data,
                onField,
                figures: figures || !!evaluation,
                selecting,
                readOnly: played,
                onClick: onRowClick,
                onRemove: onRowRemove,
              }
              const [first] = indices
              const damageOf = (of: readonly number[]) => {
                const all = of.map(
                  (i) => evaluation?.attacks[characterKey]?.[i]
                )
                return all.every((d) => d !== undefined)
                  ? all.reduce<number>((sum, d) => sum + (d ?? 0), 0)
                  : undefined
              }
              const groupParts = parts.get(key)
              if (indices.length === 1 || groupParts?.length === 1)
                return (
                  <AttackRow
                    key={key}
                    {...rowProps}
                    index={first}
                    attack={
                      indices.length === 1
                        ? attacks[first]
                        : {
                            ...attacks[first],
                            hits: totalHits(indices.map((i) => attacks[i])),
                          }
                    }
                    damage={damageOf(indices)}
                    selected={selected.has(first)}
                  />
                )
              return (
                <AttackGroupRow
                  key={key}
                  groupKey={key}
                  indices={indices}
                  data={data}
                  attack={attacks[first]}
                  hits={totalHits(indices.map((i) => attacks[i]))}
                  damage={damageOf(indices)}
                  partCount={groupParts?.length ?? indices.length}
                  figures={rowProps.figures}
                  open={openGroups.has(key)}
                  selecting={selecting}
                  selection={
                    indices.every((i) => selected.has(i))
                      ? 'all'
                      : indices.some((i) => selected.has(i))
                        ? 'some'
                        : 'none'
                  }
                  readOnly={played}
                  onClick={onGroupClick}
                  onRemove={onGroupRemove}
                >
                  {groupParts?.map(({ indices: of, label }) => (
                    <AttackRow
                      key={of[0]}
                      {...rowProps}
                      part={label}
                      index={of[0]}
                      attack={
                        of.length === 1
                          ? attacks[of[0]]
                          : {
                              ...attacks[of[0]],
                              hits: totalHits(of.map((i) => attacks[i])),
                            }
                      }
                      damage={damageOf(of)}
                      selected={selected.has(of[0])}
                    />
                  ))}
                </AttackGroupRow>
              )
            })}
            {!attacks.length && (
              <EmptyLine
                sx={{ mx: 0.75 }}
                info={t(
                  'teamOpt.rotation.empty',
                  'No attacks yet. A support without attacks still counts through the buffs it gives.'
                )}
              >
                {t('teamOpt.rotation.noAttacks', 'No attacks')}
              </EmptyLine>
            )}
            {played ? null : selecting ? (
              <Box sx={{ ...actionsRowSx }}>
                <Button
                  variant="text"
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  disabled={!selected.size}
                  onClick={() => {
                    remove(selected)
                    stopSelecting()
                  }}
                  sx={[actionSx, { color: 'error.main' }]}
                >
                  {t('teamOpt.rotation.removeSelected', {
                    defaultValue: 'Remove ({{count}})',
                    count: selected.size,
                  })}
                </Button>
                <Button
                  variant="text"
                  size="small"
                  color="inherit"
                  sx={actionSx}
                  onClick={() =>
                    setSelected(
                      selected.size === attacks.length
                        ? new Set()
                        : new Set(attacks.map((_, i) => i))
                    )
                  }
                >
                  {selected.size === attacks.length
                    ? t('teamOpt.rotation.selectNone', 'None')
                    : t('teamOpt.rotation.selectAll', 'All')}
                </Button>
                <Box sx={{ flexGrow: 1 }} />
                <Button
                  variant="text"
                  size="small"
                  color="inherit"
                  onClick={stopSelecting}
                  sx={[actionSx, { color: 'text.primary' }]}
                >
                  {t('teamOpt.rotation.selectDone', 'Done')}
                </Button>
              </Box>
            ) : (
              <Box sx={actionsRowSx}>
                <Button
                  variant="text"
                  size="small"
                  color="inherit"
                  startIcon={<AddIcon />}
                  onClick={onShowPicker}
                  disabled={!data || full}
                  sx={actionSx}
                >
                  {t('teamOpt.rotation.add', 'Add attack')}
                </Button>
                {!!teamChar.customMultiTargets.length && (
                  <DropdownButton
                    // (one per member: ids stay unique on the page)
                    id={`teamopt-import-${characterKey}`}
                    variant="text"
                    size="small"
                    color="inherit"
                    disabled={full}
                    title={t('teamOpt.rotation.import', 'From multi-target')}
                    sx={actionSx}
                  >
                    {teamChar.customMultiTargets.map(({ name, targets }, i) => (
                      <MenuItem
                        // biome-ignore lint/suspicious/noArrayIndexKey: multi-targets have no ids
                        key={i}
                        disabled={!targets.length}
                        onClick={() => importTargets(i)}
                        sx={{ gap: 2, justifyContent: 'space-between' }}
                      >
                        {name}
                        <Typography
                          component="span"
                          sx={{ ...type.label, ...numSx }}
                        >
                          {t('teamOpt.rotation.importCount', {
                            count: targets.length,
                            defaultValue: '{{count}} attacks',
                          })}
                        </Typography>
                      </MenuItem>
                    ))}
                  </DropdownButton>
                )}
                <Box sx={{ flexGrow: 1 }} />
                {attacks.length > 1 && (
                  <Button
                    variant="text"
                    size="small"
                    color="inherit"
                    onClick={() => setSelecting(true)}
                    sx={actionSx}
                  >
                    {t('teamOpt.rotation.select', 'Select')}
                  </Button>
                )}
              </Box>
            )}
            {(undoable || imported) && (
              <Box
                role="status"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  minHeight: 30,
                  px: 1,
                  ...type.label,
                  ...numSx,
                }}
              >
                {undoable ? (
                  <>
                    {t('teamOpt.rotation.removed', {
                      defaultValue: 'Removed {{count}} attacks',
                      count: undo.count,
                    })}
                    <Button
                      variant="text"
                      size="small"
                      color="inherit"
                      onClick={() => {
                        setAttacks(() => undo.before)
                        setUndo(undefined)
                      }}
                      sx={[actionSx, { color: 'text.primary', minWidth: 0 }]}
                    >
                      {t('teamOpt.rotation.undo', 'Undo')}
                    </Button>
                  </>
                ) : (
                  imported &&
                  t('teamOpt.rotation.imported', {
                    defaultValue: '{{added}} added · {{updated}} updated',
                    added: imported.added,
                    updated: imported.updated,
                  })
                )}
              </Box>
            )}
          </Box>
          {/* the member's settings, at the bottom: in line with the other members' */}
          <Box sx={{ mt: 'auto' }}>{footer}</Box>
        </Box>
      </Fold>

      {dataContextValue && (
        <DataContext.Provider value={dataContextValue}>
          <TargetSelectorModal
            show={showPicker}
            onClose={onHidePicker}
            setTarget={addAttack}
            flatOnly
            excludeHeal
            excludeSections={[
              'basic',
              'bonusStats',
              'custom',
              'character',
              'teamBuff',
            ]}
          />
        </DataContext.Provider>
      )}
      {editingAttack && editing !== undefined && (
        <AttackFiguresContext.Provider value={figures || !!overrides}>
          <AttackEditor
            open
            readOnly={played}
            overrides={overrides}
            onClose={() => setEditing(undefined)}
            teamId={teamId}
            characterKey={characterKey}
            data={data}
            attack={editingAttack}
            buffs={buffs}
            mainStatAssumptionLevel={mainStatAssumptionLevel}
            members={members}
            onField={onField}
            onChange={(attack) =>
              setAttacks((list) =>
                list.map((a, i) => (i === editing ? attack : a))
              )
            }
            onDuplicate={() => {
              setAttacks((list) =>
                [
                  ...list.slice(0, editing + 1),
                  structuredClone(list[editing]),
                  ...list.slice(editing + 1),
                ].slice(0, TEAM_OPT_MAX_ATTACKS)
              )
              setEditing(editing + 1)
            }}
            onRemove={() => {
              remove(new Set([editing]))
              setEditing(undefined)
            }}
          />
        </AttackFiguresContext.Provider>
      )}
    </Box>
  )
}

/** The column's quiet text actions (Add attack, From multi-target, Select...) */
const actionSx = {
  minHeight: 30,
  px: 1,
  borderRadius: tokens.radius.control,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  color: 'text.secondary',
  ...quickSx,
  '&:hover': {
    color: 'text.primary',
    bgcolor: alpha(giTokens.parchment, 0.05),
  },
  '& .MuiButton-startIcon': { mr: 0.5, ml: -0.25 },
  '& .MuiButton-endIcon': { ml: 0.25 },
  '& .MuiButton-startIcon svg, & .MuiButton-endIcon svg': { fontSize: 18 },
} as const
/** (labels stay on one line; the row wraps instead) */
const actionsRowSx = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 0.25,
  mt: 0.5,
} as const

/**
 * A member's colour: its element's, from the theme (the same hue as its lane in the rotation's
 * timeline)
 */
export function memberHue(theme: Theme, characterKey: CharacterKey) {
  const palette = (
    theme.palette as unknown as Record<string, { main: string } | undefined>
  )[getCharEle(characterKey)]
  return palette?.main ?? theme.palette.text.secondary
}

/** A member's share of the rotation's damage, in its element's colour */
export function ShareBar({
  share,
  characterKey,
  sx,
}: {
  /** None yet: the bar's place is kept, empty */
  share: number | undefined
  characterKey: CharacterKey
  sx?: SxProps<Theme>
}) {
  return (
    <Box
      aria-hidden
      sx={[
        {
          mt: 1,
          height: 3,
          borderRadius: 1.5,
          bgcolor: share === undefined ? 'transparent' : tokens.hairline,
          overflow: 'hidden',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        sx={(theme) => ({
          height: '100%',
          width: `${Math.round((share ?? 0) * 100)}%`,
          borderRadius: 1.5,
          bgcolor: memberHue(theme, characterKey),
          opacity: 0.85,
          transition: `width .3s ${tokens.ease}`,
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      />
    </Box>
  )
}

/** The same attack of a multi-target (what an import updates rather than adds again) */
function sameAttack(a: TeamOptAttack, b: TeamOptAttack) {
  return (
    a.path.join('.') === b.path.join('.') &&
    (a.reaction ?? '') === (b.reaction ?? '') &&
    (a.infusionAura ?? '') === (b.infusionAura ?? '') &&
    a.hitMode === b.hitMode
  )
}

const noSubscribe = () => () => {}
/** Whether the member's attacks are shown: the shared flag's, else the prop's */
function useFoldOpen(store: ExpandStore | undefined, expanded: boolean) {
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.get ?? (() => expanded),
    store?.get ?? (() => expanded)
  )
}

/** The member's header: the button that opens and closes the attacks (its content is the card's) */
function FoldButton({
  store,
  expanded,
  foldable,
  ...props
}: ButtonBaseProps & {
  store: ExpandStore | undefined
  expanded: boolean
  foldable: boolean
  role?: string
}) {
  const open = useFoldOpen(store, expanded)
  return <ButtonBase {...props} aria-expanded={foldable ? open : undefined} />
}

function FoldChevron({
  store,
  expanded,
}: {
  store: ExpandStore | undefined
  expanded: boolean
}) {
  const open = useFoldOpen(store, expanded)
  return (
    <ExpandMoreIcon
      className="member-chevron"
      aria-hidden
      sx={{
        position: 'absolute',
        top: 19,
        right: 10,
        fontSize: 18,
        color: 'text.secondary',
        opacity: 0.65,
        transition: `transform .18s ${tokens.ease}, color .12s, opacity .12s`,
        transform: open ? 'rotate(180deg)' : 'none',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    />
  )
}

/**
 * The member's attacks, folded or shown: re-rendered alone when the flag flips. Folded, they
 * mount once the page is idle (they are most of a tab's elements), so a tab opens without them
 * and the first unfold is still instant
 */
function Fold({
  store,
  expanded,
  children,
}: {
  store: ExpandStore | undefined
  expanded: boolean
  children: ReactNode
}) {
  const open = useFoldOpen(store, expanded)
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (mounted) return undefined
    if (open) {
      setMounted(true)
      return undefined
    }
    const mount = () => startTransition(() => setMounted(true))
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(mount, { timeout: 1500 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(mount, 300)
    return () => clearTimeout(id)
  }, [open, mounted])
  return (
    <Collapse in={open} timeout={180}>
      {mounted || open ? children : null}
    </Collapse>
  )
}

/**
 * An attack of the rotation, on one line: what it is (with its reaction, crit mode and own on-field
 * member as small marks), its damage over the rotation and how often it hits
 */
const AttackRow = memo(function AttackRow({
  index,
  data,
  attack,
  onField,
  damage,
  selecting,
  selected,
  onClick,
  onRemove,
  figures,
  readOnly = false,
  part,
}: {
  index: number
  data: UIData | undefined
  attack: TeamOptAttack
  /** A played attack: it opens, read-only, and is not removed here */
  readOnly?: boolean
  /** One part of a grouped attack: named by what sets it apart (the group names the attack) */
  part?: PartLabel
  /** Its damage column (none without figures) */
  figures: boolean
  /** Who is on the field by default */
  onField: CharacterKey
  damage: number | undefined
  /** Picking attacks to remove: a click toggles this one */
  selecting: boolean
  selected: boolean
  onClick: (index: number) => void
  onRemove: (index: number) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  // who is on the field during this attack: its own choice, else the rotation's
  const ownOnField = attack.onField ?? onField
  return (
    // the row opens the attack (or picks it); its remove button sits beside, not inside
    <Box sx={(theme) => rowSx(theme, selected)}>
      <ButtonBase
        onClick={() => onClick(index)}
        aria-pressed={selecting ? selected : undefined}
        sx={{
          ...rowButtonSx,
          pr: selecting ? 1 : 0.25,
          ...(part && { flexWrap: 'wrap', rowGap: 0.25 }),
        }}
      >
        {selecting && <SelectMark selection={selected ? 'all' : 'none'} />}
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            {part ? (
              <PartName part={part} onField={ownOnField} />
            ) : (
              <>
                <AttackName
                  data={data}
                  path={attack.path}
                  oneLine
                  playedElement={attack.element}
                />
                <AttackMarks attack={attack} />
              </>
            )}
            {!part && ownOnField && (
              <SuspenseTooltip
                placement="top"
                title={
                  <>
                    <CharacterName characterKey={ownOnField} gender={gender} />{' '}
                    {t('teamOpt.attack.onField', 'on the field')}
                  </>
                }
              >
                <Box
                  component="span"
                  sx={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  <MemberAvatar characterKey={ownOnField} size={18} />
                </Box>
              </SuspenseTooltip>
            )}
          </Box>
        </Box>
        <RowFigures figures={figures} damage={damage} hits={attack.hits} />
        {part && <PartConditions part={part} indent={selecting} />}
      </ButtonBase>
      {!selecting && !readOnly && (
        <RemoveButton
          label={t('teamOpt.rotation.remove', 'Remove')}
          onClick={() => onRemove(index)}
        />
      )}
    </Box>
  )
})

/**
 * An attack the rotation plays with different members on the field or buffs up: one row with its
 * total, opening to its parts
 */
const AttackGroupRow = memo(function AttackGroupRow({
  groupKey,
  indices,
  data,
  attack,
  hits,
  damage,
  figures,
  open,
  selecting,
  selection,
  readOnly,
  onClick,
  onRemove,
  partCount,
  children,
}: {
  groupKey: string
  indices: readonly number[]
  /** Its parts shown (parts that differ only in effects of gear nobody holds are one) */
  partCount: number
  data: UIData | undefined
  /** Its first part (the parts share the name, reaction and hit mode) */
  attack: TeamOptAttack
  hits: number
  damage: number | undefined
  figures: boolean
  open: boolean
  selecting: boolean
  selection: Selection
  readOnly: boolean
  onClick: (key: string, indices: readonly number[]) => void
  onRemove: (indices: readonly number[]) => void
  children: ReactNode
}) {
  const { t } = useTranslation('page_team')
  const parts = t('teamOpt.rotation.parts', {
    defaultValue: '{{count}} parts',
    count: partCount,
  })
  return (
    <>
      <Box sx={(theme) => rowSx(theme, selection === 'all')}>
        <ButtonBase
          onClick={() => onClick(groupKey, indices)}
          aria-expanded={selecting ? undefined : open}
          aria-pressed={selecting ? selection === 'all' : undefined}
          sx={{ ...rowButtonSx, pr: selecting ? 1 : 0.25 }}
        >
          {selecting ? (
            <SelectMark selection={selection} />
          ) : (
            <ExpandMoreIcon
              aria-hidden
              sx={{
                fontSize: 18,
                ml: -0.25,
                mr: -0.5,
                flexShrink: 0,
                color: 'text.secondary',
                transform: open ? 'none' : 'rotate(-90deg)',
                transition: `transform .18s ${tokens.ease}`,
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                },
              }}
            />
          )}
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <AttackName
                data={data}
                path={attack.path}
                oneLine
                playedElement={attack.element}
              />
              <AttackMarks attack={attack} />
            </Box>
            <Typography noWrap sx={{ ...type.label, fontSize: 12, ...numSx }}>
              {parts}
            </Typography>
          </Box>
          <RowFigures figures={figures} damage={damage} hits={hits} />
        </ButtonBase>
        {!selecting && !readOnly && (
          <RemoveButton
            label={`${t('teamOpt.rotation.remove', 'Remove')} (${parts})`}
            onClick={() => onRemove(indices)}
          />
        )}
      </Box>
      <Collapse in={open || selecting} timeout={180} unmountOnExit>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.25,
            ml: 1.25,
            pl: 0.75,
            borderLeft: `1px solid ${giTokens.hairline}`,
          }}
        >
          <Suspense fallback={<Skeleton variant="text" width={160} />}>
            {children}
          </Suspense>
        </Box>
      </Collapse>
    </>
  )
})

type Selection = 'all' | 'some' | 'none'

/** What sets a part of a grouped attack apart from the group's other parts */
interface PartLabel {
  /** The parts differ in who is on the field: say it */
  onField: boolean
  /**
   * The buff states and limits the other parts don't all share: the characters' own first (not
   * their weapons' or sets'), the rarest first
   */
  conditions: { key: string; owner: TeamOptBuffOwner; node: ReactNode }[]
}

/**
 * Each part's label: its on-field member when that differs between the parts, and the buff states
 * and limits it doesn't share with every other part (the rest are the same for all of them)
 */
function partLabels(
  parts: readonly TeamOptAttack[],
  onField: CharacterKey,
  buffOf: BuffNames,
  off: string,
  /** Whether a buff's giver holds its weapon or set (absent: every state counts) */
  held?: (owner: TeamOptBuffOwner, item: string) => boolean
): PartLabel[] {
  const conditions = parts.map((attack) =>
    [
      ...(attack.states ?? []).map((state) => {
        const buff = buffOf(state, state.value)
        const stateName = buff.states?.find(
          (x) => x.value === state.value
        )?.name
        return {
          key: `s${state.owner}${state.path.join('.')}=${state.value}`,
          owner: state.owner,
          item: state.path[0],
          talent: !!buff.talent,
          unnamed: buff.unnamed,
          node: (
            <>
              {buff.title ?? buff.label ?? buff.name}
              {stateName && <> · {stateName}</>}
            </>
          ),
        }
      }),
      ...(attack.limits ?? []).map((limit) => {
        const buff = buffOf(limit)
        return {
          key: `l${limit.owner}${limit.path.join('.')}=${limit.hits}`,
          owner: limit.owner,
          item: limit.path[0],
          talent: !!buff.talent,
          unnamed: buff.unnamed,
          node: (
            <>
              {buff.title ?? buff.name}{' '}
              {limit.hits
                ? `${formatHits(limit.hits)}/${formatHits(attack.hits)}`
                : off}
            </>
          ),
        }
      }),
    ].filter((c) => !c.unnamed && (!held || held(c.owner, c.item)))
  )
  const count = new Map<string, number>()
  for (const list of conditions)
    for (const { key } of list) count.set(key, (count.get(key) ?? 0) + 1)
  const onFields = new Set(parts.map((attack) => attack.onField ?? onField))
  return conditions.map((list) => ({
    onField: onFields.size > 1,
    conditions: list
      .filter((c) => count.get(c.key)! < parts.length)
      .sort(
        (a, b) =>
          Number(b.talent) - Number(a.talent) ||
          count.get(a.key)! - count.get(b.key)!
      )
      .map(({ key, owner, node }) => ({ key, owner, node })),
  }))
}

/**
 * A part's name: who is on the field when that tells the parts apart (its other differences then
 * get a line of their own, see PartConditions), else what differs
 */
function PartName({
  part,
  onField,
}: {
  part: PartLabel
  onField: CharacterKey
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  if (!part.onField && part.conditions.length)
    return <ConditionTags conditions={part.conditions} />
  return (
    <Typography noWrap sx={{ fontSize: 13.5, color: 'text.secondary' }}>
      <Box component="span" sx={{ color: 'text.primary' }}>
        <CharacterName characterKey={onField} gender={gender} />
      </Box>{' '}
      {t('teamOpt.attack.onField', 'on the field')}
    </Typography>
  )
}

/** The buffs that set a part apart besides its on-field member: a full-width line under the row */
function PartConditions({
  part,
  indent,
}: {
  part: PartLabel
  /** Room for the select mark before the name */
  indent: boolean
}) {
  if (!part.onField || !part.conditions.length) return null
  return (
    <Box sx={{ flexBasis: '100%', minWidth: 0, pl: indent ? '26px' : 0 }}>
      <ConditionTags conditions={part.conditions} />
    </Box>
  )
}

function ConditionTags({
  conditions,
}: {
  conditions: PartLabel['conditions']
}) {
  const { t } = useTranslation('page_team')
  const shown = conditions.slice(0, 2)
  const more = conditions.length - shown.length
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.5,
        minWidth: 0,
      }}
    >
      {shown.map(({ key, owner, node }) => (
        <Tag key={key} sx={{ minWidth: 0, maxWidth: '100%' }}>
          {owner !== 'team' && (
            <Box
              component="span"
              sx={{ display: 'inline-block', verticalAlign: -3, mr: 0.5 }}
            >
              <MemberAvatar characterKey={owner} size={14} />
            </Box>
          )}
          {node}
        </Tag>
      ))}
      {more > 0 && (
        <Tooltip
          title={t('teamOpt.rotation.moreConditions', {
            defaultValue: '{{count}} more buffs: open the attack to see them',
            count: more,
          })}
        >
          <Tag sx={{ flexShrink: 0, color: 'text.secondary', ...numSx }}>
            +{more}
          </Tag>
        </Tooltip>
      )}
    </Box>
  )
}

type BuffNames = (
  ref: BuffRef,
  value?: string
) => Pick<
  TeamBuff,
  'name' | 'label' | 'title' | 'states' | 'unnamed' | 'talent'
>

/**
 * Names a buff an attack sets: the team's own when it is on there, else from its sheet (the
 * rotation sets buffs per attack that are off in Team settings)
 */
function useBuffNames(
  buffs: readonly TeamBuff[],
  teamData: TeamData | undefined
): BuffNames {
  return useMemo(() => {
    const described = new Map<
      string,
      Pick<
        TeamBuff,
        'name' | 'label' | 'title' | 'states' | 'unnamed' | 'talent'
      >
    >()
    return (ref, value = 'on') => {
      const own = buffs.find((b) => sameBuff(b.ref, ref))
      if (own) return own
      const key = buffRefKey(ref)
      let found = described.get(key)
      if (!found) {
        found = teamData
          ? describe(ref, value, teamData)
          : { name: ref.path.join(' · '), unnamed: true as const }
        described.set(key, found)
      }
      return found
    }
  }, [buffs, teamData])
}

const toggled = (set: ReadonlySet<string>, key: string) => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

const rowSx = (theme: Theme, selected: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  borderRadius: tokens.radius.control,
  ...quickSx,
  ...(selected && selectedSx(theme)),
  '&:hover': {
    bgcolor: selected
      ? alpha(theme.palette.primary.main, 0.14)
      : alpha(giTokens.parchment, 0.05),
  },
  // the remove button shows on hover and keyboard focus (always without hover)
  '&:hover .attack-remove, &:focus-within .attack-remove': { opacity: 1 },
  '@media (hover: none)': { '& .attack-remove': { opacity: 1 } },
})

const rowButtonSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  flexGrow: 1,
  minWidth: 0,
  textAlign: 'left',
  pl: 0.75,
  py: 0.5,
  minHeight: 36,
  borderRadius: tokens.radius.control,
  ...focusSx,
} as const

function SelectMark({ selection }: { selection: Selection }) {
  const Icon =
    selection === 'all'
      ? CheckBoxIcon
      : selection === 'some'
        ? IndeterminateCheckBoxIcon
        : CheckBoxOutlineBlankIcon
  return (
    <Icon
      sx={{
        fontSize: 18,
        color: selection === 'none' ? 'text.secondary' : 'primary.main',
        flexShrink: 0,
      }}
    />
  )
}

/** What is special about an attack: its reaction and crit mode, as small marks after its name */
function AttackMarks({ attack }: { attack: TeamOptAttack }) {
  const { t } = useTranslation('page_team')
  const { t: tSheet } = useTranslation('sheet_gen')
  return (
    <>
      {attack.reaction && (
        <Tag sx={{ color: `${attack.reaction}.main`, flexShrink: 0 }}>
          {tSheet(`reaction.${attack.reaction}`)}
        </Tag>
      )}
      {attack.hitMode === 'critHit' && (
        <Tag sx={{ flexShrink: 0 }}>{t('teamOpt.hitMode.critHit', 'Crit')}</Tag>
      )}
      {attack.hitMode === 'hit' && (
        <Tag sx={{ flexShrink: 0 }}>{t('teamOpt.hitMode.hit', 'Non-crit')}</Tag>
      )}
    </>
  )
}

/** A row's damage over the rotation and its hits, in columns */
function RowFigures({
  figures,
  damage,
  hits,
}: {
  figures: boolean
  damage: number | undefined
  hits: number
}) {
  return (
    <>
      {figures && (
        <Typography
          component="span"
          sx={{
            ...type.label,
            ...numSx,
            flexShrink: 0,
            minWidth: '3.4em',
            textAlign: 'right',
          }}
        >
          {formatDamage(damage)}
        </Typography>
      )}
      <Typography
        component="span"
        sx={{
          fontSize: 13.5,
          fontWeight: 650,
          ...numSx,
          flexShrink: 0,
          minWidth: '2.4em',
          textAlign: 'right',
        }}
      >
        ×{formatHits(hits)}
      </Typography>
    </>
  )
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip title={label}>
      <IconButton
        className="attack-remove"
        size="small"
        aria-label={label}
        onClick={onClick}
        sx={{
          opacity: 0,
          mr: 0.25,
          p: 0.5,
          color: 'text.secondary',
          transition: 'opacity .12s, color .12s, background-color .12s',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          '&:hover': { color: 'error.main' },
          ...focusSx,
        }}
      >
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  )
}

/** A small mark on an attack: its reaction, crit mode, or its buff conditions' count */
const Tag = forwardRef<
  HTMLSpanElement,
  {
    children: ReactNode
    sx?: SxProps<Theme>
    'aria-label'?: string
  } & HTMLAttributes<HTMLSpanElement>
>(function Tag({ children, sx, ...rest }, ref) {
  return (
    <Box
      component="span"
      ref={ref}
      {...rest}
      sx={[
        {
          // not flex: the name's parts (translated pieces) keep their spaces
          display: 'inline-block',
          verticalAlign: 'middle',
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          px: 0.625,
          borderRadius: 1,
          fontSize: 11.5,
          fontWeight: 600,
          lineHeight: '18px',
          color: 'text.primary',
          bgcolor: alpha(giTokens.parchment, 0.07),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  )
})
