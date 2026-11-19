import { characterAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type { RotationMember } from '@genshin-optimizer/gi/ui'
import { parseRotation } from '@genshin-optimizer/gi/ui'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotationReadout } from './RotationInline'
import { editorSx } from './RotationWriter'
import { focusSx, hairline, insetSx, quickSx, tokens, type } from './ui'

export const CONSTELLATIONS = [0, 1, 2, 3, 4, 5, 6] as const

/** The rotations written for a member's constellations (one text each; absent: the team's) */
export type ConsRotationTexts = Partial<Record<number, string>>

function allConsRotations(database: ArtCharDatabase, teamId: string) {
  try {
    const data = JSON.parse(
      database.teams.getRotationField(
        `${teamId}_kqm`,
        'ConstellationRotations'
      ) ?? '{}'
    )
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Partial<Record<CharacterKey, ConsRotationTexts>>)
      : {}
  } catch {
    return {}
  }
}

export function readConsRotations(
  database: ArtCharDatabase,
  teamId: string,
  ck: CharacterKey
): ConsRotationTexts {
  const rotations = allConsRotations(database, teamId)[ck]
  return Object.fromEntries(
    CONSTELLATIONS.flatMap((cons) => {
      const text = rotations?.[cons]
      return typeof text === 'string' ? [[cons, text]] : []
    })
  )
}

export function writeConsRotations(
  database: ArtCharDatabase,
  teamId: string,
  ck: CharacterKey,
  rotations: ConsRotationTexts
) {
  const all = allConsRotations(database, teamId) ?? {}
  if (Object.keys(rotations).length) all[ck] = rotations
  else delete all[ck]
  database.teams.setRotationField(
    `${teamId}_kqm`,
    'ConstellationRotations',
    Object.keys(all).length ? JSON.stringify(all) : null
  )
}

/**
 * The rotation a constellation plays: its own, else the nearest lower constellation's own (down to
 * the run's constellation, which plays the team's), else the team's (`text` absent). `from`: the
 * constellation whose own it is.
 */
export function consRotationOf(
  rotations: ConsRotationTexts,
  cons: number,
  ran: number
): { text?: string; from?: number } {
  for (let k = cons; k >= 0; k--) {
    if (k === ran) return {}
    const own = rotations[k]?.trim()
    if (own) return { text: own, from: k }
  }
  return {}
}

const shortcut =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘ Enter'
    : 'Ctrl+Enter'

/**
 * A member's rotation at each constellation, read as steps. A constellation plays its own, else
 * the one below it does (a change at C2 carries to C3–C6 unless they have their own), else the
 * team's (`consRotationOf`). A row opens as text to change (the rotation it plays, ready to edit);
 * saved, it is that constellation's own; ↺ removes it. The run's constellation plays the run's
 * rotation.
 */
export function ConsRotations({
  characterKey: ck,
  ran,
  rotations,
  teamText,
  names,
  gender,
  onChange,
}: {
  characterKey: CharacterKey
  /** the constellation the run used */
  ran: number
  rotations: ConsRotationTexts
  teamText: string
  names: RotationMember[]
  gender: GenderKey
  onChange: (next: ConsRotationTexts) => void
}) {
  const { t } = useTranslation('page_team')
  const [editing, setEditing] = useState<number>()
  const [draft, setDraft] = useState('')
  const played = (cons: number) => consRotationOf(rotations, cons, ran)
  /** What a constellation would play without its own */
  const below = (cons: number) => {
    const { [cons]: _, ...rest } = rotations
    return consRotationOf(rest, cons, ran)
  }
  const open = (cons: number) => {
    setEditing(cons)
    setDraft(played(cons).text ?? teamText)
  }
  /** `draft` as the constellation's own (none when it is what it would play anyway) */
  const save = (cons: number) => {
    const next = { ...rotations }
    const text = draft.trim()
    if (!text || text === (below(cons).text ?? teamText).trim())
      delete next[cons]
    else next[cons] = text
    onChange(next)
    setEditing(undefined)
  }
  const reset = (cons: number) => {
    const next = { ...rotations }
    delete next[cons]
    onChange(next)
  }
  const warnings = useMemo(
    () =>
      editing === undefined || !draft.trim()
        ? []
        : parseRotation(draft, names).warnings,
    [editing, draft, names]
  )
  const icon = (cons: number) =>
    characterAsset(
      ck,
      cons ? (`constellation${cons}` as 'constellation1') : 'icon',
      gender
    ) ?? ''
  const status = (cons: number) => {
    if (cons === ran) return t('teamOpt.kqm.share.consRun', 'Run')
    const { from } = played(cons)
    if (from === cons) return t('teamOpt.kqm.share.consOwn', 'Own rotation')
    if (from !== undefined)
      return t('teamOpt.kqm.share.consAs', {
        defaultValue: 'Same as C{{cons}}',
        cons: from,
      })
    return t('teamOpt.kqm.share.consTeam', 'Team rotation')
  }
  return (
    <Box sx={{ ...insetSx, overflow: 'hidden' }}>
      {CONSTELLATIONS.map((cons, i) => {
        const { text: written, from } = played(cons)
        const text = written ?? teamText
        // (another rotation than the team's: shown full; its own: its label in gold)
        const other = from !== undefined
        const mine = from === cons
        const isOpen = editing === cons
        const head = (
          <>
            <Box
              component="img"
              src={icon(cons)}
              alt=""
              aria-hidden
              sx={{ width: 30, height: 30, objectFit: 'contain' }}
            />
            <Box sx={{ display: 'grid', gap: 0.25 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1 }}>
                C{cons}
              </Typography>
              <Typography
                sx={{
                  ...type.label,
                  fontSize: 11.5,
                  lineHeight: 1.1,
                  whiteSpace: 'nowrap',
                  color: mine ? tokens.gold : 'text.secondary',
                }}
              >
                {status(cons)}
              </Typography>
            </Box>
          </>
        )
        return (
          <Box
            key={cons}
            sx={{
              borderTop: i ? hairline : 'none',
              bgcolor: isOpen ? tokens.raised : undefined,
            }}
          >
            {isOpen ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '30px 96px minmax(0, 1fr)',
                  columnGap: 1.25,
                  alignItems: 'start',
                  px: 1.75,
                  py: 1.5,
                }}
              >
                {head}
                <Box sx={{ display: 'grid', gap: 1 }}>
                  <TextField
                    autoFocus
                    multiline
                    minRows={2}
                    fullWidth
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => {
                      const end = e.target.value.length
                      e.target.setSelectionRange(end, end)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        // (closes the editor, not the dialog)
                        e.stopPropagation()
                        setEditing(undefined)
                      } else if (
                        e.key === 'Enter' &&
                        (e.metaKey || e.ctrlKey)
                      ) {
                        e.preventDefault()
                        save(cons)
                      }
                    }}
                    inputProps={{
                      'aria-label': t('teamOpt.kqm.share.consRotationLabel', {
                        defaultValue: 'Rotation at C{{cons}}',
                        cons,
                      }),
                      spellCheck: false,
                    }}
                    sx={editorSx}
                  />
                  {!!warnings.length && (
                    <Typography sx={{ fontSize: 12.5, color: 'warning.main' }}>
                      {warnings[0]}
                    </Typography>
                  )}
                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 1,
                    }}
                  >
                    <Tooltip title={shortcut} arrow>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => save(cons)}
                      >
                        {t('teamOpt.kqm.share.consSave', 'Save')}
                      </Button>
                    </Tooltip>
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => setDraft(teamText)}
                      disabled={draft.trim() === teamText.trim()}
                    >
                      {t('teamOpt.kqm.share.consFromTeam', 'Team rotation')}
                    </Button>
                    <Box sx={{ flex: 1 }} />
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => setEditing(undefined)}
                    >
                      {t('teamOpt.kqm.share.consCancel', 'Cancel')}
                    </Button>
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  pr: 1,
                  ...quickSx,
                  '&:hover': {
                    bgcolor: cons === ran ? undefined : alpha('#ece5d8', 0.035),
                  },
                }}
              >
                <ButtonBase
                  disabled={cons === ran}
                  onClick={() => open(cons)}
                  aria-label={t('teamOpt.kqm.share.consEdit', {
                    defaultValue: 'Edit the rotation at C{{cons}}',
                    cons,
                  })}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    display: 'grid',
                    gridTemplateColumns: '30px 96px minmax(0, 1fr)',
                    columnGap: 1.25,
                    alignItems: 'center',
                    textAlign: 'left',
                    justifyItems: 'start',
                    pl: 1.75,
                    py: 1.25,
                    borderRadius: 0,
                    ...focusSx,
                  }}
                >
                  {head}
                  <Box
                    sx={{
                      minWidth: 0,
                      // (the team's rotation faint: a constellation's own stands out)
                      opacity: other ? 1 : 0.55,
                    }}
                  >
                    {text.trim() ? (
                      <RotationReadout
                        text={text}
                        opener=""
                        counted={false}
                        names={names}
                      />
                    ) : (
                      <Typography sx={type.label}>
                        {t(
                          'teamOpt.kqm.share.consRotationNone',
                          'The team’s attacks'
                        )}
                      </Typography>
                    )}
                  </Box>
                </ButtonBase>
                <Box sx={{ display: 'flex', gap: 0.25 }}>
                  {mine && (
                    <Tooltip
                      arrow
                      title={
                        below(cons).from !== undefined
                          ? t('teamOpt.kqm.share.consResetTo', {
                              defaultValue: 'Use C{{cons}}’s rotation',
                              cons: below(cons).from,
                            })
                          : t(
                              'teamOpt.kqm.share.consReset',
                              'Use the team’s rotation'
                            )
                      }
                    >
                      <IconButton size="small" onClick={() => reset(cons)}>
                        <ReplayRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {cons !== ran && (
                    <Tooltip
                      arrow
                      title={t('teamOpt.kqm.share.consEditShort', 'Edit')}
                    >
                      <IconButton size="small" onClick={() => open(cons)}>
                        <EditRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * A rotation written for a combination of constellations (several members raised at once: Flins
 * C2 with Danica C1 plays differently from either alone)
 */
export interface ComboRotation {
  /** the members raised and to which constellation (at least two) */
  cons: Partial<Record<CharacterKey, number>>
  text: string
}
export function readComboRotations(
  database: ArtCharDatabase,
  teamId: string
): ComboRotation[] {
  try {
    const saved = JSON.parse(
      database.teams.getRotationField(
        `${teamId}_kqm`,
        'CombinationRotations'
      ) ?? '[]'
    )
    return Array.isArray(saved)
      ? saved.filter(
          (x): x is ComboRotation =>
            !!x &&
            typeof x === 'object' &&
            typeof x.text === 'string' &&
            !!x.cons &&
            typeof x.cons === 'object' &&
            !Array.isArray(x.cons)
        )
      : []
  } catch {
    return []
  }
}
export function writeComboRotations(
  database: ArtCharDatabase,
  teamId: string,
  combos: ComboRotation[]
) {
  database.teams.setRotationField(
    `${teamId}_kqm`,
    'CombinationRotations',
    combos.length ? JSON.stringify(combos) : null
  )
}
/** A combination's members raised above the run's constellations */
const raisedOf = (
  combo: ComboRotation,
  base: Partial<Record<CharacterKey, number>>
) =>
  (Object.entries(combo.cons) as [CharacterKey, number][]).filter(
    ([k, c]) => c > (base[k] ?? 0)
  )
/**
 * The rotation written for a combination that the team's constellations include: every member it
 * raises at least that high (Flins C2 + Danica C1 also covers Flins C3 + Danica C1, as a
 * constellation's rotation carries to the higher ones), the one with the most constellations
 * first; none: undefined
 */
export function comboRotationOf(
  combos: readonly ComboRotation[],
  cons: Partial<Record<CharacterKey, number>>,
  base: Partial<Record<CharacterKey, number>>
) {
  let best: { text: string; size: number } | undefined
  for (const combo of combos) {
    const raised = raisedOf(combo, base)
    if (raised.length < 2 || !combo.text.trim()) continue
    if (!raised.every(([k, c]) => (cons[k] ?? base[k] ?? 0) >= c)) continue
    const size = raised.reduce((n, [k, c]) => n + c - (base[k] ?? 0), 0)
    if (!best || size > best.size) best = { text: combo.text.trim(), size }
  }
  return best?.text
}

/**
 * Rotations for combinations of constellations (advanced): each one the members it raises (a
 * constellation each, at least two) and the rotation the team plays with them, used for those
 * constellations and any higher ones in the team's investment chart
 */
export function ComboRotations({
  keys,
  base,
  combos,
  teamText,
  names,
  onChange,
}: {
  keys: CharacterKey[]
  /** each member's constellation in the run */
  base: Partial<Record<CharacterKey, number>>
  combos: ComboRotation[]
  teamText: string
  names: RotationMember[]
  onChange: (next: ComboRotation[]) => void
}) {
  const { t } = useTranslation('page_team')
  const [editing, setEditing] = useState<number>()
  const [draft, setDraft] = useState('')
  const nameOf = (k: CharacterKey) =>
    names.find((n) => n.characterKey === k)?.name ?? k
  const set = (i: number, next: ComboRotation) =>
    onChange(combos.map((c, j) => (j === i ? next : c)))
  const add = () => {
    onChange([...combos, { cons: {}, text: teamText }])
    setEditing(combos.length)
    setDraft(teamText)
  }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {combos.map((combo, i) => {
        const raised = raisedOf(combo, base)
        const isOpen = editing === i
        return (
          <Box key={i} sx={{ ...insetSx, p: 1.25, display: 'grid', gap: 1 }}>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 1,
              }}
            >
              {keys.map((k) => {
                const from = base[k] ?? 0
                const value = combo.cons[k] ?? from
                return (
                  <TextField
                    key={k}
                    select
                    size="small"
                    value={value}
                    onChange={(e) => {
                      const c = Number(e.target.value)
                      const cons = { ...combo.cons }
                      if (c > from) cons[k] = c
                      else delete cons[k]
                      set(i, { ...combo, cons })
                    }}
                    label={nameOf(k)}
                    sx={{
                      width: 116,
                      '& .MuiInputBase-root': {
                        color: value > from ? tokens.gold : undefined,
                        fontWeight: value > from ? 700 : 400,
                      },
                    }}
                  >
                    {CONSTELLATIONS.filter((c) => c >= from).map((c) => (
                      <MenuItem key={c} value={c}>
                        {c === from
                          ? t('teamOpt.kqm.share.comboAsRun', {
                              defaultValue: 'C{{cons}} (run)',
                              cons: c,
                            })
                          : `C${c}`}
                      </MenuItem>
                    ))}
                  </TextField>
                )
              })}
              <Box sx={{ flex: 1 }} />
              <Tooltip
                arrow
                title={t('teamOpt.kqm.share.comboRemove', 'Remove')}
              >
                <IconButton
                  size="small"
                  onClick={() => {
                    onChange(combos.filter((_, j) => j !== i))
                    setEditing(undefined)
                  }}
                  aria-label={t('teamOpt.kqm.share.comboRemove', 'Remove')}
                >
                  <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>
            {raised.length < 2 && (
              <Typography sx={{ ...type.label, fontSize: 12 }}>
                {t(
                  'teamOpt.kqm.share.comboPick',
                  'Raise at least two members above the run’s constellations.'
                )}
              </Typography>
            )}
            {isOpen ? (
              <Box sx={{ display: 'grid', gap: 1 }}>
                <TextField
                  autoFocus
                  multiline
                  minRows={2}
                  fullWidth
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setEditing(undefined)
                    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      set(i, { ...combo, text: draft.trim() })
                      setEditing(undefined)
                    }
                  }}
                  inputProps={{
                    'aria-label': t(
                      'teamOpt.kqm.share.comboRotation',
                      'Rotation for this combination'
                    ),
                    spellCheck: false,
                  }}
                  sx={editorSx}
                />
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Tooltip title={shortcut} arrow>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => {
                        set(i, { ...combo, text: draft.trim() })
                        setEditing(undefined)
                      }}
                    >
                      {t('teamOpt.kqm.share.consSave', 'Save')}
                    </Button>
                  </Tooltip>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setEditing(undefined)}
                  >
                    {t('teamOpt.kqm.share.consCancel', 'Cancel')}
                  </Button>
                </Box>
              </Box>
            ) : (
              <ButtonBase
                onClick={() => {
                  setEditing(i)
                  setDraft(combo.text || teamText)
                }}
                aria-label={t(
                  'teamOpt.kqm.share.comboEdit',
                  'Edit the rotation for this combination'
                )}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 1,
                  textAlign: 'left',
                  borderRadius: 1,
                  p: 0.5,
                  ...focusSx,
                  '&:hover': { bgcolor: alpha('#ece5d8', 0.035) },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <RotationReadout
                    text={combo.text || teamText}
                    opener=""
                    counted={false}
                    names={names}
                  />
                </Box>
                <EditRoundedIcon
                  sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }}
                />
              </ButtonBase>
            )}
          </Box>
        )
      })}
      <Box>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<AddRoundedIcon />}
          onClick={add}
        >
          {t('teamOpt.kqm.share.comboAdd', 'Add a combination')}
        </Button>
      </Box>
    </Box>
  )
}
