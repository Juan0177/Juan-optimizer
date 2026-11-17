import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  TeamKqmSavedRun,
  TeamOpt,
  TeamOptEnergyMember,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type {
  KqmBuild,
  KqmSets,
  KqmStep,
  TeamData,
} from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  CharacterName,
  kitModels,
  kqmMemberConstellation,
  kqmSets,
  kqmWeapons,
  parseRotation,
  teamOptMembers,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import {
  Autocomplete,
  alpha,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import type { i18n as I18n } from 'i18next'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MemberAvatar } from '../MemberAvatar'
import {
  BetaBadge,
  Disclosure,
  EmptyLine,
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  Panel,
  Segmented,
  tokens,
  type,
} from '../ui'
import { Overview } from './CompareOverview'
import type { Side, SwapIn } from './compareSwapKqm'
import { compareSwapKqm } from './compareSwapKqm'
import { srOnly, WarningLine } from './compareUi'
import type { EnteringPassives, EnteringWeaponEnergy } from './EnteringSettings'
import { EnteringSettings } from './EnteringSettings'
import { swapFragment } from './swapFragment'

/*
 * KQM Compare (Alpha): KQM Theorycrafting's last result (A) against the same team with one member
 * swapped (B). Everything here is read only or kept in this screen's state: nothing is written to
 * the database, the team's settings, its saved KQM result or its rotation.
 */

/** A saved KQM run as KQM Theorycrafting keeps it (`useKqmRun`) */
interface SavedRunData {
  type?: string
  result?: {
    builds: Partial<Record<CharacterKey, KqmBuild>>
    constellations?: Partial<Record<CharacterKey, number>>
  }
  teamOpt?: TeamOpt
}

/**
 * KQM Theorycrafting's saved run for the team, as that tab shows it: a finished run, for the
 * team's current members (undefined once they changed)
 */
export function savedRunFor(
  database: ArtCharDatabase,
  teamId: string
): TeamKqmSavedRun | undefined {
  const saved = database.teamKqmResults.getRun(teamId)
  if (!saved) return undefined
  const run = saved.run as SavedRunData
  if (run.type !== 'done' || !run.result || !run.teamOpt) return undefined
  const members = teamOptMembers(database, teamId).map(
    (m) => m.characterKey as string
  )
  if (
    saved.members.length !== members.length ||
    !saved.members.every((k) => members.includes(k))
  )
    return undefined
  return saved
}

/** The team's written rotation (KQM Theorycrafting's), read only */
function readStored(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) ?? ''
  } catch {
    return ''
  }
}

type RunState =
  | { type: 'idle' }
  | { type: 'running' }
  | {
      type: 'done'
      a: Side
      b: Side
      out: CharacterKey
      in: CharacterKey
    }
  | { type: 'error'; message: string }

const PROGRESS_MS = 120

export default function KqmCompare({
  teamId,
  teamData,
}: {
  teamId: string
  /** The team's data: where the entering member's effect states that depend on a character are read */
  teamData?: TeamData
}) {
  const { t, i18n } = useTranslation(['juanlab', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const navigate = useNavigate()
  const titleId = useId()

  const saved = useMemo(() => savedRunFor(database, teamId), [database, teamId])
  const run = saved?.run as SavedRunData | undefined
  const teamKqm: TeamOptKqm | undefined = run?.teamOpt?.kqm
  const members = useMemo(
    () => teamOptMembers(database, teamId).map((m) => m.characterKey),
    [database, teamId]
  )
  const text = useMemo(
    () => readStored(`teamOptRotationText_${teamId}`),
    [teamId]
  )
  const opener = useMemo(
    () => readStored(`teamOptRotationOpener_${teamId}`),
    [teamId]
  )
  // (as KQM plays the rotation: the names in the user's language)
  const nameOf = useCallback(
    (ck: CharacterKey) =>
      t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`),
    [t, gender]
  )

  // the swap (this screen's state only)
  const [out, setOut] = useState<CharacterKey>()
  const [inKey, setInKey] = useState<CharacterKey | null>(null)
  const [constellation, setConstellation] = useState(0)
  const [auto, setAuto] = useState(true)
  const [weapon, setWeapon] = useState<WeaponKey | ''>('')
  const [refinement, setRefinement] = useState(1)
  const [setKey, setSetKey] = useState<ArtifactSetKey | ''>('')
  /** 4 pieces of one set, or 2 + 2 */
  const [setMode, setSetMode] = useState<'4' | '2+2'>('4')
  const [setKey2, setSetKey2] = useState<ArtifactSetKey | ''>('')
  const [passives, setPassives] = useState<EnteringPassives>({})
  const [weaponEnergy, setWeaponEnergy] = useState<EnteringWeaponEnergy>({})
  const [erText, setErText] = useState('')
  const [calcOwn, setCalcOwn] = useState<TeamOptEnergyMember>()
  const [fragment, setFragment] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const chooseIn = (key: CharacterKey | null) => {
    setInKey(key)
    setConstellation(key ? kqmMemberConstellation(key, undefined) : 0)
    setWeapon('')
    setSetKey('')
    setSetKey2('')
    setErText('')
    setCalcOwn(undefined)
    setPassives({})
    setWeaponEnergy({})
  }

  const weapons = useMemo(
    () => (inKey ? kqmWeapons(inKey, teamKqm, { all: true }) : []),
    [inKey, teamKqm]
  )
  const sets = useMemo(() => kqmSets(), [])
  const candidates = useMemo(
    () =>
      (Object.keys(kitModels) as CharacterKey[])
        .filter((k) => !members.includes(k))
        .map((k) => ({ key: k, name: nameOf(k) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [members, nameOf]
  )

  const calculator = teamKqm?.energySource === 'calculator'
  const erValue = erText.trim() ? Number(erText.replace(',', '.')) : undefined
  const erInvalid =
    erValue !== undefined && !(Number.isFinite(erValue) && erValue >= 100)

  // the fixed sets: 4 pieces, or 2 + 2 of two different sets
  const pickedSets: KqmSets | undefined = useMemo(
    () =>
      setMode === '4'
        ? setKey
          ? { [setKey]: 4 }
          : undefined
        : setKey && setKey2 && setKey !== setKey2
          ? { [setKey]: 2, [setKey2]: 2 }
          : undefined,
    [setMode, setKey, setKey2]
  )
  const swapIn: SwapIn | undefined = useMemo(() => {
    if (!inKey) return undefined
    if (!auto && (!weapon || !pickedSets)) return undefined
    const energyEntries = Object.entries(weaponEnergy).filter(([, v]) => v)
    const own: Partial<TeamOptKqm> = {
      ...(Object.keys(passives).length && { passives: { [inKey]: passives } }),
      ...(energyEntries.length && {
        weaponEnergy: Object.fromEntries(
          energyEntries.map(([w, v]) => [w, { [inKey]: v }])
        ),
      }),
      ...(!calculator &&
        erValue !== undefined &&
        !erInvalid && { energyRecharge: { [inKey]: erValue } }),
      ...(calculator &&
        calcOwn &&
        teamKqm?.energyCalculator && {
          energyCalculator: {
            ...teamKqm.energyCalculator,
            members: { [inKey]: calcOwn },
          },
        }),
    }
    return {
      key: inKey,
      constellation,
      weapon: auto ? 'auto' : { key: weapon as WeaponKey, refinement },
      sets: auto ? 'auto' : pickedSets!,
      build: 'kqm',
      kqm: own,
    }
  }, [
    inKey,
    auto,
    weapon,
    pickedSets,
    refinement,
    constellation,
    calculator,
    erValue,
    erInvalid,
    calcOwn,
    teamKqm,
    passives,
    weaponEnergy,
  ])

  // B's rotation, as the comparison will play it
  const swapped = useMemo(() => {
    if (!out || !inKey || !text.trim()) return undefined
    return swapFragment({
      text,
      opener,
      names: members.map((ck) => ({ characterKey: ck, name: nameOf(ck) })),
      out,
      inName: nameOf(inKey),
      fragment,
    })
  }, [out, inKey, text, opener, members, fragment, nameOf])
  const warnings = useMemo(() => {
    if (!swapped?.ok || !out || !inKey) return []
    const names = members.map((ck) => {
      const key = ck === out ? inKey : ck
      return { characterKey: key, name: nameOf(key) }
    })
    return [
      ...parseRotation(swapped.opener, names).warnings,
      ...parseRotation(swapped.text, names).warnings,
    ]
  }, [swapped, members, out, inKey, nameOf])

  // the run
  const [state, setState] = useState<RunState>({ type: 'idle' })
  const [step, setStep] = useState<KqmStep>()
  const job = useRef<{ cancelled: boolean }>()
  // leaving the tab cancels the run
  useEffect(
    () => () => {
      if (job.current) job.current.cancelled = true
    },
    []
  )
  const running = state.type === 'running'
  const cancel = () => {
    if (job.current) job.current.cancelled = true
    job.current = undefined
    setState({ type: 'idle' })
  }

  const outName = out ? nameOf(out) : ''
  const inName = inKey ? nameOf(inKey) : ''
  const fragmentError =
    swapped && !swapped.ok && swapped.error !== 'emptyFragment'
      ? swapped.error === 'notFound'
        ? t('kqmCompare.error.notFound', { name: outName })
        : t('kqmCompare.error.repeated', {
            name: outName,
            count: swapped.count,
          })
      : undefined
  const problem = !saved
    ? t('kqmCompare.noResult')
    : !text.trim()
      ? t('kqmCompare.error.noRotation')
      : !out
        ? t('kqmCompare.need.out')
        : !inKey
          ? t('kqmCompare.need.in')
          : !auto && (!weapon || !pickedSets)
            ? t('kqmCompare.need.gear')
            : erInvalid
              ? t('kqmCompare.need.er')
              : !fragment.trim()
                ? t('kqmCompare.need.fragment', { name: inName })
                : fragmentError
                  ? fragmentError
                  : !confirmed
                    ? t('kqmCompare.need.confirm')
                    : ''
  const canRun =
    !problem && !running && !!saved && !!out && !!swapIn && !!swapped?.ok

  const start = async () => {
    if (!canRun || !saved || !out || !swapIn) return
    if (job.current) job.current.cancelled = true
    const mine = { cancelled: false }
    job.current = mine
    setState({ type: 'running' })
    setStep(undefined)
    // (progress a few times a second, not on every step)
    let last = 0
    let pending: ReturnType<typeof setTimeout> | undefined
    let latest: KqmStep | undefined
    const onStep = (s: KqmStep) => {
      latest = s
      if (pending) return
      const wait = Math.max(0, PROGRESS_MS - (performance.now() - last))
      pending = setTimeout(() => {
        pending = undefined
        last = performance.now()
        if (!mine.cancelled) setStep(latest)
      }, wait)
    }
    // (the running state paints first)
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      const result = await compareSwapKqm({
        database,
        teamId,
        gender,
        i18n: i18n as I18n,
        saved,
        out,
        swapIn,
        text,
        opener,
        fragment,
        onStep,
        isCancelled: () => mine.cancelled,
      })
      if (mine.cancelled) return
      if ('error' in result)
        setState(
          result.error === 'cancelled'
            ? { type: 'idle' }
            : {
                type: 'error',
                message: errorText(result.error),
              }
        )
      else setState({ type: 'done', ...result, out, in: swapIn.key })
    } catch (e) {
      if (mine.cancelled) return
      console.error(e)
      setState({
        type: 'error',
        message: t('kqmCompare.error.failed', {
          message: String((e as Error)?.message ?? e),
        }),
      })
    } finally {
      if (pending) clearTimeout(pending)
      if (job.current === mine) job.current = undefined
    }
  }
  const errorText = (error: string) =>
    error === 'inTeam'
      ? t('kqmCompare.error.inTeam', { name: inName })
      : error === 'notFound'
        ? t('kqmCompare.error.notFound', { name: outName })
        : error === 'repeated'
          ? t('kqmCompare.error.repeated', { name: outName, count: 2 })
          : error === 'emptyFragment'
            ? t('kqmCompare.need.fragment', { name: inName })
            : t('kqmCompare.error.unsupported')

  const savedAt = saved ? formatWhen(saved.savedAt, i18n.language) : ''
  const recorded = run?.teamOpt?.kqm?.energyRotation
  const rotationChanged =
    recorded !== undefined && recorded.trim() !== text.trim()
  // (A's damage is for the attacks entered, not the written rotation played)
  const notPlayed =
    !!run && (run as { rotation?: string }).rotation !== 'played'
  const percent = Math.round((step?.progress ?? 0) * 100)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Panel component="section" sx={{ position: 'relative' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 0.5,
            mb: 0.5,
          }}
        >
          <Typography id={titleId} component="h2" sx={type.section}>
            {t('kqmCompare.title')}
          </Typography>
          <BetaBadge
            label={t('kqmCompare.alpha')}
            tip={t('kqmCompare.alphaTip')}
          />
          <InfoTooltipInline title={t('kqmCompare.info')} />
        </Box>

        {!saved ? (
          <EmptyLine
            info={t('kqmCompare.noResultTip')}
            action={
              <Button
                size="small"
                color="inherit"
                onClick={() => navigate(`/teams/${teamId}/kqm`)}
                sx={{ ml: 1, ...focusSx }}
              >
                {t('kqmCompare.openKqm')}
              </Button>
            }
            sx={{ my: 1 }}
          >
            {t('kqmCompare.noResult')}
          </EmptyLine>
        ) : (
          <Typography sx={{ ...type.label, mb: 2 }}>
            {t('kqmCompare.resultOf', { date: savedAt })}
          </Typography>
        )}

        {saved && (
          <Box
            component="fieldset"
            disabled={running}
            aria-labelledby={titleId}
            sx={{
              border: 0,
              m: 0,
              p: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {/* who leaves; the others stay as they are in A */}
            <Row label={t('kqmCompare.out')}>
              <Segmented
                aria-label={t('kqmCompare.out')}
                value={out}
                onChange={setOut}
                options={members.map((key) => ({
                  value: key,
                  label: (
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.75,
                      }}
                    >
                      <MemberAvatar characterKey={key} size={20} />
                      <CharacterName characterKey={key} gender={gender} />
                    </Box>
                  ),
                }))}
              />
            </Row>
            {out && (
              <Row
                label={
                  <FieldLabel tip={t('kqmCompare.fixedTip')}>
                    {t('kqmCompare.fixed')}
                  </FieldLabel>
                }
              >
                <FixedMembers
                  label={t('kqmCompare.fixed')}
                  keys={members.filter((k) => k !== out)}
                  run={run}
                  locked={t('kqmCompare.locked')}
                />
              </Row>
            )}

            {/* who enters: everything about it is open */}
            <Row label={t('kqmCompare.in')}>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 1.5,
                  minWidth: 0,
                }}
              >
                <Autocomplete
                  size="small"
                  options={candidates}
                  value={candidates.find((c) => c.key === inKey) ?? null}
                  onChange={(_e, value) => chooseIn(value?.key ?? null)}
                  getOptionLabel={(o) => o.name}
                  isOptionEqualToValue={(o, v) => o.key === v.key}
                  renderOption={(props, o) => (
                    <Box
                      component="li"
                      {...props}
                      key={o.key}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                      <MemberAvatar characterKey={o.key} size={22} />
                      {o.name}
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField {...params} label={t('kqmCompare.character')} />
                  )}
                  sx={{ width: { xs: '100%', sm: 220 } }}
                />
                <FormControl size="small" sx={{ width: 88 }}>
                  <InputLabel id={`${titleId}-cons`}>
                    {t('kqmCompare.constellation')}
                  </InputLabel>
                  <Select
                    labelId={`${titleId}-cons`}
                    label={t('kqmCompare.constellation')}
                    value={constellation}
                    disabled={!inKey || running}
                    onChange={(e) => setConstellation(Number(e.target.value))}
                    sx={numSx}
                  >
                    {[0, 1, 2, 3, 4, 5, 6].map((c) => (
                      <MenuItem key={c} value={c}>
                        C{c}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Row>
            {inKey && (
              <Row label={t('kqmCompare.gear')}>
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 1.5,
                    minWidth: 0,
                  }}
                >
                  <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={auto}
                          onChange={(e) => setAuto(e.target.checked)}
                        />
                      }
                      label={t('kqmCompare.auto')}
                      sx={{ mr: 0 }}
                    />
                    <InfoTooltipInline title={t('kqmCompare.autoTip')} />
                  </Box>
                  <FormControl
                    size="small"
                    sx={{ width: { xs: '100%', sm: 240 } }}
                  >
                    <InputLabel id={`${titleId}-weapon`}>
                      {t('kqmCompare.weapon')}
                    </InputLabel>
                    <Select
                      labelId={`${titleId}-weapon`}
                      label={t('kqmCompare.weapon')}
                      value={auto ? '' : weapon}
                      disabled={auto || running}
                      onChange={(e) => {
                        const key = e.target.value as WeaponKey
                        setWeapon(key)
                        setRefinement(
                          weapons.find((w) => w.key === key)?.refinement ?? 1
                        )
                      }}
                    >
                      {weapons.map((w) => (
                        <MenuItem key={w.key} value={w.key}>
                          <WeaponName weaponKey={w.key} />
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ width: 80 }}>
                    <InputLabel id={`${titleId}-ref`}>
                      {t('kqmCompare.refinement')}
                    </InputLabel>
                    <Select
                      labelId={`${titleId}-ref`}
                      label={t('kqmCompare.refinement')}
                      value={refinement}
                      disabled={auto || running}
                      onChange={(e) => setRefinement(Number(e.target.value))}
                      sx={numSx}
                    >
                      {[1, 2, 3, 4, 5].map((r) => (
                        <MenuItem key={r} value={r}>
                          R{r}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Segmented
                    size="small"
                    aria-label={t('kqmCompare.setMode')}
                    value={setMode}
                    onChange={setSetMode}
                    options={[
                      {
                        value: '4',
                        label: t('kqmCompare.sets4'),
                        disabled: auto || running,
                      },
                      {
                        value: '2+2',
                        label: t('kqmCompare.sets22'),
                        disabled: auto || running,
                      },
                    ]}
                  />
                  {(setMode === '4' ? [0] : [0, 1]).map((i) => (
                    <FormControl
                      key={i}
                      size="small"
                      sx={{ width: { xs: '100%', sm: 220 } }}
                    >
                      <InputLabel id={`${titleId}-sets${i}`}>
                        {i ? t('kqmCompare.sets2') : t('kqmCompare.sets')}
                      </InputLabel>
                      <Select
                        labelId={`${titleId}-sets${i}`}
                        label={i ? t('kqmCompare.sets2') : t('kqmCompare.sets')}
                        value={auto ? '' : i ? setKey2 : setKey}
                        disabled={auto || running}
                        onChange={(e) =>
                          (i ? setSetKey2 : setSetKey)(
                            e.target.value as ArtifactSetKey
                          )
                        }
                      >
                        {sets
                          .filter(
                            (s) =>
                              setMode === '4' || s !== (i ? setKey : setKey2)
                          )
                          .map((s) => (
                            <MenuItem key={s} value={s}>
                              <ArtifactSetName setKey={s} />
                            </MenuItem>
                          ))}
                      </Select>
                    </FormControl>
                  ))}
                </Box>
              </Row>
            )}
            {inKey && (
              <Row label={t('kqmCompare.build')}>
                <RadioGroup
                  row
                  aria-label={t('kqmCompare.build')}
                  value="kqm"
                  sx={{ alignItems: 'center' }}
                >
                  <FormControlLabel
                    value="kqm"
                    control={<Radio size="small" />}
                    label={t('kqmCompare.buildKqm')}
                  />
                  <FormControlLabel
                    value="existing"
                    disabled
                    control={<Radio size="small" />}
                    label={t('kqmCompare.buildExisting')}
                    sx={{ mr: 0 }}
                  />
                  <InfoTooltipInline title={t('kqmCompare.buildExistingTip')} />
                </RadioGroup>
              </Row>
            )}
            {inKey && (
              <Disclosure
                label={t('kqmCompare.settings', { name: inName })}
                info={t('kqmCompare.settingsTip')}
                open={settingsOpen}
                onToggle={() => setSettingsOpen((o) => !o)}
              >
                <EnteringSettings
                  teamId={teamId}
                  saved={saved}
                  out={out}
                  swapIn={swapIn}
                  text={text}
                  opener={opener}
                  fragment={fragment}
                  ready={!!swapped?.ok}
                  calculator={calculator}
                  erText={erText}
                  setErText={setErText}
                  erInvalid={erInvalid}
                  calcOwn={calcOwn}
                  setCalcOwn={setCalcOwn}
                  passives={passives}
                  setPassives={setPassives}
                  weaponEnergy={weaponEnergy}
                  setWeaponEnergy={setWeaponEnergy}
                  data={
                    out
                      ? teamData?.[members.find((k) => k !== out) ?? out]
                          ?.target
                      : undefined
                  }
                  teammateWeapons={members
                    .filter((k) => k !== out)
                    .flatMap((k) => {
                      const w = run?.result?.builds[k]?.weapon.key
                      return w ? [w] : []
                    })}
                  teamKqm={teamKqm}
                  pick={
                    !auto && weapon && pickedSets
                      ? { weapon, sets: pickedSets }
                      : undefined
                  }
                  disabled={running}
                />
              </Disclosure>
            )}

            {/* the entering member's actions, in place of the leaving member's step */}
            <Row
              label={
                <FieldLabel tip={t('kqmCompare.fragmentTip')}>
                  {t('kqmCompare.fragmentLabel')}
                </FieldLabel>
              }
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <TextField
                  size="small"
                  label={t('kqmCompare.fragment', {
                    name: inName || '…',
                  })}
                  value={fragment}
                  disabled={!inKey}
                  onChange={(e) => setFragment(e.target.value)}
                  sx={{ width: { xs: '100%', sm: 320 } }}
                  inputProps={{ spellCheck: false, autoComplete: 'off' }}
                />
                <Preview
                  label={t('kqmCompare.preview')}
                  openerLabel={t('kqmCompare.opener')}
                  swapped={swapped?.ok ? swapped : undefined}
                />
              </Box>
            </Row>

            {(!!fragmentError || !!warnings.length || !text.trim()) && (
              <Box
                role="status"
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  color: 'warning.main',
                  fontSize: 13,
                }}
              >
                {!text.trim() && (
                  <WarningLine>{t('kqmCompare.error.noRotation')}</WarningLine>
                )}
                {fragmentError && <WarningLine>{fragmentError}</WarningLine>}
                {warnings.map((w) => (
                  <WarningLine key={w}>{w}</WarningLine>
                ))}
              </Box>
            )}
          </Box>
        )}
        {/* A is KQM Theorycrafting's result: confirmed before anything runs (outside the form,
            which is disabled while it runs: Cancel stays reachable) */}
        {saved && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 2,
              rowGap: 1,
              mt: 2,
              pt: 1.5,
              borderTop: hairline,
            }}
          >
            <FormControlLabel
              control={
                <Checkbox
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
              }
              label={t('kqmCompare.confirm', { date: savedAt })}
              sx={{ mr: 0 }}
            />
            {(rotationChanged || notPlayed) && (
              <Box
                role="status"
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  color: 'warning.main',
                  fontSize: 13,
                }}
              >
                {rotationChanged && (
                  <WarningLine>{t('kqmCompare.rotationChanged')}</WarningLine>
                )}
                {notPlayed && (
                  <WarningLine>{t('kqmCompare.notPlayed')}</WarningLine>
                )}
              </Box>
            )}
            <Box
              sx={{
                ml: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              {!!problem && !running && (
                <Typography
                  role="status"
                  sx={{ ...type.label, color: 'text.secondary' }}
                >
                  {problem}
                </Typography>
              )}
              {running && (
                <Button color="inherit" onClick={cancel}>
                  {t('kqmCompare.cancel')}
                </Button>
              )}
              <Button
                variant="contained"
                disabled={!canRun}
                endIcon={<ArrowForwardIcon />}
                onClick={start}
                sx={{ ...giCtaSx, minHeight: 38, px: 2.25 }}
              >
                {t('kqmCompare.run')}
              </Button>
            </Box>
          </Box>
        )}
        {!saved && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button
              variant="contained"
              disabled
              endIcon={<ArrowForwardIcon />}
              sx={{ ...giCtaSx, minHeight: 38, px: 2.25 }}
            >
              {t('kqmCompare.run')}
            </Button>
          </Box>
        )}
        {running && (
          <Box sx={{ mt: 1.5 }}>
            {/* (the status line below announces it) */}
            <LinearProgress
              variant={step ? 'determinate' : 'indeterminate'}
              value={percent}
              aria-hidden
              sx={{
                height: 3,
                borderRadius: 1,
                bgcolor: alpha(tokens.gold, 0.16),
                '& .MuiLinearProgress-bar': { bgcolor: tokens.gold },
              }}
            />
            <Typography role="status" sx={{ ...type.label, mt: 0.75 }}>
              {t('kqmCompare.running', { percent })}
            </Typography>
          </Box>
        )}
        {state.type === 'error' && (
          <Box role="alert" sx={{ mt: 1.5, color: 'warning.main' }}>
            <WarningLine>{state.message}</WarningLine>
          </Box>
        )}
      </Panel>

      {state.type === 'done' && (
        <Panel title={t('kqmCompare.table.title')}>
          <Overview
            a={state.a}
            b={state.b}
            out={state.out}
            inKey={state.in}
            nameOf={nameOf}
            language={i18n.language}
          />
        </Panel>
      )}
    </Box>
  )
}

/** When the saved result was found, in the user's language */
function formatWhen(time: number, language: string) {
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(time)
  } catch {
    return new Date(time).toLocaleString()
  }
}

/** A labelled row of the form: the label on the left (above, on phones) */
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: '96px minmax(0, 1fr)',
        },
        alignItems: 'center',
        columnGap: 1.5,
        rowGap: 0.75,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {typeof label === 'string' ? <FieldLabel>{label}</FieldLabel> : label}
      </Box>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

/** The members who stay: A's builds, shown and locked */
function FixedMembers({
  label,
  keys,
  run,
  locked,
}: {
  label: string
  keys: CharacterKey[]
  run: SavedRunData | undefined
  locked: string
}) {
  const { gender } = useDBMeta()
  const kqm = run?.teamOpt?.kqm
  return (
    <Box
      component="ul"
      role="list"
      aria-label={label}
      sx={{
        ...insetSx,
        listStyle: 'none',
        m: 0,
        p: 0,
        overflow: 'hidden',
      }}
    >
      {keys.map((key, i) => {
        const build = run?.result?.builds[key]
        const cons =
          run?.result?.constellations?.[key] ?? kqmMemberConstellation(key, kqm)
        return (
          <Box
            component="li"
            key={key}
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 1.25,
              rowGap: 0.25,
              px: 1.25,
              py: 0.75,
              minHeight: 40,
              borderTop: i ? hairline : undefined,
              fontSize: 13.5,
            }}
          >
            <LockOutlinedIcon
              aria-hidden
              sx={{ fontSize: 16, color: 'text.secondary' }}
            />
            <Box component="span" sx={srOnly}>
              {locked}
            </Box>
            <MemberAvatar characterKey={key} size={22} />
            <Box component="span" sx={{ fontWeight: 600 }}>
              <CharacterName characterKey={key} gender={gender} />
            </Box>
            <Box component="span" sx={{ ...numSx, color: 'text.secondary' }}>
              C{cons}
            </Box>
            {build && (
              <Box
                component="span"
                sx={{ color: 'text.secondary', minWidth: 0 }}
              >
                <WeaponName weaponKey={build.weapon.key} /> R
                {build.weapon.refinement}
                {' · '}
                {Object.entries(build.sets)
                  .filter(([, n]) => n)
                  .map(([s, n], j) => (
                    <span key={s}>
                      {j ? ' + ' : ''}
                      <ArtifactSetName setKey={s as ArtifactSetKey} /> ({n})
                    </span>
                  ))}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

/** B's rotation, the entering member's step marked */
function Preview({
  label,
  openerLabel,
  swapped,
}: {
  label: string
  openerLabel: string
  swapped:
    | {
        text: string
        opener: string
        where: 'text' | 'opener'
        inserted: string
      }
    | undefined
}) {
  const marked = (s: string) => {
    const i = s.indexOf(swapped!.inserted)
    if (i < 0) return s
    return (
      <>
        {s.slice(0, i)}
        <Box
          component="mark"
          sx={(theme) => ({
            color: 'primary.main',
            bgcolor: alpha(theme.palette.primary.main, 0.14),
            borderRadius: 0.5,
            px: 0.25,
            fontWeight: 600,
          })}
        >
          {swapped!.inserted}
        </Box>
        {s.slice(i + swapped!.inserted.length)}
      </>
    )
  }
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{
        ...insetSx,
        mt: 1,
        px: 1.25,
        py: 1,
        minHeight: 40,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.6,
        overflowWrap: 'anywhere',
      }}
    >
      <Box
        component="span"
        sx={{ fontWeight: 700, mr: 1, color: 'text.secondary' }}
        aria-hidden
      >
        B
      </Box>
      {swapped ? (
        <>
          {!!swapped.opener.trim() && (
            <Box component="span" sx={{ display: 'block' }}>
              <Box component="span" sx={{ ...type.label, mr: 0.75 }}>
                {openerLabel}
              </Box>
              {swapped.where === 'opener'
                ? marked(swapped.opener)
                : swapped.opener}
            </Box>
          )}
          {swapped.where === 'text' ? marked(swapped.text) : swapped.text}
        </>
      ) : (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          –
        </Box>
      )}
    </Box>
  )
}
