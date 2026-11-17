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
  TeamOptEnergyRotationField,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { teamOptEnergyRotationFields } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { KqmBuild, KqmStep } from '@genshin-optimizer/gi/ui'
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
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Autocomplete,
  alpha,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
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
import { formatDamage, formatGain } from '../format'
import { kqmEnergyEstimate, MemberEnergy } from '../KqmEnergyCalculator'
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
  type,
} from '../ui'
import type { Side, SideMember, SwapIn } from './compareSwapKqm'
import { compareSwapKqm, swapSettings } from './compareSwapKqm'
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

/** Read by screen readers only */
const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

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

export default function KqmCompare({ teamId }: { teamId: string }) {
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
    setErText('')
    setCalcOwn(undefined)
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

  const swapIn: SwapIn | undefined = useMemo(() => {
    if (!inKey) return undefined
    if (!auto && (!weapon || !setKey)) return undefined
    const own: Partial<TeamOptKqm> = {
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
      sets: auto ? 'auto' : { [setKey as ArtifactSetKey]: 4 },
      build: 'kqm',
      kqm: own,
    }
  }, [
    inKey,
    auto,
    weapon,
    setKey,
    refinement,
    constellation,
    calculator,
    erValue,
    erInvalid,
    calcOwn,
    teamKqm,
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
          : !auto && (!weapon || !setKey)
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
                    disabled={!inKey}
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
                      disabled={auto}
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
                      disabled={auto}
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
                  <FormControl
                    size="small"
                    sx={{ width: { xs: '100%', sm: 240 } }}
                  >
                    <InputLabel id={`${titleId}-sets`}>
                      {t('kqmCompare.sets')}
                    </InputLabel>
                    <Select
                      labelId={`${titleId}-sets`}
                      label={t('kqmCompare.sets')}
                      value={auto ? '' : setKey}
                      disabled={auto}
                      onChange={(e) =>
                        setSetKey(e.target.value as ArtifactSetKey)
                      }
                    >
                      {sets.map((s) => (
                        <MenuItem key={s} value={s}>
                          <ArtifactSetName setKey={s} />
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
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
                {calculator ? (
                  <EnteringEnergy
                    teamId={teamId}
                    saved={saved}
                    out={out}
                    swapIn={swapIn}
                    text={text}
                    opener={opener}
                    fragment={fragment}
                    ready={!!swapped?.ok}
                    own={calcOwn}
                    setOwn={setCalcOwn}
                  />
                ) : (
                  <TextField
                    size="small"
                    label={t('kqmCompare.erTarget')}
                    value={erText}
                    placeholder="100"
                    onChange={(e) => setErText(e.target.value)}
                    error={erInvalid}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">%</InputAdornment>
                      ),
                    }}
                    inputProps={{
                      inputMode: 'decimal',
                      style: { textAlign: 'right' },
                    }}
                    sx={{ width: 160, ...numSx }}
                  />
                )}
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
              label={t('kqmCompare.confirm')}
              sx={{ mr: 0 }}
            />
            {rotationChanged && (
              <Box role="status" sx={{ color: 'warning.main', fontSize: 13 }}>
                <WarningLine>{t('kqmCompare.rotationChanged')}</WarningLine>
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
            <LinearProgress
              variant={step ? 'determinate' : 'indeterminate'}
              value={percent}
              aria-label={t('kqmCompare.running', { percent })}
              sx={{ height: 3, borderRadius: 1 }}
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

function WarningLine({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}
    >
      <WarningAmberRoundedIcon
        aria-hidden
        sx={{ fontSize: 16, mt: '1px', flexShrink: 0 }}
      />
      <span>{children}</span>
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

/**
 * The entering member's ER calculator inputs: as team B's rotation fills them in (the same
 * settings the comparison runs with), the ones changed here kept over the rotation's. Its field
 * time is the leaving member's.
 */
function EnteringEnergy({
  teamId,
  saved,
  out,
  swapIn,
  text,
  opener,
  fragment,
  ready,
  own,
  setOwn,
}: {
  teamId: string
  saved: TeamKqmSavedRun
  out: CharacterKey | undefined
  swapIn: SwapIn | undefined
  text: string
  opener: string
  fragment: string
  ready: boolean
  own: TeamOptEnergyMember | undefined
  setOwn: (
    update: (
      previous: TeamOptEnergyMember | undefined
    ) => TeamOptEnergyMember | undefined
  ) => void
}) {
  const { t, i18n } = useTranslation(['juanlab', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [settings, setSettings] = useState<
    { teamOpt: TeamOpt; keys: CharacterKey[] } | { message: string } | undefined
  >()
  // (a copy of the database and a replay: after the panel shows, again when the swap changes)
  useEffect(() => {
    if (!ready || !out || !swapIn) {
      setSettings(undefined)
      return
    }
    let cancelled = false
    const id = setTimeout(() => {
      let next: typeof settings
      try {
        const result = swapSettings({
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
        })
        next =
          'error' in result
            ? { message: t('kqmCompare.error.unsupported') }
            : result
      } catch (e) {
        next = { message: String((e as Error)?.message ?? e) }
      }
      if (!cancelled) setSettings(next)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [
    database,
    teamId,
    gender,
    i18n,
    saved,
    out,
    swapIn,
    text,
    opener,
    fragment,
    ready,
    t,
  ])
  const key = swapIn?.key
  const calc =
    settings && 'teamOpt' in settings
      ? settings.teamOpt.kqm?.energyCalculator
      : undefined
  const filled = key ? calc?.members[key] : undefined
  const member = useMemo(
    () => filled && own && { ...filled, ...own, fieldTime: filled.fieldTime },
    [filled, own]
  )
  const estimate = useMemo(
    () =>
      settings && 'teamOpt' in settings && calc
        ? kqmEnergyEstimate(settings.keys, calc, settings.teamOpt.kqm)
        : undefined,
    [settings, calc]
  )
  if (!ready || !key)
    return <EmptyLine>{t('kqmCompare.settingsNeedSwap')}</EmptyLine>
  if (settings && 'message' in settings)
    return (
      <Box sx={{ color: 'warning.main', fontSize: 13 }}>
        <WarningLine>{settings.message}</WarningLine>
      </Box>
    )
  if (!settings || !calc || !estimate)
    return <EmptyLine>{t('kqmCompare.settingsLoading')}</EmptyLine>
  return (
    <MemberEnergy
      characterKey={key}
      keys={settings.keys}
      kqm={settings.teamOpt.kqm}
      member={member ?? filled}
      rotationTime={calc.rotationTime}
      estimate={estimate}
      fromRotation
      lockFieldTime
      onUseRotation={() => setOwn(() => undefined)}
      updateMember={(_key, values) =>
        setOwn((previous) => {
          const base = previous ?? filled
          if (!base) return previous
          const { fieldTime: _fieldTime, ...rest } = values
          // (set here: the rotation no longer fills these in)
          const edited = [
            ...new Set([
              ...(base.edited ?? []),
              ...(Object.keys(rest) as TeamOptEnergyRotationField[]).filter(
                (field) => teamOptEnergyRotationFields.includes(field)
              ),
            ]),
          ]
          return { ...base, ...rest, ...(edited.length && { edited }) }
        })
      }
    />
  )
}

/** A against B, with the change */
function Overview({
  a,
  b,
  out,
  inKey,
  nameOf,
  language,
}: {
  a: Side
  b: Side
  out: CharacterKey
  inKey: CharacterKey
  nameOf: (key: CharacterKey) => string
  language: string
}) {
  const { t } = useTranslation('juanlab')
  const fmt = (digits: number) => {
    try {
      return new Intl.NumberFormat(language, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    } catch {
      return new Intl.NumberFormat('en', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    }
  }
  const oneDigit = fmt(1)
  const whole = fmt(0)
  const seconds = (s: number) => (s > 0 ? `${oneDigit.format(s)} s` : '–')
  const pct = (v: number) => `${whole.format(v)}%`
  const gain = (from: number, to: number) =>
    from > 0 ? to / from - 1 : Number.NaN
  const pairs = a.members.map((m) => ({
    a: m,
    b: b.members.find((x) => x.key === (m.key === out ? inKey : m.key)),
  }))
  const head = {
    ...type.label,
    fontWeight: 600,
    borderBottom: hairline,
    whiteSpace: 'nowrap',
  } as const
  const cell = {
    borderBottom: hairline,
    py: 0.75,
    px: 1.25,
    fontSize: 13.5,
  } as const
  const num = { ...cell, ...numSx, textAlign: 'right' } as const
  return (
    <Box sx={{ ...insetSx, overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 520 }}>
        <Box component="caption" sx={srOnly}>
          {t('kqmCompare.table.title')}
        </Box>
        <TableHead>
          <TableRow>
            <TableCell sx={{ ...cell, ...head }}>
              <Box component="span" sx={srOnly}>
                {t('kqmCompare.table.figure')}
              </Box>
            </TableCell>
            <TableCell sx={{ ...num, ...head }}>
              {t('kqmCompare.table.a', { name: nameOf(out) })}
            </TableCell>
            <TableCell sx={{ ...num, ...head }}>
              {t('kqmCompare.table.b', { name: nameOf(inKey) })}
            </TableCell>
            <TableCell sx={{ ...num, ...head }}>
              {t('kqmCompare.table.delta')}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <FigureRow
            label={t('kqmCompare.table.dpr')}
            a={formatDamage(a.dpr)}
            b={formatDamage(b.dpr)}
            delta={gain(a.dpr, b.dpr)}
            cell={cell}
            num={num}
          />
          <FigureRow
            label={t('kqmCompare.table.dps')}
            a={formatDamage(a.dps)}
            b={formatDamage(b.dps)}
            delta={gain(a.dps, b.dps)}
            cell={cell}
            num={num}
          />
          <FigureRow
            label={t('kqmCompare.table.time')}
            a={seconds(a.rotationTime)}
            b={seconds(b.rotationTime)}
            cell={cell}
            num={num}
          />
          {pairs.map(({ a: ma, b: mb }) => {
            const swapped = ma.key === out
            const name = swapped
              ? `${nameOf(ma.key)} → ${nameOf(inKey)}`
              : nameOf(ma.key)
            return (
              <MemberRows
                key={ma.key}
                name={name}
                fixed={!swapped}
                lockedLabel={t('kqmCompare.locked')}
                a={ma}
                b={mb}
                pct={pct}
                delta={mb ? gain(ma.damage, mb.damage) : Number.NaN}
                cell={cell}
                num={num}
              />
            )
          })}
        </TableBody>
      </Table>
    </Box>
  )
}

type CellSx = Record<string, unknown>

function Delta({ value }: { value: number | undefined }) {
  if (value === undefined) return null
  const color = !Number.isFinite(value)
    ? 'text.secondary'
    : value > 0.0005
      ? 'success.main'
      : value < -0.0005
        ? 'error.main'
        : 'text.secondary'
  return (
    <Box component="span" sx={{ color, fontWeight: 600 }}>
      {formatGain(value)}
    </Box>
  )
}

function FigureRow({
  label,
  a,
  b,
  delta,
  cell,
  num,
}: {
  label: string
  a: ReactNode
  b: ReactNode
  delta?: number
  cell: CellSx
  num: CellSx
}) {
  return (
    <TableRow>
      <TableCell component="th" scope="row" sx={{ ...cell, fontWeight: 600 }}>
        {label}
      </TableCell>
      <TableCell sx={num}>{a}</TableCell>
      <TableCell sx={num}>{b}</TableCell>
      <TableCell sx={num}>
        <Delta value={delta} />
      </TableCell>
    </TableRow>
  )
}

function MemberRows({
  name,
  fixed,
  lockedLabel,
  a,
  b,
  pct,
  delta,
  cell,
  num,
}: {
  name: string
  fixed: boolean
  lockedLabel: string
  a: SideMember
  b: SideMember | undefined
  pct: (v: number) => string
  delta: number
  cell: CellSx
  num: CellSx
}) {
  const { t } = useTranslation('juanlab')
  const short = !!b && fixed && b.erValue < b.er - 0.05
  const label = (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
    >
      {name}
      {fixed && (
        <>
          <LockOutlinedIcon
            aria-hidden
            sx={{ fontSize: 14, color: 'text.secondary' }}
          />
          <Box component="span" sx={srOnly}>
            {lockedLabel}
          </Box>
        </>
      )}
    </Box>
  )
  return (
    <>
      <TableRow>
        <TableCell
          component="th"
          scope="row"
          sx={{ ...cell, fontWeight: 600, borderBottom: 0 }}
        >
          {label}
          <Box component="span" sx={{ ...type.label, ml: 0.75 }}>
            {t('kqmCompare.table.damage')}
          </Box>
        </TableCell>
        <TableCell sx={{ ...num, borderBottom: 0 }}>
          {formatDamage(a.damage)}{' '}
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {pct(a.share * 100)}
          </Box>
        </TableCell>
        <TableCell sx={{ ...num, borderBottom: 0 }}>
          {b ? (
            <>
              {formatDamage(b.damage)}{' '}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {pct(b.share * 100)}
              </Box>
            </>
          ) : (
            '–'
          )}
        </TableCell>
        <TableCell sx={{ ...num, borderBottom: 0 }}>
          <Delta value={delta} />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell component="th" scope="row" sx={cell}>
          <Box component="span" sx={srOnly}>
            {name}{' '}
          </Box>
          <Box component="span" sx={{ ...type.label, pl: 0.25 }}>
            {t('kqmCompare.table.er')}
          </Box>
        </TableCell>
        <TableCell sx={num}>{a.er ? pct(a.er) : '–'}</TableCell>
        <TableCell sx={{ ...num, ...(short && { color: 'warning.main' }) }}>
          {b?.er ? (
            <Box
              component="span"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            >
              {short && (
                <Tooltip
                  arrow
                  title={t('kqmCompare.table.erShort', {
                    value: Math.round(b.erValue),
                    target: Math.round(b.er),
                  })}
                >
                  <WarningAmberRoundedIcon aria-hidden sx={{ fontSize: 15 }} />
                </Tooltip>
              )}
              {pct(b.er)}
              {short && (
                <Box component="span" sx={srOnly}>
                  {t('kqmCompare.table.erShort', {
                    value: Math.round(b.erValue),
                    target: Math.round(b.er),
                  })}
                </Box>
              )}
            </Box>
          ) : (
            '–'
          )}
        </TableCell>
        <TableCell sx={num} />
      </TableRow>
    </>
  )
}
