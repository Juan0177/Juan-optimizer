import { imgAssets } from '@genshin-optimizer/gi/assets'
import {
  type CharacterKey,
  signatureWeapons,
  type WeaponKey,
} from '@genshin-optimizer/gi/consts'
import type { TeamOptKqm } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharWeaponType, getWeaponStat } from '@genshin-optimizer/gi/stats'
import { StatIcon } from '@genshin-optimizer/gi/svgicons'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  KQM_ONE_COPY,
  kqmExcludedWeapons,
  kqmLockedWeapon,
  kqmWeaponData,
  kqmWeapons,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import SearchIcon from '@mui/icons-material/Search'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  IconButton,
  InputAdornment,
  Popover,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { mainStatLabel } from './format'
import { MemberAvatar } from './MemberAvatar'
import { WeaponThumb } from './TeamOptResults'
import { focusSx, hairline, numSx, quickSx, Segmented, tokens } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/** A weapon's substat in a word, as players write it (the rest: its name) */
const SHORT_STAT: Partial<Record<string, string>> = {
  critRate_: 'CR',
  critDMG_: 'CD',
  eleMas: 'EM',
  enerRech_: 'ER',
  atk_: 'ATK%',
  hp_: 'HP%',
  def_: 'DEF%',
  physical_dmg_: 'Phys%',
}

/**
 * Lock a member to a weapon, or to none (`undefined`: Any). A signature refinement
 * (`TeamOptKqm.signature`, a team variant's "R1") locks first, so this choice replaces it; the
 * signature weapon chosen here keeps that refinement.
 */
export function lockWeapon(
  settings: TeamOptKqm,
  characterKey: CharacterKey,
  key: WeaponKey | undefined
) {
  const next = { ...settings.lockedWeapons }
  if (key) next[characterKey] = key
  else delete next[characterKey]
  settings.lockedWeapons = Object.keys(next).length ? next : undefined
  const sigRefinement = settings.signature?.[characterKey]
  if (!sigRefinement) return
  const signature = { ...settings.signature }
  delete signature[characterKey]
  settings.signature = Object.keys(signature).length ? signature : undefined
  if (key && key === signatureWeapons[characterKey])
    settings.refinements = { ...settings.refinements, [key]: sigRefinement }
}
/** The locked weapon's refinement: the signature refinement when that is what locks it */
export function setLockedRefinement(
  settings: TeamOptKqm,
  characterKey: CharacterKey,
  key: WeaponKey,
  refinement: number
) {
  if (
    settings.signature?.[characterKey] &&
    key === signatureWeapons[characterKey]
  )
    settings.signature = { ...settings.signature, [characterKey]: refinement }
  else settings.refinements = { ...settings.refinements, [key]: refinement }
}

/** The one-copy weapons locked for members other than `characterKey`, with who has them */
function lockedElsewhere(
  characterKey: CharacterKey,
  members: readonly TeamOptMember[],
  kqm: TeamOptKqm
) {
  return new Map(
    members.flatMap(({ characterKey: k }) => {
      const key = k !== characterKey && kqmLockedWeapon(k, kqm)?.key
      return key && KQM_ONE_COPY.includes(key) ? [[key, k] as const] : []
    })
  )
}

/**
 * A member's weapon in the KQM Weapons window: Any (the search chooses from the ticked ones) or one
 * weapon its builds always use, at that weapon's refinement. `compact`: a lock button beside the
 * member's name (Setup), the locked weapon's picture once locked
 */
export function KqmWeaponLock({
  characterKey,
  members,
  kqm,
  setTeamOpt,
  compact = false,
}: {
  characterKey: CharacterKey
  members: readonly TeamOptMember[]
  kqm: TeamOptKqm
  setTeamOpt: (update: TeamOptUpdate) => void
  compact?: boolean
}) {
  const { t } = useTranslation(['page_team', 'weaponNames_gen'])
  const { gender } = useDBMeta()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [search, setSearch] = useState('')
  const query = useDeferredValue(search).trim().toLocaleLowerCase()
  const locked = kqmLockedWeapon(characterKey, kqm)
  const weapons = useMemo(
    () => kqmWeapons(characterKey, kqm, { all: true }),
    [characterKey, kqm]
  )
  const excluded = useMemo(() => kqmExcludedWeapons(kqm), [kqm])
  const taken = useMemo(
    () => lockedElsewhere(characterKey, members, kqm),
    [characterKey, members, kqm]
  )
  const shown = query
    ? weapons.filter((w) =>
        `${t(`weaponNames_gen:${w.key}`, w.key)} ${w.key}`
          .toLocaleLowerCase()
          .includes(query)
      )
    : weapons
  // (a weapon stays open for its refinement, below; Any, or the weapon already locked, closes)
  const lock = (key: WeaponKey | undefined) => {
    if (key && key === locked?.key) return setAnchor(null)
    setTeamOpt((o) => {
      lockWeapon((o.kqm ??= { ...defaultTeamOptKqm }), characterKey, key)
    })
    if (!key) setAnchor(null)
  }
  const setRefinement = (key: WeaponKey, refinement: number) =>
    setTeamOpt((o) => {
      setLockedRefinement(
        (o.kqm ??= { ...defaultTeamOptKqm }),
        characterKey,
        key,
        refinement
      )
    })
  const close = () => setAnchor(null)
  const weaponType = getCharWeaponType(characterKey)
  // the list: the signature weapon first, then by rarity (each option's place for the arrow keys;
  // Any is the first while nothing is searched)
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  // (where the arrow keys are, for the search it was moved in: a new search starts at its first
  // match)
  const [cursor, setCursor] = useState({ query: '', index: -1 })
  const signature = signatureWeapons[characterKey]
  const { groups, options } = useMemo(() => {
    const byGroup = new Map<string, (typeof shown)[number][]>()
    for (const w of shown) {
      const group =
        w.key === signature
          ? 'signature'
          : `${getWeaponStat(w.key)?.rarity ?? 0}`
      byGroup.set(group, [...(byGroup.get(group) ?? []), w])
    }
    const order = [
      'signature',
      ...[...byGroup.keys()]
        .filter((g) => g !== 'signature')
        .sort((a, b) => Number(b) - Number(a)),
    ].filter((g) => byGroup.has(g))
    let index = query ? 0 : 1
    const groups = order.map((g) => ({
      key: g,
      label:
        g === 'signature'
          ? t('teamOpt.kqm.weaponGroupSignature', 'Signature')
          : `${g}★`,
      // (the ticked ones first: those the search would try)
      items: byGroup
        .get(g)!
        .map((weapon, i) => ({ weapon, i }))
        .sort(
          (a, b) =>
            Number(excluded.has(a.weapon.key)) -
              Number(excluded.has(b.weapon.key)) || a.i - b.i
        )
        .map(({ weapon }) => ({ weapon, index: index++ })),
    }))
    const options: { key?: WeaponKey; disabled: boolean }[] = [
      ...(query ? [] : [{ disabled: false }]),
      ...groups.flatMap((g) =>
        g.items.map(({ weapon }) => ({
          key: weapon.key,
          disabled: taken.has(weapon.key),
        }))
      ),
    ]
    return { groups, options }
  }, [shown, signature, query, taken, excluded, t])
  const active =
    cursor.query === query
      ? cursor.index
      : query
        ? options.findIndex((o) => !o.disabled)
        : -1
  const setActive = (index: number) => setCursor({ query, index })
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView?.({ block: 'nearest' })
  }, [active, listId])
  const onSearchKey = (e: KeyboardEvent) => {
    if (!options.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      let i = active < 0 ? (step > 0 ? -1 : 0) : active
      for (let n = 0; n < options.length; n++) {
        i = (i + step + options.length) % options.length
        if (!options[i].disabled) break
      }
      setActive(i)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = options[active >= 0 ? active : 0]
      if (option && !option.disabled) lock(option.key)
    }
  }
  const anyLabel = t('teamOpt.kqm.weaponAny', 'Any')
  const lockedName =
    locked &&
    `${t(`weaponNames_gen:${locked.key}`, locked.key)} R${locked.refinement}`
  const triggerProps = {
    onClick: (e: { currentTarget: HTMLElement }) => {
      // (each opening starts afresh, even one before the last closing ended)
      setSearch('')
      setCursor({ query: '', index: -1 })
      setAnchor(e.currentTarget)
    },
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': !!anchor,
    'aria-label': t('teamOpt.kqm.weaponLockLabel', {
      defaultValue: '{{character}} weapon: {{weapon}}',
      character: characterKey,
      weapon: lockedName || anyLabel,
    }),
  }
  const trigger = compact ? (
    <Tooltip
      arrow
      title={
        lockedName
          ? t('teamOpt.kqm.weaponLockedTip', {
              defaultValue: 'Weapon locked: {{weapon}}',
              weapon: lockedName,
            })
          : t(
              'teamOpt.kqm.weaponLockTip',
              'Lock a weapon (now Any: the search chooses)'
            )
      }
    >
      <ButtonBase
        {...triggerProps}
        sx={(theme) => ({
          ...focusSx,
          position: 'relative',
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: 1.5,
          color: 'text.disabled',
          '&:hover': {
            color: 'text.primary',
            bgcolor: locked
              ? undefined
              : alpha(theme.palette.text.primary, 0.08),
          },
        })}
      >
        {locked ? (
          <>
            <WeaponThumb
              weapon={kqmWeaponData(locked, characterKey)}
              highlight
              size={28}
            />
            <Box
              component="span"
              sx={(theme) => ({
                position: 'absolute',
                right: -3,
                bottom: -3,
                width: 15,
                height: 15,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: theme.palette.primary.main,
                color: theme.palette.primary.contrastText,
                boxShadow: `0 0 0 2px ${tokens.raised}`,
              })}
            >
              <LockOutlinedIcon sx={{ fontSize: 10 }} />
            </Box>
          </>
        ) : (
          <LockOpenOutlinedIcon sx={{ fontSize: 18 }} />
        )}
      </ButtonBase>
    </Tooltip>
  ) : (
    <ButtonBase
      {...triggerProps}
      sx={(theme) => ({
        ...quickSx,
        ...focusSx,
        width: '100%',
        minWidth: 0,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        pl: locked ? 0.5 : 1.25,
        pr: 0.25,
        borderRadius: 1,
        border: `1px solid ${
          locked
            ? alpha(theme.palette.primary.main, 0.6)
            : alpha(theme.palette.text.primary, 0.23)
        }`,
        textAlign: 'left',
        fontSize: 14,
        '&:hover': {
          borderColor: locked
            ? theme.palette.primary.main
            : theme.palette.text.primary,
        },
      })}
    >
      {locked ? (
        <>
          <WeaponThumb
            weapon={kqmWeaponData(locked, characterKey)}
            highlight={false}
            size={26}
          />
          <Box
            component="span"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'primary.main',
            }}
          >
            <WeaponName weaponKey={locked.key} />
          </Box>
          <Box
            component="span"
            sx={{ ...numSx, color: 'text.secondary', fontSize: 13 }}
          >
            R{locked.refinement}
          </Box>
        </>
      ) : (
        <Box
          component="span"
          sx={{ flex: 1, minWidth: 0, color: 'text.secondary' }}
        >
          {anyLabel}
        </Box>
      )}
      <ArrowDropDownIcon sx={{ color: 'text.secondary' }} />
    </ButtonBase>
  )
  return (
    <>
      {trigger}
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transitionDuration={{ enter: 120, exit: 80 }}
        TransitionProps={{
          onEntered: (node) =>
            node
              .querySelector('[role="option"][aria-selected="true"]')
              ?.scrollIntoView?.({ block: 'center' }),
        }}
        PaperProps={{
          role: 'dialog',
          'aria-label': t('teamOpt.kqm.weaponLockTitle', {
            defaultValue: 'Weapon for {{character}}',
            character: characterKey,
          }),
          sx: {
            width: 320,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'min(440px, calc(100vh - 32px))',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: tokens.raised,
            backgroundImage: 'none',
            border: hairline,
            borderRadius: 2,
            overflow: 'hidden',
          },
        }}
      >
        {/* whose weapon, the search, close: one row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1,
            py: 0.75,
            borderBottom: hairline,
          }}
        >
          <MemberAvatar characterKey={characterKey} size={24} />
          <TextField
            size="small"
            fullWidth
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={t('teamOpt.kqm.weaponSearchCount', {
              defaultValue: 'Search {{count}} weapons',
              count: weapons.length,
            })}
            inputProps={{
              'aria-label': t('teamOpt.kqm.weaponSearch', 'Search weapons'),
              'aria-controls': listId,
              'aria-activedescendant':
                active >= 0 ? `${listId}-${active}` : undefined,
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start" sx={{ mr: 0.5 }}>
                  <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiInputBase-root': {
                fontSize: 13,
                borderRadius: 1.25,
                bgcolor: tokens.inset,
                pl: 1,
              },
              '& .MuiInputBase-input': { py: 0.625 },
              '& fieldset': { borderColor: 'transparent' },
            }}
          />
          <IconButton
            size="small"
            onClick={close}
            aria-label={t('teamOpt.kqm.weaponLockClose', 'Close')}
            sx={{ color: 'text.secondary', p: 0.5 }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        <Box
          id={listId}
          role="listbox"
          ref={listRef}
          sx={{ overflowY: 'auto', flex: 1, minHeight: 0, px: 0.5, py: 0.5 }}
        >
          {!query && (
            <LockOption
              id={`${listId}-0`}
              active={active === 0}
              onHover={() => setActive(0)}
              selected={!locked}
              onClick={() => lock(undefined)}
              icon={
                <Box
                  sx={(theme) => ({
                    width: 26,
                    height: 26,
                    flexShrink: 0,
                    borderRadius: 1.5,
                    display: 'grid',
                    placeItems: 'center',
                    border: `1.5px dashed ${
                      locked
                        ? alpha(theme.palette.text.primary, 0.25)
                        : alpha(theme.palette.primary.main, 0.7)
                    }`,
                  })}
                >
                  <Box
                    component="img"
                    src={imgAssets.weaponTypes?.[weaponType]}
                    alt=""
                    sx={{ width: 16, height: 16, opacity: locked ? 0.5 : 0.85 }}
                  />
                </Box>
              }
              title={t('teamOpt.kqm.weaponAnyTitle', 'Any weapon')}
            />
          )}
          {groups.map((group) => (
            <Box key={group.key} role="group" aria-label={group.label}>
              <Box
                sx={{
                  position: 'sticky',
                  top: -4,
                  zIndex: 1,
                  px: 1,
                  pt: 0.75,
                  pb: 0.25,
                  bgcolor: tokens.raised,
                  fontSize: 10.5,
                  fontWeight: 650,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'text.disabled',
                  ...numSx,
                }}
              >
                {group.label} · {group.items.length}
              </Box>
              {group.items.map(({ weapon: w, index }) => {
                const holder = taken.get(w.key)
                const unticked = !holder && excluded.has(w.key)
                const sub = getWeaponStat(w.key)?.subStat?.type
                return (
                  <LockOption
                    key={w.key}
                    id={`${listId}-${index}`}
                    active={active === index}
                    onHover={() => setActive(index)}
                    selected={locked?.key === w.key}
                    disabled={!!holder}
                    dim={unticked}
                    hint={
                      unticked
                        ? t('teamOpt.kqm.weaponNotTicked', 'Not ticked')
                        : undefined
                    }
                    onClick={() => lock(w.key)}
                    icon={
                      <WeaponThumb
                        weapon={kqmWeaponData(w, characterKey)}
                        highlight={false}
                        size={26}
                      />
                    }
                    title={<WeaponName weaponKey={w.key} />}
                    meta={
                      holder ? (
                        <>
                          {t('teamOpt.kqm.weaponLockedFor', 'Locked for')}{' '}
                          <CharacterName
                            characterKey={holder}
                            gender={gender}
                          />
                        </>
                      ) : sub ? (
                        t(`teamOpt.kqm.statShort.${sub}`, {
                          defaultValue: SHORT_STAT[sub] ?? mainStatLabel(sub),
                        })
                      ) : undefined
                    }
                    metaIcon={
                      !holder && sub ? <StatIcon statKey={sub} /> : undefined
                    }
                  />
                )
              })}
            </Box>
          ))}
          {!groups.length && (
            <Typography
              sx={{
                px: 1,
                py: 2,
                fontSize: 12.5,
                color: 'text.secondary',
                textAlign: 'center',
              }}
            >
              {t('teamOpt.kqm.weaponNoMatchFor', {
                defaultValue: 'No weapon matches “{{query}}”',
                query: search.trim(),
              })}
            </Typography>
          )}
        </Box>
        {/* the locked one's refinement */}
        {locked && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.25,
              py: 0.625,
              borderTop: hairline,
              bgcolor: tokens.inset,
            }}
          >
            <Segmented
              size="small"
              value={locked.refinement}
              aria-label={t('teamOpt.kqm.refinement', 'Refinement')}
              options={[1, 2, 3, 4, 5].map((r) => ({
                value: r,
                label: `R${r}`,
              }))}
              onChange={(r) => setRefinement(locked.key, r)}
            />
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={close}
              sx={{
                ...giCtaSx,
                ml: 'auto',
                minWidth: 0,
                px: 1.25,
                py: 0.375,
                fontSize: 12.5,
                fontWeight: 650,
                boxShadow: 'none',
              }}
            >
              {t('teamOpt.kqm.weaponLockDone', 'Done')}
            </Button>
          </Box>
        )}
      </Popover>
    </>
  )
}

function LockOption({
  id,
  active,
  onHover,
  selected,
  disabled,
  dim,
  hint,
  onClick,
  icon,
  title,
  meta,
  metaIcon,
}: {
  id: string
  /** Where the arrow keys are */
  active: boolean
  onHover: () => void
  selected: boolean
  disabled?: boolean
  /** Not ticked: shown fainter (`hint` says why) */
  dim?: boolean
  hint?: string
  onClick: () => void
  icon?: ReactNode
  title: ReactNode
  meta?: ReactNode
  metaIcon?: ReactNode
}) {
  return (
    <ButtonBase
      id={id}
      role="option"
      aria-selected={selected}
      aria-description={hint}
      title={hint}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onHover}
      tabIndex={-1}
      disableRipple
      sx={(theme) => ({
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 0.75,
        py: 0.5,
        borderRadius: 1.25,
        textAlign: 'left',
        opacity: disabled ? 0.4 : 1,
        bgcolor: active ? alpha(theme.palette.text.primary, 0.07) : undefined,
        // (the choice: a lighter row)
        ...(selected && {
          bgcolor: alpha(theme.palette.text.primary, 0.08),
        }),
      })}
    >
      <Box sx={{ display: 'flex', opacity: dim ? 0.55 : 1 }}>{icon}</Box>
      <Typography
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          fontWeight: selected ? 650 : 450,
          color: selected
            ? 'primary.main'
            : dim
              ? 'text.secondary'
              : 'text.primary',
        }}
        noWrap
      >
        {title}
      </Typography>
      {meta && (
        <Box
          component="span"
          sx={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.375,
            maxWidth: '42%',
            fontSize: 11.5,
            color: 'text.disabled',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            '& svg': { fontSize: 12, flexShrink: 0 },
          }}
        >
          {metaIcon}
          {meta}
        </Box>
      )}
      {selected && (
        <CheckIcon
          sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }}
        />
      )}
    </ButtonBase>
  )
}
