import {
  type CharacterKey,
  signatureWeapons,
  type WeaponKey,
} from '@genshin-optimizer/gi/consts'
import type { TeamOptKqm } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
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
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import {
  alpha,
  Box,
  ButtonBase,
  Popover,
  TextField,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WeaponThumb } from './TeamOptResults'
import {
  FieldLabel,
  focusSx,
  hairline,
  numSx,
  quickSx,
  Segmented,
  selectedSx,
  tokens,
  type,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

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
 * weapon its builds always use, at that weapon's refinement
 */
export function KqmWeaponLock({
  characterKey,
  members,
  kqm,
  setTeamOpt,
}: {
  characterKey: CharacterKey
  members: readonly TeamOptMember[]
  kqm: TeamOptKqm
  setTeamOpt: (update: TeamOptUpdate) => void
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
  const lock = (key: WeaponKey | undefined) => {
    setTeamOpt((o) => {
      lockWeapon((o.kqm ??= { ...defaultTeamOptKqm }), characterKey, key)
    })
    setAnchor(null)
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
  const anyLabel = t('teamOpt.kqm.weaponAny', 'Any')
  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        aria-label={t('teamOpt.kqm.weaponLockLabel', {
          defaultValue: '{{character}} weapon: {{weapon}}',
          character: characterKey,
          weapon: locked
            ? `${t(`weaponNames_gen:${locked.key}`, locked.key)} R${locked.refinement}`
            : anyLabel,
        })}
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
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        TransitionProps={{
          onEntered: (node) =>
            node
              .querySelector('[role="option"][aria-selected="true"]')
              ?.scrollIntoView?.({ block: 'nearest' }),
          onExited: () => setSearch(''),
        }}
        PaperProps={{
          role: 'dialog',
          'aria-label': t('teamOpt.kqm.weaponLockTitle', {
            defaultValue: 'Weapon for {{character}}',
            character: characterKey,
          }),
          sx: {
            width: 340,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 480,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: tokens.raised,
            backgroundImage: 'none',
            border: hairline,
          },
        }}
      >
        <Box sx={{ p: 1.25, pb: 1, borderBottom: hairline }}>
          <Typography sx={{ ...type.title, mb: 0.25 }}>
            <CharacterName characterKey={characterKey} gender={gender} />
          </Typography>
          <Typography sx={{ ...type.label, fontWeight: 400, mb: 1 }}>
            {t(
              'teamOpt.kqm.weaponLockHelp',
              'Lock one and every build of this member uses it, even if it is not ticked. The others are optimized around it.'
            )}
          </Typography>
          <TextField
            size="small"
            fullWidth
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('teamOpt.kqm.weaponSearch', 'Search weapons')}
            inputProps={{
              'aria-label': t('teamOpt.kqm.weaponSearch', 'Search weapons'),
            }}
          />
        </Box>
        <Box role="listbox" sx={{ overflowY: 'auto', flex: 1, py: 0.5 }}>
          {!query && (
            <LockOption
              selected={!locked}
              onClick={() => lock(undefined)}
              title={anyLabel}
              detail={t(
                'teamOpt.kqm.weaponAnyHelp',
                'The search chooses from the ticked weapons'
              )}
            />
          )}
          {shown.map((w) => {
            const holder = taken.get(w.key)
            return (
              <LockOption
                key={w.key}
                selected={locked?.key === w.key}
                disabled={!!holder}
                onClick={() => lock(w.key)}
                icon={
                  <WeaponThumb
                    weapon={kqmWeaponData(w, characterKey)}
                    highlight={false}
                    size={30}
                  />
                }
                title={<WeaponName weaponKey={w.key} />}
                detail={
                  holder ? (
                    <>
                      {t('teamOpt.kqm.weaponLockedFor', 'Locked for')}{' '}
                      <CharacterName characterKey={holder} gender={gender} />
                    </>
                  ) : excluded.has(w.key) ? (
                    t('teamOpt.kqm.weaponNotTicked', 'Not ticked')
                  ) : undefined
                }
              />
            )
          })}
          {!shown.length && (
            <Typography sx={{ ...type.label, fontWeight: 400, px: 1.5, py: 1 }}>
              {t('teamOpt.kqm.weaponNoMatch', 'No weapon matches')}
            </Typography>
          )}
        </Box>
        {locked && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.25,
              py: 1,
              borderTop: hairline,
            }}
          >
            <LockOutlinedIcon sx={{ fontSize: 16, color: 'primary.main' }} />
            <Box sx={{ flex: 1 }}>
              <FieldLabel
                tip={t(
                  'teamOpt.kqm.refinementLockTip',
                  'This weapon’s refinement for the whole team, the same as on its card.'
                )}
              >
                {t('teamOpt.kqm.refinement', 'Refinement')}
              </FieldLabel>
            </Box>
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
          </Box>
        )}
      </Popover>
    </>
  )
}

function LockOption({
  selected,
  disabled,
  onClick,
  icon,
  title,
  detail,
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  icon?: ReactNode
  title: ReactNode
  detail?: ReactNode
}) {
  return (
    <ButtonBase
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={onClick}
      sx={(theme) => ({
        ...quickSx,
        ...focusSx,
        width: 'calc(100% - 8px)',
        mx: 0.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.625,
        minHeight: 40,
        borderRadius: 1,
        textAlign: 'left',
        opacity: disabled ? 0.5 : 1,
        '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.05) },
        ...(selected && selectedSx(theme)),
      })}
    >
      {icon}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14 }} noWrap>
          {title}
        </Typography>
        {detail && (
          <Typography sx={{ ...type.label, fontWeight: 400 }} noWrap>
            {detail}
          </Typography>
        )}
      </Box>
      {selected && <CheckIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
    </ButtonBase>
  )
}
