import {
  CardThemed,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import { weaponAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allCharacterKeys,
  charKeyToLocGenderedCharKey,
  signatureWeapons,
} from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import {
  CharacterSingleSelectionModal,
  kqmMemberConstellation,
  parseRotation,
  rotationTemplateKinds,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import AddIcon from '@mui/icons-material/Add'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CloseIcon from '@mui/icons-material/Close'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import SearchIcon from '@mui/icons-material/Search'
import SubjectRoundedIcon from '@mui/icons-material/SubjectRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Autocomplete,
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  Popover,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotationFields } from './KqmVersionList'
import {
  characterPartSuggestions,
  comboAutoRotation,
  comboIdentityKey,
  comboMainMember,
  defaultComboPart,
  existingFamilyComboKeys,
  familyPartHints,
  generatePoolCombinations,
  MAX_COMBO_POOL,
  memberSetKey,
  suggestedPoolAdditions,
  swapsForCombo,
} from './kqmVersionCombos'
import { createVersion, versionName } from './kqmVersions'
import { MemberAvatar, VersionPortrait } from './MemberAvatar'
import { mono, RotationReadout } from './RotationInline'
import { templateText } from './RotationTemplates'
import { laneColor } from './RotationTimeline'
import { memberNamesOf } from './RotationWriter'
import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  rowHoverSx,
  selectedSx,
  tokens,
  type,
} from './ui'

interface CustomComboEdit {
  text: string
  opener: string
  templateId?: string
  forceSwapped?: boolean
}

/**
 * Generates all 4-character (or team-size) combinations from a pool of up to 8 characters as
 * versions of the team. Keeps the dialog calm with progressive disclosure:
 * 1. Pool of up to 8 characters (1-click teammate suggestions + search + lock core + inline
 *    action popover per added character so there's zero chip clutter).
 * 2. Clean scannable preview list (expand any row to inspect/edit its rotation).
 */
export function VersionCombosDialog({
  teamId,
  onClose,
  onCreated,
}: {
  teamId: string
  onClose: () => void
  onCreated: (ids: string[]) => void
}) {
  const { t, i18n } = useTranslation([
    'page_team',
    'charNames_gen',
    'weaponNames_gen',
  ])
  const { gender } = useDBMeta()
  const database = useDatabase()

  const rootMembers = useMemo(
    () => teamOptMembers(database, teamId).map((m) => m.characterKey),
    [database, teamId]
  )
  const rootKqm = database.teams.get(teamId)?.teamOpt?.kqm
  const teamSize = rootMembers.length
  const mainDps = useMemo(
    () => comboMainMember(database, teamId, { i18n, gender }),
    [database, teamId, i18n, gender]
  )
  const familyHints = useMemo(
    () => familyPartHints(database, teamId, { i18n, gender }),
    [database, teamId, i18n, gender]
  )
  const existingKeys = useMemo(
    () => existingFamilyComboKeys(database, teamId),
    [database, teamId]
  )

  const [pool, setPool] = useState<CharacterKey[]>(() => [...rootMembers])
  const [locked, setLocked] = useState<CharacterKey[]>(() =>
    mainDps && teamSize >= 2 ? [mainDps] : []
  )
  // Per-character constellation overrides (absent: family/character default)
  const [cons, setCons] = useState<Partial<Record<CharacterKey, number>>>({})
  const [consMenu, setConsMenu] = useState<{
    ck: CharacterKey
    anchor: HTMLElement
  }>()
  // Per-character signature weapon overrides (absent: Any, 0: No sig, 1–5: R1–R5)
  const [sig, setSig] = useState<Partial<Record<CharacterKey, number>>>({})
  const [sigMenu, setSigMenu] = useState<{
    ck: CharacterKey
    anchor: HTMLElement
  }>()
  const [picking, setPicking] = useState(false)
  const [searchInput, setSearchInput] = useState('')

  const consOf = (ck: CharacterKey) =>
    cons[ck] ?? kqmMemberConstellation(ck, rootKqm)
  const setConsOf = (ck: CharacterKey, n: number) =>
    setCons((prev) => {
      const next = { ...prev }
      if (n === kqmMemberConstellation(ck, rootKqm)) delete next[ck]
      else next[ck] = n
      return next
    })
  const setSigOf = (ck: CharacterKey, r: number | undefined) =>
    setSig((prev) => {
      const next = { ...prev }
      if (r === undefined) delete next[ck]
      else next[ck] = r
      return next
    })

  // Per-character action part for added pool characters + currently open popover anchor
  const [parts, setParts] = useState<Partial<Record<CharacterKey, string>>>({})
  const [userEditedParts, setUserEditedParts] = useState<Set<CharacterKey>>(
    () => new Set()
  )
  const [partPopover, setPartPopover] = useState<{
    ck: CharacterKey
    anchor: HTMLElement
  }>()

  // Per-combo selection & edits
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set())
  const [comboEdits, setComboEdits] = useState<Record<string, CustomComboEdit>>(
    {}
  )
  const [expandedKey, setExpandedKey] = useState<string>()
  const [showRotations, setShowRotations] = useState(false)
  const [showInTeams, setShowInTeams] = useState(false)
  const [creating, setCreating] = useState<{ done: number; total: number }>()

  const busy = !!creating
  const charName = (ck: CharacterKey) =>
    t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`)

  const addCharacter = (ck: CharacterKey) => {
    if (pool.includes(ck) || pool.length >= MAX_COMBO_POOL) return
    setPool((prev) => [...prev, ck])
    setParts((prev) =>
      prev[ck] !== undefined
        ? prev
        : { ...prev, [ck]: defaultComboPart(ck, familyHints[ck]) }
    )
    setSearchInput('')
  }

  const removeCharacter = (ck: CharacterKey) => {
    if (pool.length <= 1) return
    setPool((prev) => prev.filter((k) => k !== ck))
    setLocked((prev) => prev.filter((k) => k !== ck))
    setCons((prev) => {
      if (!(ck in prev)) return prev
      const next = { ...prev }
      delete next[ck]
      return next
    })
    setSig((prev) => {
      if (!(ck in prev)) return prev
      const next = { ...prev }
      delete next[ck]
      return next
    })
    if (partPopover?.ck === ck) setPartPopover(undefined)
    if (consMenu?.ck === ck) setConsMenu(undefined)
    if (sigMenu?.ck === ck) setSigMenu(undefined)
  }

  const toggleLock = (ck: CharacterKey) => {
    setLocked((prev) => {
      if (prev.includes(ck)) return prev.filter((k) => k !== ck)
      if (prev.length >= Math.max(1, teamSize - 1)) return prev
      return [...prev, ck]
    })
  }

  const setPartFor = (ck: CharacterKey, value: string) => {
    setParts((prev) => ({ ...prev, [ck]: value }))
    setUserEditedParts((prev) => {
      const next = new Set(prev)
      next.add(ck)
      return next
    })
  }

  const addedChars = useMemo(
    () => pool.filter((k) => !rootMembers.includes(k)),
    [pool, rootMembers]
  )
  const mainLocked = !!mainDps && locked.includes(mainDps)
  const canAddMore = pool.length < MAX_COMBO_POOL

  const suggestedAdditions = useMemo(
    () => (canAddMore ? suggestedPoolAdditions(pool, mainDps, 6) : []),
    [canAddMore, pool, mainDps]
  )

  const autocompleteOptions = useMemo(() => {
    const owned = new Set(database.chars.keys)
    const inPool = new Set(pool)
    return allCharacterKeys
      .filter((ck) => !inPool.has(ck))
      .map((ck) => ({
        key: ck,
        label: t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`),
        favorite: database.charMeta.get(ck).favorite,
        owned: owned.has(ck),
      }))
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
        if (a.owned !== b.owned) return a.owned ? -1 : 1
        return a.label.localeCompare(b.label)
      })
  }, [database, pool, t, gender])

  const effectiveParts = useMemo(() => {
    const map: Partial<Record<CharacterKey, string>> = {}
    for (const ck of addedChars)
      map[ck] = parts[ck] ?? defaultComboPart(ck, familyHints[ck])
    return map
  }, [addedChars, parts, familyHints])

  const combos = useMemo(() => {
    const raw = generatePoolCombinations(pool, locked, teamSize, rootMembers)
    return raw.map((combo) => {
      const setKey = memberSetKey(combo)
      const swaps = swapsForCombo(rootMembers, combo, mainDps)
      const orderedMembers = rootMembers.map(
        (k) => swaps.find((s) => s.from === k)?.to ?? k
      )
      const comboCons: Partial<Record<CharacterKey, number>> = {}
      const comboSig: Partial<Record<CharacterKey, number>> = {}
      for (const k of orderedMembers) {
        if (cons[k] !== undefined) comboCons[k] = cons[k]
        if (sig[k] !== undefined && signatureWeapons[k]) comboSig[k] = sig[k]
      }
      const identityKey = comboIdentityKey(
        orderedMembers,
        (k) => comboCons[k] ?? kqmMemberConstellation(k, rootKqm),
        (k) => comboSig[k]
      )
      const exists = existingKeys.has(identityKey)
      const auto = exists
        ? undefined
        : comboAutoRotation(
            database,
            teamId,
            rootMembers,
            swaps,
            { i18n, gender },
            {
              partOverrides: effectiveParts,
              userEditedParts,
              mainDps,
            }
          )
      return {
        setKey,
        exists,
        swaps,
        members: orderedMembers,
        cons: comboCons,
        sig: comboSig,
        auto,
      }
    })
  }, [
    pool,
    locked,
    teamSize,
    rootMembers,
    cons,
    sig,
    rootKqm,
    existingKeys,
    mainDps,
    database,
    teamId,
    i18n,
    gender,
    effectiveParts,
    userEditedParts,
  ])

  const newCombos = useMemo(() => combos.filter((c) => !c.exists), [combos])
  const existingCount = combos.length - newCombos.length
  const selectedCombos = useMemo(
    () => newCombos.filter((c) => !deselected.has(c.setKey)),
    [newCombos, deselected]
  )

  const toggleCombo = (setKey: string) => {
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(setKey)) next.delete(setKey)
      else next.add(setKey)
      return next
    })
  }

  const rotationOfCombo = (item: (typeof newCombos)[number]) => {
    const edit = comboEdits[item.setKey]
    const auto = item.auto!
    if (edit) {
      if (edit.forceSwapped)
        return {
          text: auto.swapped.text,
          opener: auto.swapped.opener,
          badge: 'swapped' as const,
        }
      return {
        text: edit.text,
        opener: edit.opener,
        badge: edit.templateId ? ('template' as const) : ('edited' as const),
      }
    }
    return {
      text: auto.text,
      opener: auto.opener,
      badge: auto.source,
    }
  }

  const handleCreate = () => {
    if (!selectedCombos.length || busy) return
    const items = selectedCombos.map((item) => ({
      swaps: item.swaps,
      members: item.members,
      cons: item.cons,
      sig: item.sig,
      rotation: rotationOfCombo(item),
    }))
    const total = items.length
    setCreating({ done: 0, total })

    const createdIds: string[] = []
    let index = 0
    const BATCH = 3

    const step = () => {
      const end = Math.min(index + BATCH, total)
      for (; index < end; index++) {
        const {
          swaps,
          members,
          cons: itemCons,
          sig: itemSig,
          rotation,
        } = items[index]
        const id = createVersion(
          database,
          teamId,
          swaps,
          { i18n, gender },
          { text: rotation.text, opener: rotation.opener },
          itemCons,
          versionName(members, itemCons, { i18n, gender }, itemSig),
          undefined,
          itemSig,
          showInTeams
        )
        if (id) createdIds.push(id)
      }
      setCreating({ done: index, total })
      if (index < total) {
        setTimeout(step, 0)
      } else {
        setCreating(undefined)
        if (createdIds.length) onCreated(createdIds)
        onClose()
      }
    }
    setTimeout(step, 20)
  }

  // Active action-popover data
  const popoverCk = partPopover?.ck
  const popoverValue = popoverCk ? (effectiveParts[popoverCk] ?? '') : ''
  const popoverName = popoverCk ? charName(popoverCk) : ''
  const popoverSuggestions = useMemo(
    () =>
      popoverCk
        ? characterPartSuggestions(popoverCk, {
            familyHint: familyHints[popoverCk],
            includeMain: !mainLocked,
          })
        : [],
    [popoverCk, familyHints, mainLocked]
  )
  const popoverWarnings = useMemo(() => {
    if (!popoverCk || !popoverValue.trim()) return []
    return parseRotation(`${popoverName} ${popoverValue}`, [
      { characterKey: popoverCk, name: popoverName },
    ]).warnings
  }, [popoverCk, popoverName, popoverValue])

  return (
    <>
      <ModalWrapper
        open
        onClose={busy ? () => {} : onClose}
        containerProps={{ maxWidth: 'md' }}
      >
        <CardThemed
          sx={{
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '88vh',
          }}
        >
          {/* Header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: { xs: 2, sm: 2.5 },
              minHeight: 56,
              borderBottom: hairline,
              flexShrink: 0,
            }}
          >
            <Typography
              sx={{
                ...type.title,
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                flex: 1,
                minWidth: 0,
              }}
            >
              {t('page_team:teamOpt.versions.combosTitle', 'Combinations')}
              <InfoTooltipInline
                title={t(
                  'page_team:teamOpt.versions.combosTip',
                  'Pick up to 8 characters to generate team combinations at once. Lock core members to keep them in every team, and click an added character’s action pill to adjust its rotation step across all teams.'
                )}
              />
            </Typography>
            <IconButton
              size="small"
              disabled={busy}
              onClick={onClose}
              aria-label={t('page_team:teamOpt.versions.cancel', 'Cancel')}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* Body */}
          <Box
            sx={{
              p: { xs: 2, sm: 2.5 },
              overflowY: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 2.25,
            }}
          >
            {/* Step 1: Character pool */}
            <Box>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  mb: 1.25,
                }}
              >
                <Typography sx={{ ...type.title, fontSize: 14 }}>
                  {t('page_team:teamOpt.versions.poolTitle', 'Characters')}
                </Typography>
                <Typography sx={{ ...type.label, ...numSx }}>
                  {pool.length} / {MAX_COMBO_POOL}
                </Typography>
                {(pool.length > teamSize ||
                  Object.keys(cons).length > 0 ||
                  Object.keys(sig).length > 0) && (
                  <Button
                    size="small"
                    color="inherit"
                    disabled={busy}
                    onClick={() => {
                      setPool([...rootMembers])
                      setLocked(mainDps && teamSize >= 2 ? [mainDps] : [])
                      setCons({})
                      setSig({})
                      setDeselected(new Set())
                      setComboEdits({})
                      setExpandedKey(undefined)
                      setPartPopover(undefined)
                      setConsMenu(undefined)
                      setSigMenu(undefined)
                    }}
                    sx={{
                      ml: 'auto',
                      minHeight: 24,
                      py: 0,
                      px: 0.75,
                      fontSize: 12,
                      color: 'text.secondary',
                    }}
                  >
                    {t('page_team:teamOpt.versions.resetPool', 'Reset')}
                  </Button>
                )}
              </Box>

              {/* Unified character pool pills (lock + inline action pill on added characters) */}
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 0.875,
                }}
              >
                {pool.map((ck) => {
                  const isLocked = locked.includes(ck)
                  const isRoot = rootMembers.includes(ck)
                  const canLock =
                    isLocked || locked.length < Math.max(1, teamSize - 1)
                  const part = !isRoot ? (effectiveParts[ck] ?? '') : undefined
                  const partHasWarn =
                    !isRoot &&
                    !!part?.trim() &&
                    parseRotation(`${charName(ck)} ${part}`, [
                      { characterKey: ck, name: charName(ck) },
                    ]).warnings.length > 0
                  const popoverOpen = partPopover?.ck === ck
                  return (
                    <Box
                      key={ck}
                      sx={(theme) => ({
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        height: 38,
                        pl: 0.625,
                        pr: 0.5,
                        borderRadius: tokens.radius.inset,
                        border: hairline,
                        bgcolor: tokens.inset,
                        ...quickSx,
                        ...(isLocked && selectedSx(theme)),
                        '& .pool-remove': {
                          opacity: { xs: 0.7, sm: 0.35 },
                          transition: 'opacity 120ms ease, color 120ms ease',
                        },
                        '&:hover .pool-remove, &:focus-within .pool-remove': {
                          opacity: 1,
                        },
                      })}
                    >
                      <MemberAvatar characterKey={ck} size={26} />
                      <Typography
                        noWrap
                        sx={{
                          fontSize: 13.5,
                          fontWeight: isLocked || !isRoot ? 600 : 500,
                          color: 'text.primary',
                          pl: 0.25,
                          maxWidth: 130,
                        }}
                      >
                        {charName(ck)}
                      </Typography>

                      {/* Compact constellation pill (gold when overridden from family default) */}
                      <Tooltip
                        arrow
                        title={t('page_team:teamOpt.versions.consOf', {
                          defaultValue: 'Constellation of {{name}}',
                          name: charName(ck),
                        })}
                      >
                        <ButtonBase
                          disabled={busy}
                          onClick={(e) =>
                            setConsMenu({ ck, anchor: e.currentTarget })
                          }
                          aria-label={t('page_team:teamOpt.versions.consOf', {
                            defaultValue: 'Constellation of {{name}}',
                            name: charName(ck),
                          })}
                          aria-haspopup="menu"
                          sx={{
                            ...focusSx,
                            ...quickSx,
                            ...numSx,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.125,
                            height: 24,
                            pl: 0.75,
                            pr: 0.375,
                            ml: 0.125,
                            borderRadius: tokens.radius.pill,
                            border: `1px solid ${
                              ck in cons || consMenu?.ck === ck
                                ? alpha(giTokens.gold, 0.5)
                                : tokens.hairlineStrong
                            }`,
                            bgcolor:
                              ck in cons || consMenu?.ck === ck
                                ? alpha(giTokens.gold, 0.12)
                                : alpha(giTokens.parchment, 0.04),
                            color:
                              ck in cons || consMenu?.ck === ck
                                ? giTokens.goldLight
                                : 'text.secondary',
                            fontSize: 11.5,
                            fontWeight: 700,
                            '&:hover': {
                              borderColor: alpha(giTokens.gold, 0.6),
                              color:
                                ck in cons
                                  ? giTokens.goldLight
                                  : 'text.primary',
                            },
                          }}
                        >
                          <span>C{consOf(ck)}</span>
                          <KeyboardArrowDownRoundedIcon
                            sx={{ fontSize: 13, opacity: 0.75 }}
                          />
                        </ButtonBase>
                      </Tooltip>

                      {/* Signature weapon pill (Any / No sig / R1–R5) */}
                      {signatureWeapons[ck] &&
                        (() => {
                          const sigKey = signatureWeapons[ck]!
                          const sigIcon = weaponAsset(sigKey as never, true)
                          const sigVal = sig[ck]
                          const ownSig = sigVal !== undefined
                          const sigLabel =
                            sigVal === undefined
                              ? t('page_team:teamOpt.versions.sigAny', 'Any')
                              : sigVal === 0
                                ? t(
                                    'page_team:teamOpt.versions.sigNone',
                                    'No sig'
                                  )
                                : `R${sigVal}`
                          return (
                            <Tooltip
                              arrow
                              title={`${t(`weaponNames_gen:${sigKey}`)} — ${sigLabel}`}
                            >
                              <ButtonBase
                                disabled={busy}
                                onClick={(e) =>
                                  setSigMenu({ ck, anchor: e.currentTarget })
                                }
                                aria-label={t(
                                  'page_team:teamOpt.versions.sigOf',
                                  {
                                    defaultValue:
                                      'Signature weapon of {{name}}',
                                    name: charName(ck),
                                  }
                                )}
                                aria-haspopup="menu"
                                sx={{
                                  ...focusSx,
                                  ...quickSx,
                                  ...numSx,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 0.35,
                                  height: 24,
                                  pl: 0.5,
                                  pr: 0.375,
                                  borderRadius: tokens.radius.pill,
                                  border: `1px solid ${
                                    ownSig || sigMenu?.ck === ck
                                      ? alpha(giTokens.gold, 0.5)
                                      : tokens.hairlineStrong
                                  }`,
                                  bgcolor:
                                    ownSig || sigMenu?.ck === ck
                                      ? alpha(giTokens.gold, 0.12)
                                      : alpha(giTokens.parchment, 0.04),
                                  color:
                                    ownSig || sigMenu?.ck === ck
                                      ? giTokens.goldLight
                                      : 'text.secondary',
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  '&:hover': {
                                    borderColor: alpha(giTokens.gold, 0.6),
                                    color: ownSig
                                      ? giTokens.goldLight
                                      : 'text.primary',
                                  },
                                }}
                              >
                                {sigIcon && (
                                  <Box
                                    component="img"
                                    src={sigIcon}
                                    alt=""
                                    sx={{
                                      width: 15,
                                      height: 15,
                                      objectFit: 'contain',
                                      ...(sigVal === 0 && {
                                        filter: 'grayscale(1)',
                                        opacity: 0.45,
                                      }),
                                    }}
                                  />
                                )}
                                <span>{sigLabel}</span>
                                <KeyboardArrowDownRoundedIcon
                                  sx={{ fontSize: 13, opacity: 0.75 }}
                                />
                              </ButtonBase>
                            </Tooltip>
                          )
                        })()}

                      {/* Inline action button on added characters — opens crisp popover */}
                      {!isRoot && (
                        <Tooltip
                          arrow
                          title={t(
                            'page_team:teamOpt.versions.editCharAction',
                            'Auto-filled rotation step — click to change'
                          )}
                        >
                          <ButtonBase
                            disabled={busy}
                            onClick={(e) =>
                              setPartPopover({
                                ck,
                                anchor: e.currentTarget,
                              })
                            }
                            sx={{
                              ...focusSx,
                              ...quickSx,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 0.25,
                              height: 24,
                              pl: 0.875,
                              pr: 0.5,
                              ml: 0.25,
                              borderRadius: tokens.radius.pill,
                              border: `1px solid ${
                                partHasWarn
                                  ? alpha('#ffb74d', 0.55)
                                  : popoverOpen || userEditedParts.has(ck)
                                    ? alpha(giTokens.gold, 0.5)
                                    : tokens.hairlineStrong
                              }`,
                              bgcolor:
                                popoverOpen || userEditedParts.has(ck)
                                  ? alpha(giTokens.gold, 0.12)
                                  : alpha(giTokens.parchment, 0.04),
                              color: partHasWarn
                                ? 'warning.main'
                                : popoverOpen || userEditedParts.has(ck)
                                  ? giTokens.goldLight
                                  : 'text.secondary',
                              fontFamily: mono,
                              fontSize: 11.5,
                              fontWeight: 600,
                              maxWidth: 110,
                              '&:hover': {
                                borderColor: alpha(giTokens.gold, 0.6),
                                color: 'text.primary',
                              },
                            }}
                          >
                            <Box
                              component="span"
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {part?.trim() || 'E Q'}
                            </Box>
                            <KeyboardArrowDownRoundedIcon
                              sx={{
                                fontSize: 14,
                                opacity: 0.75,
                                flexShrink: 0,
                              }}
                            />
                          </ButtonBase>
                        </Tooltip>
                      )}

                      <Tooltip
                        arrow
                        title={
                          isLocked
                            ? t(
                                'page_team:teamOpt.versions.unlockChar',
                                'Locked in every team — click to unlock'
                              )
                            : canLock
                              ? t(
                                  'page_team:teamOpt.versions.lockChar',
                                  'Flex — click to keep in every team'
                                )
                              : t(
                                  'page_team:teamOpt.versions.lockMax',
                                  'Leave at least one flex slot'
                                )
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            disabled={busy || (!isLocked && !canLock)}
                            onClick={() => toggleLock(ck)}
                            aria-label={
                              isLocked
                                ? t(
                                    'page_team:teamOpt.versions.unlockCharShort',
                                    'Unlock {{name}}',
                                    { name: charName(ck) }
                                  )
                                : t(
                                    'page_team:teamOpt.versions.lockCharShort',
                                    'Lock {{name}}',
                                    { name: charName(ck) }
                                  )
                            }
                            sx={{
                              p: 0.35,
                              color: isLocked
                                ? giTokens.goldLight
                                : 'text.disabled',
                              '&:hover': {
                                color: isLocked
                                  ? giTokens.gold
                                  : 'text.primary',
                              },
                            }}
                          >
                            {isLocked ? (
                              <LockRoundedIcon sx={{ fontSize: 14 }} />
                            ) : (
                              <LockOpenRoundedIcon sx={{ fontSize: 14 }} />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>

                      {pool.length > 1 && (
                        <IconButton
                          className="pool-remove"
                          size="small"
                          disabled={busy}
                          onClick={() => removeCharacter(ck)}
                          aria-label={t(
                            'page_team:teamOpt.versions.removeChar',
                            'Remove {{name}}',
                            { name: charName(ck) }
                          )}
                          sx={{
                            p: 0.35,
                            color: 'text.secondary',
                            '&:hover': { color: 'text.primary' },
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      )}
                    </Box>
                  )
                })}
              </Box>

              {/* Search + 1-click teammate suggestions */}
              {canAddMore && (
                <Box
                  sx={{
                    mt: 1.25,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Autocomplete
                      size="small"
                      disabled={busy}
                      options={autocompleteOptions}
                      value={null}
                      inputValue={searchInput}
                      onInputChange={(_, value, reason) => {
                        if (reason !== 'reset') setSearchInput(value)
                      }}
                      onChange={(_, option) => {
                        if (option) addCharacter(option.key)
                      }}
                      getOptionLabel={(o) => o.label}
                      isOptionEqualToValue={(a, b) => a.key === b.key}
                      blurOnSelect={false}
                      clearOnBlur={false}
                      noOptionsText={t(
                        'page_team:teamOpt.versions.noCharFound',
                        'No matching character'
                      )}
                      renderOption={(props, option) => {
                        const { key: _k, ...rest } = props
                        return (
                          <Box
                            component="li"
                            key={option.key}
                            {...rest}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1,
                              py: '5px !important',
                            }}
                          >
                            <MemberAvatar characterKey={option.key} size={24} />
                            <Typography
                              sx={(theme) => ({
                                fontSize: 13.5,
                                fontWeight: 550,
                                color:
                                  theme.palette[getCharEle(option.key)]?.main ??
                                  'text.primary',
                              })}
                            >
                              {option.label}
                            </Typography>
                          </Box>
                        )
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          placeholder={t(
                            'page_team:teamOpt.versions.addPoolPlaceholder',
                            'Add character by name...'
                          )}
                          InputProps={{
                            ...params.InputProps,
                            startAdornment: (
                              <InputAdornment position="start">
                                <SearchIcon
                                  sx={{ fontSize: 18, color: 'text.disabled' }}
                                />
                              </InputAdornment>
                            ),
                          }}
                          sx={{
                            '& .MuiInputBase-root': {
                              height: 36,
                              fontSize: 13.5,
                            },
                          }}
                        />
                      )}
                      sx={{ flex: 1, minWidth: 0 }}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      color="inherit"
                      disabled={busy}
                      startIcon={<AddIcon />}
                      onClick={() => setPicking(true)}
                      sx={{
                        height: 36,
                        px: 1.5,
                        flexShrink: 0,
                        borderColor: tokens.hairlineStrong,
                        textTransform: 'none',
                        fontWeight: 600,
                      }}
                    >
                      {t('page_team:teamOpt.versions.browseChars', 'Browse')}
                    </Button>
                  </Box>

                  {suggestedAdditions.length > 0 && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 0.625,
                      }}
                    >
                      <Typography
                        sx={{ ...type.label, fontSize: 12, mr: 0.25 }}
                      >
                        {t(
                          'page_team:teamOpt.versions.quickAddLabel',
                          'Common teammates'
                        )}
                      </Typography>
                      {suggestedAdditions.map((ck) => (
                        <ButtonBase
                          key={ck}
                          disabled={busy}
                          onClick={() => addCharacter(ck)}
                          sx={{
                            ...focusSx,
                            ...quickSx,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.5,
                            height: 26,
                            pl: 0.375,
                            pr: 0.875,
                            borderRadius: tokens.radius.pill,
                            border: hairline,
                            bgcolor: 'transparent',
                            color: 'text.secondary',
                            fontSize: 12,
                            fontWeight: 550,
                            '&:hover': {
                              borderColor: tokens.hairlineStrong,
                              bgcolor: alpha(giTokens.parchment, 0.05),
                              color: 'text.primary',
                            },
                          }}
                        >
                          <MemberAvatar characterKey={ck} size={18} />
                          <span>{charName(ck)}</span>
                          <AddIcon sx={{ fontSize: 13, opacity: 0.65 }} />
                        </ButtonBase>
                      ))}
                    </Box>
                  )}
                </Box>
              )}
            </Box>

            {/* Step 2: Generated combinations preview */}
            <Box>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1,
                  mb: 1,
                }}
              >
                <Typography sx={{ ...type.title, fontSize: 14 }}>
                  {t('page_team:teamOpt.versions.previewTitle', {
                    defaultValue: 'New versions ({{selected}} of {{total}})',
                    selected: selectedCombos.length,
                    total: newCombos.length,
                  })}
                </Typography>
                {existingCount > 0 && (
                  <Typography sx={{ ...type.label, ...numSx }}>
                    {t('page_team:teamOpt.versions.alreadyExist', {
                      defaultValue: '{{count}} already exist',
                      count: existingCount,
                    })}
                  </Typography>
                )}
                {newCombos.length > 0 && (
                  <Box
                    sx={{
                      ml: 'auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                    }}
                  >
                    <Tooltip
                      arrow
                      title={
                        showRotations
                          ? t(
                              'page_team:teamOpt.versions.hideRotations',
                              'Hide rotation previews'
                            )
                          : t(
                              'page_team:teamOpt.versions.showRotations',
                              'Show rotation previews'
                            )
                      }
                    >
                      <IconButton
                        size="small"
                        aria-pressed={showRotations}
                        onClick={() => setShowRotations((v) => !v)}
                        sx={{
                          width: 28,
                          height: 28,
                          border: hairline,
                          borderRadius: tokens.radius.control,
                          ...(showRotations
                            ? {
                                color: giTokens.goldLight,
                                borderColor: alpha(giTokens.gold, 0.5),
                                bgcolor: alpha(giTokens.gold, 0.12),
                              }
                            : { color: 'text.secondary' }),
                        }}
                      >
                        <SubjectRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                    {newCombos.length > 1 && (
                      <>
                        <Button
                          size="small"
                          color="inherit"
                          disabled={
                            busy || selectedCombos.length === newCombos.length
                          }
                          onClick={() => setDeselected(new Set())}
                          sx={{
                            minHeight: 24,
                            minWidth: 0,
                            px: 0.75,
                            fontSize: 12,
                            color: 'text.secondary',
                          }}
                        >
                          {t('page_team:teamOpt.versions.selectAll', 'All')}
                        </Button>
                        <Button
                          size="small"
                          color="inherit"
                          disabled={busy || selectedCombos.length === 0}
                          onClick={() =>
                            setDeselected(
                              new Set(newCombos.map((c) => c.setKey))
                            )
                          }
                          sx={{
                            minHeight: 24,
                            minWidth: 0,
                            px: 0.75,
                            fontSize: 12,
                            color: 'text.secondary',
                          }}
                        >
                          {t('page_team:teamOpt.versions.selectNone', 'None')}
                        </Button>
                      </>
                    )}
                  </Box>
                )}
              </Box>

              {newCombos.length === 0 ? (
                <Box sx={{ ...insetSx, px: 2, py: 2.25 }}>
                  <Typography sx={type.label}>
                    {pool.length < teamSize
                      ? t(
                          'page_team:teamOpt.versions.needMoreChars',
                          'Add characters so the pool has at least {{count}} members.',
                          { count: teamSize }
                        )
                      : t(
                          'page_team:teamOpt.versions.addMoreToCombine',
                          'Add a character above to preview combinations.'
                        )}
                  </Typography>
                </Box>
              ) : (
                <Box
                  sx={{
                    ...insetSx,
                    maxHeight: 350,
                    overflowY: 'auto',
                  }}
                >
                  {newCombos.map((item) => {
                    const checked = !deselected.has(item.setKey)
                    const rot = rotationOfCombo(item)
                    const auto = item.auto!
                    const isExpanded = expandedKey === item.setKey
                    const edit = comboEdits[item.setKey]
                    const comboNames = memberNamesOf(
                      item.members.map((characterKey) => ({ characterKey })),
                      i18n,
                      gender
                    )
                    const added = item.members.filter(
                      (k) => !rootMembers.includes(k)
                    )
                    const labelWithCons = (k: CharacterKey) => {
                      const c =
                        item.cons[k] ?? kqmMemberConstellation(k, rootKqm)
                      const r = item.sig[k]
                      return `${charName(k)} C${c}${r !== undefined ? (r ? ` · R${r}` : ' · no sig') : ''}`
                    }
                    return (
                      <Box
                        key={item.setKey}
                        sx={{
                          '& + &': { borderTop: hairline },
                          opacity: checked ? 1 : 0.45,
                          ...rowHoverSx,
                          '& .combo-actions': {
                            opacity: isExpanded ? 1 : { xs: 1, sm: 0.45 },
                            transition: 'opacity 140ms ease',
                          },
                          '&:hover .combo-actions, &:focus-within .combo-actions':
                            { opacity: 1 },
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.25,
                            px: 1.25,
                            py: 1,
                          }}
                        >
                          <Checkbox
                            size="small"
                            disabled={busy}
                            checked={checked}
                            onChange={() => toggleCombo(item.setKey)}
                            sx={{ p: 0.5 }}
                          />
                          <ButtonBase
                            disabled={busy}
                            onClick={() =>
                              setExpandedKey((now) =>
                                now === item.setKey ? undefined : item.setKey
                              )
                            }
                            sx={{
                              ...focusSx,
                              flex: 1,
                              minWidth: 0,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1.5,
                              textAlign: 'left',
                              borderRadius: 1,
                              py: 0.25,
                            }}
                          >
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.625,
                                flexShrink: 0,
                              }}
                            >
                              {item.members.map((k) => {
                                const swapped =
                                  !rootMembers.includes(k) ||
                                  k in item.cons ||
                                  k in item.sig
                                const effCons =
                                  item.cons[k] ??
                                  kqmMemberConstellation(k, rootKqm)
                                return (
                                  <Tooltip
                                    key={k}
                                    arrow
                                    title={labelWithCons(k)}
                                  >
                                    <Box sx={{ lineHeight: 0 }}>
                                      <VersionPortrait
                                        characterKey={k}
                                        size={36}
                                        constellation={effCons}
                                        ownConstellation={k in item.cons}
                                        signature={item.sig[k]}
                                        highlighted={swapped}
                                      />
                                    </Box>
                                  </Tooltip>
                                )
                              })}
                            </Box>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography
                                noWrap
                                sx={{
                                  fontSize: 13.5,
                                  lineHeight: 1.35,
                                  minWidth: 0,
                                }}
                              >
                                {item.members.map((k, idx) => {
                                  const changed =
                                    !rootMembers.includes(k) ||
                                    k in item.cons ||
                                    k in item.sig
                                  return (
                                    <Box key={k} component="span">
                                      {idx > 0 && (
                                        <Box
                                          component="span"
                                          sx={{
                                            color: 'text.disabled',
                                            mx: 0.5,
                                          }}
                                        >
                                          ·
                                        </Box>
                                      )}
                                      <Box
                                        component="span"
                                        sx={{
                                          fontWeight: changed ? 650 : 500,
                                          color: changed
                                            ? 'text.primary'
                                            : 'text.secondary',
                                        }}
                                      >
                                        {charName(k)}
                                      </Box>
                                    </Box>
                                  )
                                })}
                              </Typography>
                              {added.length === 0 &&
                                (Object.keys(item.cons).length > 0 ||
                                  Object.keys(item.sig).length > 0) && (
                                  <Typography
                                    noWrap
                                    sx={{ ...type.label, fontSize: 11.5 }}
                                  >
                                    {t(
                                      'page_team:teamOpt.versions.sameMembers',
                                      'Same team'
                                    )}
                                  </Typography>
                                )}
                            </Box>
                            {rot.badge === 'template' && (
                              <Box
                                component="span"
                                sx={{
                                  ...type.label,
                                  fontSize: 11,
                                  px: 0.75,
                                  py: '1px',
                                  borderRadius: tokens.radius.pill,
                                  color: giTokens.goldLight,
                                  border: `1px solid ${alpha(giTokens.gold, 0.4)}`,
                                  bgcolor: alpha(giTokens.gold, 0.08),
                                  flexShrink: 0,
                                }}
                              >
                                {t(
                                  'page_team:teamOpt.versions.badgeTemplate',
                                  'Template'
                                )}
                              </Box>
                            )}
                            {rot.badge === 'edited' && (
                              <Box
                                component="span"
                                sx={{
                                  ...type.label,
                                  fontSize: 11,
                                  px: 0.75,
                                  py: '1px',
                                  borderRadius: tokens.radius.pill,
                                  border: hairline,
                                  color: giTokens.goldLight,
                                  flexShrink: 0,
                                }}
                              >
                                {t(
                                  'page_team:teamOpt.versions.badgeEdited',
                                  'Edited'
                                )}
                              </Box>
                            )}
                          </ButtonBase>

                          <Box
                            className="combo-actions"
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.25,
                              flexShrink: 0,
                            }}
                          >
                            {edit && (
                              <Tooltip
                                arrow
                                title={t(
                                  'page_team:teamOpt.versions.resetRotation',
                                  'Undo edits'
                                )}
                              >
                                <IconButton
                                  size="small"
                                  disabled={busy}
                                  onClick={() =>
                                    setComboEdits((prev) => {
                                      const next = { ...prev }
                                      delete next[item.setKey]
                                      return next
                                    })
                                  }
                                  sx={{ color: 'text.disabled' }}
                                >
                                  <ReplayRoundedIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>
                            )}
                            <Tooltip
                              arrow
                              title={t(
                                'page_team:teamOpt.versions.editRotation',
                                'Edit its rotation'
                              )}
                            >
                              <IconButton
                                size="small"
                                disabled={busy}
                                onClick={() =>
                                  setExpandedKey((now) =>
                                    now === item.setKey
                                      ? undefined
                                      : item.setKey
                                  )
                                }
                                sx={{
                                  color: isExpanded
                                    ? 'primary.main'
                                    : 'text.disabled',
                                }}
                              >
                                <EditOutlinedIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>

                        {showRotations && !isExpanded && rot.text.trim() && (
                          <Box
                            sx={{
                              pl: 5.5,
                              pr: 1.5,
                              pb: 1,
                              mt: -0.25,
                              '& span': { fontSize: '12px !important' },
                            }}
                          >
                            <RotationReadout
                              text={rot.text}
                              opener={rot.opener}
                              counted={false}
                              names={comboNames}
                            />
                          </Box>
                        )}

                        <Collapse in={isExpanded} timeout={180} unmountOnExit>
                          <Box
                            sx={{
                              px: 1.5,
                              pb: 1.5,
                              pt: 1,
                              borderTop: hairline,
                            }}
                          >
                            {auto.exactTemplates.length > 0 && (
                              <Box
                                sx={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 0.5,
                                  mb: 1,
                                }}
                              >
                                {auto.swapped.text.trim() && (
                                  <Chip
                                    size="small"
                                    label={t(
                                      'page_team:teamOpt.versions.fromTeam',
                                      'This team’s'
                                    )}
                                    variant={
                                      rot.badge === 'swapped'
                                        ? 'filled'
                                        : 'outlined'
                                    }
                                    color={
                                      rot.badge === 'swapped'
                                        ? 'primary'
                                        : 'default'
                                    }
                                    onClick={() =>
                                      setComboEdits((prev) => ({
                                        ...prev,
                                        [item.setKey]: {
                                          text: auto.swapped.text,
                                          opener: auto.swapped.opener,
                                          forceSwapped: true,
                                        },
                                      }))
                                    }
                                  />
                                )}
                                {auto.exactTemplates.map((tm) => {
                                  const kindLabel = t(
                                    `page_team:teamOpt.templates.kind.${tm.kind}`,
                                    rotationTemplateKinds[tm.kind]
                                  )
                                  const active =
                                    edit?.templateId === tm.id ||
                                    (!edit && auto.template?.id === tm.id)
                                  return (
                                    <Tooltip
                                      key={tm.id}
                                      arrow
                                      title={tm.source.name}
                                    >
                                      <Chip
                                        size="small"
                                        label={t(
                                          'page_team:teamOpt.versions.template',
                                          {
                                            defaultValue: 'Template: {{kind}}',
                                            kind: kindLabel,
                                          }
                                        )}
                                        variant={active ? 'filled' : 'outlined'}
                                        color={active ? 'primary' : 'default'}
                                        onClick={() =>
                                          setComboEdits((prev) => ({
                                            ...prev,
                                            [item.setKey]: {
                                              text: templateText(
                                                tm.text,
                                                comboNames
                                              ),
                                              opener: tm.opener
                                                ? templateText(
                                                    tm.opener,
                                                    comboNames
                                                  )
                                                : '',
                                              templateId: tm.id,
                                            },
                                          }))
                                        }
                                      />
                                    </Tooltip>
                                  )
                                })}
                              </Box>
                            )}
                            <RotationFields
                              names={comboNames}
                              value={{ text: rot.text, opener: rot.opener }}
                              disabled={busy}
                              onChange={(next) =>
                                setComboEdits((prev) => ({
                                  ...prev,
                                  [item.setKey]: {
                                    text: next.text,
                                    opener: next.opener,
                                  },
                                }))
                              }
                            />
                          </Box>
                        </Collapse>
                      </Box>
                    )
                  })}
                </Box>
              )}
            </Box>
          </Box>

          {/* Progress bar when creating a batch */}
          {creating && (
            <LinearProgress
              variant="determinate"
              value={(creating.done / Math.max(1, creating.total)) * 100}
              sx={{
                height: 2,
                bgcolor: 'transparent',
                '& .MuiLinearProgress-bar': { bgcolor: giTokens.gold },
              }}
            />
          )}

          {/* Footer */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1,
              px: { xs: 2, sm: 2.5 },
              py: 1.25,
              borderTop: hairline,
              flexShrink: 0,
            }}
          >
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  disabled={busy}
                  checked={showInTeams}
                  onChange={(_, checked) => setShowInTeams(checked)}
                />
              }
              label={t(
                'page_team:teamOpt.versions.showInTeamsOption',
                'Also show in Teams tab'
              )}
              sx={{
                mr: 'auto',
                ml: -0.5,
                '& .MuiFormControlLabel-label': { ...type.label },
              }}
            />
            <Button color="inherit" onClick={onClose} disabled={busy}>
              {t('page_team:teamOpt.versions.cancel', 'Cancel')}
            </Button>
            <Button
              variant="contained"
              disabled={!selectedCombos.length || busy}
              endIcon={
                busy ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <ArrowForwardIcon />
                )
              }
              sx={giCtaSx}
              onClick={handleCreate}
            >
              {creating
                ? t('page_team:teamOpt.versions.creatingBatch', {
                    defaultValue: 'Creating {{done}} / {{total}}',
                    done: creating.done,
                    total: creating.total,
                  })
                : t('page_team:teamOpt.versions.createBatch', {
                    defaultValue: 'Create and run {{count}}',
                    count: selectedCombos.length,
                  })}
            </Button>
          </Box>
        </CardThemed>
      </ModalWrapper>

      {/* Shared compact constellation menu (C0–C6) for pool characters */}
      <Menu
        anchorEl={consMenu?.anchor}
        open={!!consMenu}
        onClose={() => setConsMenu(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { minWidth: 112 } } }}
      >
        {consMenu &&
          [0, 1, 2, 3, 4, 5, 6].map((n) => {
            const def = kqmMemberConstellation(consMenu.ck, rootKqm)
            const selected = consOf(consMenu.ck) === n
            return (
              <MenuItem
                key={n}
                dense
                selected={selected}
                onClick={() => {
                  setConsOf(consMenu.ck, n)
                  setConsMenu(undefined)
                }}
                sx={{ gap: 1, fontSize: 13, fontWeight: 600, ...numSx }}
              >
                <span>C{n}</span>
                {n === def && (
                  <Box
                    component="span"
                    sx={{ ...type.label, fontSize: 11, ml: 'auto' }}
                  >
                    {t('page_team:teamOpt.versions.defaultShort', 'default')}
                  </Box>
                )}
              </MenuItem>
            )
          })}
      </Menu>

      {/* Shared signature weapon menu (Any / No sig / R1–R5) for pool characters */}
      <Menu
        anchorEl={sigMenu?.anchor}
        open={!!sigMenu}
        onClose={() => setSigMenu(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { minWidth: 160 } } }}
      >
        {sigMenu &&
          signatureWeapons[sigMenu.ck] &&
          (() => {
            const sigKey = signatureWeapons[sigMenu.ck]!
            const sigIcon = weaponAsset(sigKey as never, true)
            const cur = sig[sigMenu.ck]
            const options: {
              value: number | undefined
              label: string
              dim?: boolean
            }[] = [
              {
                value: undefined,
                label: t('page_team:teamOpt.versions.sigAny', 'Any'),
              },
              {
                value: 0,
                label: t('page_team:teamOpt.versions.sigNone', 'No sig'),
                dim: true,
              },
              ...[1, 2, 3, 4, 5].map((r) => ({ value: r, label: `R${r}` })),
            ]
            return [
              <Box
                key="heading"
                sx={{
                  px: 2,
                  pt: 0.5,
                  pb: 1,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'text.secondary',
                }}
              >
                {t(`weaponNames_gen:${sigKey}`)}
              </Box>,
              ...options.map((o) => (
                <MenuItem
                  key={String(o.value ?? 'any')}
                  dense
                  selected={cur === o.value}
                  onClick={() => {
                    setSigOf(sigMenu.ck, o.value)
                    setSigMenu(undefined)
                  }}
                  sx={{ gap: 1, fontSize: 13, fontWeight: 600, ...numSx }}
                >
                  {sigIcon && (
                    <Box
                      component="img"
                      src={sigIcon}
                      alt=""
                      sx={{
                        width: 18,
                        height: 18,
                        objectFit: 'contain',
                        ...(o.dim && { filter: 'grayscale(1)', opacity: 0.45 }),
                      }}
                    />
                  )}
                  <span>{o.label}</span>
                </MenuItem>
              )),
            ]
          })()}
      </Menu>

      {/* Crisp popover for tuning an added character's rotation step */}
      <Popover
        open={!!partPopover}
        anchorEl={partPopover?.anchor}
        onClose={() => setPartPopover(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75,
              p: 1.5,
              width: 280,
              bgcolor: tokens.raised,
              border: hairline,
              backgroundImage: 'none',
            },
          },
        }}
      >
        {popoverCk && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <MemberAvatar characterKey={popoverCk} size={22} />
              <Typography
                sx={(theme) => ({
                  fontSize: 13.5,
                  fontWeight: 650,
                  color: laneColor(theme, popoverCk),
                  flex: 1,
                })}
              >
                {popoverName}
              </Typography>
              <Typography sx={{ ...type.label, fontSize: 11.5 }}>
                {t('page_team:teamOpt.versions.rotationStep', 'Action step')}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {popoverSuggestions.map((sug) => {
                const active = popoverValue.trim() === sug
                return (
                  <Chip
                    key={sug}
                    size="small"
                    label={sug}
                    variant={active ? 'filled' : 'outlined'}
                    color={active ? 'primary' : 'default'}
                    onClick={() => {
                      setPartFor(popoverCk, sug)
                      setPartPopover(undefined)
                    }}
                    sx={{
                      height: 26,
                      fontFamily: mono,
                      fontSize: 12,
                      fontWeight: active ? 650 : 500,
                    }}
                  />
                )
              })}
            </Box>
            <TextField
              size="small"
              fullWidth
              value={popoverValue}
              placeholder="E Q"
              onChange={(e) => setPartFor(popoverCk, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setPartPopover(undefined)
              }}
              inputProps={{
                'aria-label': t(
                  'page_team:teamOpt.versions.actionsOf',
                  'Rotation actions for {{name}}',
                  { name: popoverName }
                ),
                spellCheck: false,
              }}
              sx={{
                '& .MuiInputBase-input': {
                  fontFamily: mono,
                  fontSize: 12.5,
                  py: 0.75,
                },
              }}
            />
            {popoverWarnings.length > 0 && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  color: 'warning.main',
                }}
              >
                <WarningAmberRoundedIcon sx={{ fontSize: 15, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 11.5, color: 'inherit' }}>
                  {popoverWarnings[0]}
                </Typography>
              </Box>
            )}
          </Box>
        )}
      </Popover>

      <Suspense fallback={false}>
        <CharacterSingleSelectionModal
          show={picking}
          onHide={() => setPicking(false)}
          onSelect={(ck) => {
            setPicking(false)
            addCharacter(ck)
          }}
          teamKeys={pool}
        />
      </Suspense>
    </>
  )
}
