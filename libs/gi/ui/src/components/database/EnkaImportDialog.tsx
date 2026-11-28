import { SandboxStorage } from '@genshin-optimizer/common/database'
import type {
  ArtifactSetKey,
  CharacterKey,
  GenderKey,
} from '@genshin-optimizer/gi/consts'
import { charKeyToLocCharKey } from '@genshin-optimizer/gi/consts'
import type { ImportResult } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import {
  DatabaseContext,
  useDatabase,
  useDBMeta,
} from '@genshin-optimizer/gi/db-ui'
import type {
  EnkaImport,
  EnkaShowcase,
  ICharacter,
  IWeapon,
} from '@genshin-optimizer/gi/good'
import { enkaToGood } from '@genshin-optimizer/gi/good'
import { getCharEle, getCharStat } from '@genshin-optimizer/gi/stats'
import { ElementIcon } from '@genshin-optimizer/gi/svgicons'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Link,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { FormEvent } from 'react'
import { useContext, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { iconAsset } from '../../util'
import { CharacterName } from '../character/Trans'
import {
  darkChip,
  memberCardSx,
  rarityBg,
  SetThumb,
  strip,
  tileRadius,
  WeaponThumb,
} from '../team/itemTile'

/** The stellar-enka Worker (tools/enka-worker); on a local page, its `wrangler dev` */
const ENKA_URL = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(
  globalThis.location?.host ?? ''
)
  ? 'http://127.0.0.1:8788/enka/'
  : 'https://stellaroptimizer.com/api/enka/'
const UID_KEY = 'GOEnkaUid'
const UID = /^[1-9]\d{8,9}$/

type Stage =
  | { step: 'form'; error?: string }
  | { step: 'loading' }
  | { step: 'preview'; showcase: EnkaShowcase; data: EnkaImport }
  | { step: 'importing'; showcase: EnkaShowcase; data: EnkaImport }
  | { step: 'done'; result: ImportResult }
type Status = 'new' | 'update' | 'same'

const readUid = () => {
  try {
    return localStorage.getItem(UID_KEY) ?? ''
  } catch {
    return ''
  }
}
const saveUid = (uid: string) => {
  try {
    localStorage.setItem(UID_KEY, uid)
  } catch {
    // (a private window: the UID is just not remembered)
  }
}

export default function EnkaImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('ui')
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const database = useDatabase()
  const { setDatabase } = useContext(DatabaseContext)
  const navigate = useNavigate()
  const [uid, setUid] = useState(readUid)
  const [stage, setStage] = useState<Stage>({ step: 'form' })
  const [selected, setSelected] = useState<Set<CharacterKey>>(new Set())
  const [withGear, setWithGear] = useState(true)

  const fetchShowcase = async (e?: FormEvent) => {
    e?.preventDefault()
    const value = uid.trim()
    if (!UID.test(value)) {
      setStage({ step: 'form', error: 'wrong_uid' })
      return
    }
    setStage({ step: 'loading' })
    try {
      const response = await fetch(`${ENKA_URL}${value}`)
      const body = (await response.json().catch(() => ({}))) as EnkaShowcase & {
        error?: string
      }
      if (!response.ok) {
        setStage({ step: 'form', error: body.error ?? 'upstream_fail' })
        return
      }
      saveUid(value)
      const data = enkaToGood(body)
      if (!data.characters.length) {
        setStage({
          step: 'form',
          error: body.avatarInfoList?.length ? 'unknown' : 'empty',
        })
        return
      }
      setSelected(new Set(data.characters))
      setStage({ step: 'preview', showcase: body, data })
    } catch {
      setStage({ step: 'form', error: 'upstream_fail' })
    }
  }

  const runImport = () => {
    if (stage.step !== 'preview') return
    const { data } = stage
    setStage({ ...stage, step: 'importing' })
    // (a moment to show it is working: the import is one synchronous step)
    setTimeout(() => {
      const locations = new Set<string>(
        [...selected].map((k) => charKeyToLocCharKey(k))
      )
      const worn = <T extends { location: string }>(list?: T[]) =>
        withGear ? list?.filter((x) => locations.has(x.location)) : undefined
      const good = {
        ...data.good,
        characters: data.good.characters?.filter((c) => selected.has(c.key)),
        weapons: worn(data.good.weapons),
        artifacts: worn(data.good.artifacts),
      }
      const storage = new SandboxStorage()
      storage.copyFrom(database.storage)
      const imported = new ArtCharDatabase(database.dbIndex, storage)
      // (merged: what is not in the showcase stays, and pieces already there are matched)
      const result = imported.importGOOD(
        good as Parameters<ArtCharDatabase['importGOOD']>[0],
        true,
        true,
        false
      )
      if (data.gender && [...selected].some((k) => k.startsWith('Traveler')))
        imported.dbMeta.set({ gender: data.gender })
      imported.swapStorage(database)
      setDatabase(database.dbIndex - 1, imported)
      imported.toExtraLocalDB()
      setStage({ step: 'done', result })
    }, 30)
  }

  const busy = stage.step === 'loading' || stage.step === 'importing'
  const preview =
    stage.step === 'preview' || stage.step === 'importing' ? stage : undefined

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth="md"
      fullWidth
      fullScreen={phone}
      aria-labelledby="enka-import-title"
    >
      <DialogTitle
        id="enka-import-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5 }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography component="span" variant="h6" sx={{ fontWeight: 650 }}>
            {t('enka.title', 'Import from Enka.Network')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {t(
              'enka.subtitle',
              'Your in-game Character Showcase: level, constellation and talents, with the weapon and artifacts each character wears.'
            )}
          </Typography>
        </Box>
        <IconButton
          aria-label={t('enka.close', 'Close')}
          onClick={onClose}
          disabled={busy}
          sx={{ alignSelf: 'flex-start' }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        {(stage.step === 'form' || stage.step === 'loading') && (
          <UidForm
            uid={uid}
            setUid={setUid}
            loading={stage.step === 'loading'}
            error={stage.step === 'form' ? stage.error : undefined}
            onSubmit={fetchShowcase}
          />
        )}
        {preview && (
          <Preview
            showcase={preview.showcase}
            data={preview.data}
            selected={selected}
            setSelected={setSelected}
            withGear={withGear}
            setWithGear={setWithGear}
            onChangeUid={() => setStage({ step: 'form' })}
            disabled={stage.step === 'importing'}
          />
        )}
        {stage.step === 'done' && <Done result={stage.result} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1 }}>
        {stage.step === 'done' ? (
          <>
            <Button variant="text" color="inherit" onClick={onClose}>
              {t('enka.close', 'Close')}
            </Button>
            <Button
              sx={giCtaSx}
              onClick={() => {
                onClose()
                navigate('/characters')
              }}
            >
              {t('enka.viewCharacters', 'View characters')}
            </Button>
          </>
        ) : preview ? (
          <>
            <Button
              variant="text"
              color="inherit"
              onClick={onClose}
              disabled={busy}
            >
              {t('enka.cancel', 'Cancel')}
            </Button>
            <Button
              sx={giCtaSx}
              disabled={!selected.size || busy}
              onClick={runImport}
              startIcon={
                stage.step === 'importing' ? (
                  <CircularProgress size={16} color="inherit" />
                ) : undefined
              }
            >
              {selected.size === 1
                ? t('enka.importOne', 'Import 1 character')
                : t('enka.import', {
                    defaultValue: 'Import {{count}} characters',
                    count: selected.size,
                  })}
            </Button>
          </>
        ) : (
          <Button variant="text" color="inherit" onClick={onClose}>
            {t('enka.cancel', 'Cancel')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

function UidForm({
  uid,
  setUid,
  loading,
  error,
  onSubmit,
}: {
  uid: string
  setUid: (uid: string) => void
  loading: boolean
  error?: string
  onSubmit: (e: FormEvent) => void
}) {
  const { t } = useTranslation('ui')
  const errors: Record<string, string> = {
    wrong_uid: t(
      'enka.error.wrongUid',
      'A UID has 9 or 10 digits. You can find yours at the bottom right of the game screen.'
    ),
    not_found: t('enka.error.notFound', 'No player has this UID.'),
    profile_unavailable: t(
      'enka.error.unavailable',
      'The game is not sharing this profile right now. Try again later.'
    ),
    maintenance: t(
      'enka.error.maintenance',
      'Genshin Impact is under maintenance. Try again once it is over.'
    ),
    busy: t(
      'enka.error.busy',
      'Too many requests right now. Try again in a minute.'
    ),
    empty: t(
      'enka.error.empty',
      'This profile shows no characters. Add characters to your Character Showcase and turn on Show Character Details, then try again in a few minutes.'
    ),
    unknown: t(
      'enka.error.unknown',
      'The characters on this showcase are not in Stellar Optimizer yet.'
    ),
    upstream_fail: t(
      'enka.error.fail',
      'Enka.Network could not be reached. Try again in a moment.'
    ),
  }
  return (
    <>
      <Box
        component="form"
        onSubmit={onSubmit}
        sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}
      >
        <TextField
          autoFocus
          label={t('enka.uid', 'UID')}
          value={uid}
          onChange={(e) => setUid(e.target.value.replace(/\D/g, ''))}
          inputProps={{ inputMode: 'numeric', maxLength: 10 }}
          disabled={loading}
          size="small"
          sx={{ flexGrow: 1, maxWidth: 260 }}
        />
        <Button
          type="submit"
          sx={{ ...giCtaSx, height: 40 }}
          disabled={loading || !uid}
          startIcon={
            loading ? <CircularProgress size={16} color="inherit" /> : undefined
          }
        >
          {loading ? t('enka.fetching', 'Fetching…') : t('enka.fetch', 'Fetch')}
        </Button>
      </Box>
      {error && (
        <Alert severity="warning" sx={{ alignItems: 'center' }}>
          {errors[error] ?? errors['upstream_fail']}
        </Alert>
      )}
      <Box
        component="ol"
        sx={{
          m: 0,
          pl: 2.5,
          display: 'grid',
          gap: 0.5,
          color: 'text.secondary',
          fontSize: '0.875rem',
        }}
      >
        <li>
          {t(
            'enka.howto.open',
            'In the game, open the Paimon menu, then your profile, then Edit Profile.'
          )}
        </li>
        <li>
          {t(
            'enka.howto.showcase',
            'Put the characters you want in the Character Showcase, and turn on Show Character Details.'
          )}
        </li>
        <li>
          {t(
            'enka.howto.uid',
            'Enter your UID here. A change in the game can take a few minutes to show.'
          )}
        </li>
      </Box>
      <Typography variant="caption" color="text.secondary">
        <Trans
          t={t}
          i18nKey="enka.note"
          defaults="Data comes from <enka>Enka.Network</enka>. Only what your showcase characters wear is imported: for your whole inventory, use a <scanner>scanner</scanner>."
          components={{
            enka: (
              <Link
                href="https://enka.network/"
                target="_blank"
                rel="noreferrer"
              />
            ),
            scanner: <Link component={RouterLink} to="/scanner" />,
          }}
        />
      </Typography>
    </>
  )
}

function Preview({
  showcase,
  data,
  selected,
  setSelected,
  withGear,
  setWithGear,
  onChangeUid,
  disabled,
}: {
  showcase: EnkaShowcase
  data: EnkaImport
  selected: Set<CharacterKey>
  setSelected: (s: Set<CharacterKey>) => void
  withGear: boolean
  setWithGear: (on: boolean) => void
  onChangeUid: () => void
  disabled: boolean
}) {
  const { t } = useTranslation('ui')
  const database = useDatabase()
  const { gender: dbGender } = useDBMeta()
  const gender = data.gender ?? dbGender
  const { nickname, level } = showcase.playerInfo ?? {}
  const rows = useMemo(
    () =>
      (data.good.characters ?? []).map((character) => {
        const location = charKeyToLocCharKey(character.key)
        const weapon = data.good.weapons?.find((w) => w.location === location)
        const setNum: Partial<Record<ArtifactSetKey, number>> = {}
        for (const a of data.good.artifacts ?? [])
          if (a.location === location)
            setNum[a.setKey] = (setNum[a.setKey] ?? 0) + 1
        const sets = (
          Object.entries(setNum) as [ArtifactSetKey, number][]
        ).flatMap(([set, n]): [ArtifactSetKey, 2 | 4][] =>
          n >= 2 ? [[set, n >= 4 ? 4 : 2]] : []
        )
        const existing = database.chars.get(character.key)
        const status: Status = !existing
          ? 'new'
          : existing.level === character.level &&
              existing.ascension === character.ascension &&
              existing.constellation === character.constellation &&
              existing.talent.auto === character.talent.auto &&
              existing.talent.skill === character.talent.skill &&
              existing.talent.burst === character.talent.burst
            ? 'same'
            : 'update'
        return { character, weapon, sets, status }
      }),
    [data, database]
  )
  const all = selected.size === rows.length
  const skippedChars = data.skipped.filter((s) => s.item === 'character').length
  const artifacts = data.good.artifacts?.length ?? 0

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Typography sx={{ fontWeight: 600 }}>{nickname || '—'}</Typography>
        <Typography color="text.secondary" variant="body2">
          {[
            level &&
              t('enka.ar', { defaultValue: 'AR {{level}}', level: level }),
            t('enka.uidValue', {
              defaultValue: 'UID {{uid}}',
              uid: showcase.uid,
            }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
        <Button
          size="small"
          variant="text"
          color="inherit"
          onClick={onChangeUid}
          disabled={disabled}
        >
          {t('enka.changeUid', 'Change UID')}
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          variant="text"
          color="inherit"
          disabled={disabled}
          onClick={() =>
            setSelected(
              new Set(all ? [] : rows.map(({ character }) => character.key))
            )
          }
        >
          {all
            ? t('enka.selectNone', 'Select none')
            : t('enka.selectAll', 'Select all')}
        </Button>
      </Box>
      <Box
        role="group"
        aria-label={t('enka.characters', 'Characters to import')}
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))',
          gap: 1.25,
        }}
      >
        {rows.map(({ character, weapon, sets, status }) => (
          <ShowcaseTile
            key={character.key}
            character={character}
            weapon={withGear ? weapon : undefined}
            sets={withGear ? sets : []}
            status={status}
            gender={gender}
            selected={selected.has(character.key)}
            disabled={disabled}
            onToggle={() => {
              const next = new Set(selected)
              if (next.has(character.key)) next.delete(character.key)
              else next.add(character.key)
              setSelected(next)
            }}
          />
        ))}
      </Box>
      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={withGear}
              onChange={(e) => setWithGear(e.target.checked)}
              disabled={disabled}
            />
          }
          label={t('enka.withGear', {
            defaultValue: 'Their weapons and artifacts too ({{count}})',
            count: (data.good.weapons?.length ?? 0) + artifacts,
          })}
        />
        <Typography variant="body2" color="text.secondary" sx={{ pl: 6 }}>
          {withGear
            ? t(
                'enka.withGearOn',
                'Each character is equipped with what it wears in the game. Pieces you already have are matched, not added twice.'
              )
            : t(
                'enka.withGearOff',
                'Only level, constellation and talents. Your equipped gear stays as it is.'
              )}
        </Typography>
      </Box>
      {skippedChars > 0 && (
        <Alert severity="info">
          {t('enka.skipped', {
            defaultValue:
              'Some characters on this showcase are not in Stellar Optimizer yet ({{count}}).',
            count: skippedChars,
          })}
        </Alert>
      )}
    </>
  )
}

function ShowcaseTile({
  character,
  weapon,
  sets,
  status,
  gender,
  selected,
  disabled,
  onToggle,
}: {
  character: ICharacter
  weapon?: IWeapon
  sets: [ArtifactSetKey, 2 | 4][]
  status: Status
  gender: GenderKey
  selected: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation('ui')
  const { key, level, constellation, talent } = character
  const element = getCharEle(key)
  const rarity = getCharStat(key).rarity
  const statusLabel = {
    new: t('enka.status.new', 'New'),
    update: t('enka.status.update', 'Update'),
    same: t('enka.status.same', 'Up to date'),
  }[status]
  return (
    <ButtonBase
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onToggle}
      sx={(theme) => ({
        ...memberCardSx(theme.palette[element].main),
        position: 'relative',
        opacity: selected ? 1 : 0.5,
        filter: selected ? 'none' : 'saturate(0.4)',
        ...(selected && {
          borderColor: theme.palette[element].main,
        }),
      })}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: 2,
          right: 2,
          zIndex: 1,
          width: 22,
          height: 22,
          display: 'grid',
          placeItems: 'center',
          borderRadius: '50%',
          bgcolor: selected ? giTokens.gold : giTokens.inkDeep,
          color: giTokens.inkDeep,
          boxShadow: `0 0 0 2px ${giTokens.panelRaised}`,
          border: selected ? 'none' : `1.5px solid ${giTokens.hairlineStrong}`,
        }}
      >
        {selected && <CheckRoundedIcon sx={{ fontSize: 16 }} />}
      </Box>
      <Box
        sx={{
          position: 'relative',
          borderRadius: tileRadius,
          overflow: 'hidden',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            aspectRatio: '1 / 1',
            background: rarityBg[rarity] ?? rarityBg[4],
          }}
        >
          <Box
            component="img"
            loading="lazy"
            alt=""
            src={iconAsset(key, gender)}
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              objectPosition: 'bottom',
            }}
          />
          <Box
            aria-hidden
            sx={(theme) => ({
              position: 'absolute',
              top: 6,
              left: 6,
              width: 24,
              height: 24,
              display: 'grid',
              placeItems: 'center',
              borderRadius: '50%',
              bgcolor: darkChip,
              color: theme.palette[element].main,
              fontSize: 16,
            })}
          >
            <ElementIcon ele={element} iconProps={{ fontSize: 'inherit' }} />
          </Box>
          <Box
            sx={{
              position: 'absolute',
              bottom: 6,
              right: 6,
              px: 0.75,
              borderRadius: '10px',
              bgcolor: darkChip,
              color: giTokens.parchment,
              fontSize: '0.75rem',
              fontWeight: 700,
              lineHeight: '20px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            C{constellation}
          </Box>
        </Box>
        <Box
          aria-hidden
          sx={(theme) => ({ height: 3, bgcolor: theme.palette[element].main })}
        />
        <Box
          sx={{
            bgcolor: strip.bg,
            color: strip.text,
            textAlign: 'center',
            fontSize: '0.8125rem',
            fontWeight: 700,
            lineHeight: `${strip.height}px`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {t('enka.level', { defaultValue: 'Lv. {{level}}', level })}
        </Box>
      </Box>
      <Box
        sx={{
          pt: 1,
          px: 0.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          minWidth: 0,
        }}
      >
        <Typography
          noWrap
          sx={{ fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.3 }}
        >
          <CharacterName characterKey={key} gender={gender} />
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          title={t('enka.talents', 'Talents')}
          aria-label={`${t('enka.talents', 'Talents')} ${talent.auto}, ${talent.skill}, ${talent.burst}`}
          sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
        >
          {`${talent.auto} · ${talent.skill} · ${talent.burst}`}
        </Typography>
        {(weapon || sets.length > 0) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {weapon && <WeaponThumb weapon={weapon} />}
            <Box sx={{ display: 'flex', '& > * + *': { ml: '-8px' } }}>
              {sets.map(([set, num]) => (
                <SetThumb
                  key={set}
                  set={set}
                  num={sets.length === 1 ? num : undefined}
                />
              ))}
            </Box>
          </Box>
        )}
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color:
              status === 'new'
                ? giTokens.gold
                : status === 'update'
                  ? 'info.light'
                  : 'text.secondary',
          }}
        >
          {statusLabel}
        </Typography>
      </Box>
    </ButtonBase>
  )
}

function Done({ result }: { result: ImportResult }) {
  const { t } = useTranslation('ui')
  const { characters, weapons, artifacts } = result
  const matched = (r: ImportResult['artifacts' | 'weapons']) =>
    r.upgraded.length + r.unchanged.length
  const lines = [
    t('enka.done.characters', {
      defaultValue: 'Characters: {{count}} ({{new}} new, {{updated}} updated)',
      count: characters.import,
      new: characters.new.length,
      updated: characters.import - characters.new.length,
    }),
    weapons.import > 0 &&
      t('enka.done.weapons', {
        defaultValue:
          'Weapons: {{count}} ({{new}} new, {{matched}} you already had)',
        count: weapons.import,
        new: weapons.new.length,
        matched: matched(weapons),
      }),
    artifacts.import > 0 &&
      t('enka.done.artifacts', {
        defaultValue:
          'Artifacts: {{count}} ({{new}} new, {{matched}} you already had)',
        count: artifacts.import,
        new: artifacts.new.length,
        matched: matched(artifacts),
      }),
  ].filter(Boolean)
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1, py: 3 }}>
      <CheckCircleRoundedIcon sx={{ fontSize: 48, color: 'success.main' }} />
      <Typography variant="h6" sx={{ fontWeight: 650 }}>
        {t('enka.done.title', 'Imported')}
      </Typography>
      {lines.map((line) => (
        <Typography key={String(line)} color="text.secondary">
          {line}
        </Typography>
      ))}
    </Box>
  )
}
