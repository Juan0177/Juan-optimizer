import {
  artifactDefIcon,
  characterAsset,
  weaponAsset,
} from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allTravelerKeys,
  charKeyToLocGenderedCharKey,
} from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { getCharStat, getWeaponStat } from '@genshin-optimizer/gi/stats'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type {
  CompareChartData,
  CompareRow,
  InvestmentChartData,
  KqmBuild,
  KqmCardData,
  KqmResult,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  BETA_LABEL,
  CardImageDialog,
  COMPARE_CHART_HEIGHT,
  COMPARE_CHART_WIDTH,
  compareChartSplash,
  currentRelease,
  KQM_CARD_HEIGHT,
  KQM_CARD_WIDTH,
  kqmCardFace,
  kqmCardHeight,
  kqmDefaultExcludedWeapons,
  kqmRefinement,
  kqmSetsId,
  kqmTalentLevel,
  renderCompareChart,
  renderInvestmentChart,
  renderKqmCard,
  safeName,
  TeamOptCancelled,
} from '@genshin-optimizer/gi/ui'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Divider,
  LinearProgress,
  Menu,
  MenuItem,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import type { TFunction } from 'i18next'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CONSTELLATIONS,
  type ComboRotation,
  ComboRotations,
  ConsRotations,
  type ConsRotationTexts,
  comboRotationOf,
  consRotationOf,
  readComboRotations,
  readConsRotations,
  writeComboRotations,
  writeConsRotations,
} from './ConsRotations'
import {
  bestInvestments,
  type ConsPoint,
  dpsOf,
  type Investment,
  refitConstellations,
} from './consInvestment'
import { formatRateFull } from './format'
import {
  betaOf,
  type KqmCardView,
  kqmCardFileName,
  kqmMembersStats,
  kqmStandardNote,
  kqmTeamCardData,
  readKqmCardView,
  shareStamp,
  writeKqmCardView,
} from './kqmTeamCard'
import { kqmStandardText } from './KqmStandard'
import { MemberAvatar } from './MemberAvatar'
import { useMemberNames } from './RotationWriter'
import { Disclosure, hairline, insetSx, Segmented, type } from './ui'

type Picture = 'team' | 'weapons' | 'sets' | 'constellations'

/** The Share tip was seen on this device */
const SHARE_TIP_KEY = 'kqm_share_tip_seen'

declare const __GO_BUILD_ID__: string

type ShareProps = {
  teamId: string
  result: KqmResult
  /** the settings the run was set up with */
  setup: TeamOpt
  members: TeamOptMember[]
  /** the member the comparisons are for (the one shown in the inspector) */
  characterKey: CharacterKey
  rotationTime?: number
}

/**
 * "Share": the result as pictures to post (Discord, Reddit, X): the team's card, and for the member
 * shown, its weapons and artifact sets compared by the team's damage
 */
export function KqmShareMenu({
  disabled,
  shown,
  ...props
}: ShareProps & {
  disabled?: boolean
  /**
   * The team as shown: the run's, or with other equipment picked in the inspector or a top team
   * picked. The team card shows it; the charts compare on the run's rankings.
   */
  shown?: KqmResult
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState<Picture>()
  // the first time there are results to share: a tip that this is where (once, per device)
  const [tipSeen, setTipSeen] = useState(() => {
    try {
      return !!globalThis.localStorage?.getItem(SHARE_TIP_KEY)
    } catch {
      return true
    }
  })
  const seeTip = () => {
    setTipSeen(true)
    try {
      globalThis.localStorage?.setItem(SHARE_TIP_KEY, '1')
    } catch {
      // (no storage: shown again next time)
    }
  }
  // (shown a moment after the results, once they are laid out)
  const [tipReady, setTipReady] = useState(false)
  useEffect(() => {
    if (tipSeen || disabled) return
    const id = setTimeout(() => setTipReady(true), 900)
    return () => clearTimeout(id)
  }, [tipSeen, disabled])
  const { gender } = useDBMeta()
  const { characterKey: ck, result, members } = props
  const build = result.builds[ck]
  const setKey = build && Object.keys(build.sets)[0]
  // the members a chart can show (tabs in its dialog): the ranked ones (weapons, sets), the built
  // ones (constellations); it opens on the one shown in the inspector
  const chartable = (picture: Picture) =>
    members
      .map((m) => m.characterKey)
      .filter((k) =>
        picture === 'constellations' ? result.builds[k] : result.rankings[k]
      )
  const [member, setMember] = useState<CharacterKey>(ck)
  const choose = (picture: Picture) => {
    setAnchor(null)
    const keys = chartable(picture)
    setMember(keys.includes(ck) ? ck : (keys[0] ?? ck))
    setOpen(picture)
  }
  const tabs = open && open !== 'team' && (
    <MemberTabs keys={chartable(open)} value={member} onChange={setMember} />
  )
  const tipOpen = tipReady && !tipSeen && !disabled && !anchor
  /** a picture to make: its thumbnail, its name */
  const item = (picture: Picture, thumb: ReactNode, label: string) => (
    <MenuItem
      onClick={() => choose(picture)}
      disabled={picture !== 'team' && !chartable(picture).length}
      sx={{ gap: 1.5, py: 1, px: 1.25, borderRadius: 1.5, minHeight: 0 }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          borderRadius: 1.5,
          bgcolor: 'rgba(255, 255, 255, 0.05)',
          overflow: 'hidden',
        }}
      >
        {thumb}
      </Box>
      <Typography sx={{ fontSize: 14.5, fontWeight: 500 }}>{label}</Typography>
    </MenuItem>
  )
  const icon = (src: string) => (
    <Box
      component="img"
      src={src}
      alt=""
      aria-hidden
      sx={{ width: 28, height: 28, objectFit: 'contain' }}
    />
  )
  return (
    <>
      <Tooltip
        open={tipOpen}
        arrow
        placement="bottom-end"
        disableFocusListener
        disableHoverListener
        disableTouchListener
        title={
          <Box sx={{ p: 0.5, maxWidth: 260 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 650, mb: 0.5 }}>
              {t('teamOpt.kqm.share.tipTitle', 'Share these builds')}
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1 }}>
              {t(
                'teamOpt.kqm.share.tipBody',
                'A team card, and weapon, artifact set and constellation charts, as images for Discord, Reddit or X.'
              )}
            </Typography>
            <Button size="small" variant="contained" onClick={seeTip}>
              {t('teamOpt.kqm.share.tipOk', 'Got it')}
            </Button>
          </Box>
        }
        slotProps={{
          tooltip: {
            sx: {
              bgcolor: 'background.paper',
              color: 'text.primary',
              border: '1px solid rgba(236, 229, 216, 0.14)',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
              borderRadius: 1.5,
              p: 1.25,
            },
          },
          arrow: { sx: { color: 'background.paper' } },
        }}
      >
        {/* the results' main action after a run: a gold pill, larger than the rest */}
        <Button
          variant="outlined"
          startIcon={
            <IosShareRoundedIcon sx={{ fontSize: '19px !important' }} />
          }
          disabled={disabled}
          aria-haspopup="menu"
          onClick={(e) => {
            seeTip()
            setAnchor(e.currentTarget)
          }}
          sx={{
            height: 40,
            px: 2.25,
            borderRadius: 1,
            textTransform: 'none',
            fontSize: 14,
            fontWeight: 650,
            letterSpacing: '0.005em',
            color: giTokens.goldLight,
            borderColor: alpha(giTokens.gold, 0.5),
            bgcolor: alpha(giTokens.gold, 0.1),
            transition: 'background-color .15s, border-color .15s, color .15s',
            '& .MuiButton-startIcon': { mr: 0.875 },
            '&:hover': {
              borderColor: giTokens.gold,
              bgcolor: alpha(giTokens.gold, 0.18),
            },
            '&.Mui-focusVisible': {
              outline: `2px solid ${giTokens.gold}`,
              outlineOffset: 2,
            },
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          {t('teamOpt.kqm.share.button', 'Share')}
        </Button>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        disableAutoFocusItem
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75,
              minWidth: 260,
              borderRadius: 1.5,
              border: '1px solid rgba(236, 229, 216, 0.12)',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
            },
          },
        }}
        MenuListProps={{ sx: { p: 0.75 } }}
      >
        {item(
          'team',
          <Box sx={{ display: 'flex' }}>
            {members.slice(0, 4).map((m, i) => (
              <Box
                key={m.characterKey}
                sx={{ ml: i ? -1.25 : 0, display: 'flex' }}
              >
                <MemberAvatar characterKey={m.characterKey} size={18} />
              </Box>
            ))}
          </Box>,
          t('teamOpt.kqm.share.team', 'Team card')
        )}
        <Divider sx={{ my: 0.75, mx: 0.5 }} />
        {item(
          'weapons',
          build && icon(weaponAsset(build.weapon.key, true)),
          t('teamOpt.kqm.share.weapons', 'Weapons')
        )}
        {item(
          'sets',
          setKey && icon(artifactDefIcon(setKey as never)),
          t('teamOpt.kqm.share.sets', 'Artifact sets')
        )}
        {item(
          'constellations',
          icon(characterAsset(ck, 'constellation1', gender) ?? ''),
          t('teamOpt.kqm.share.constellations', 'Constellations')
        )}
      </Menu>
      {open === 'team' && (
        <TeamPicture
          {...props}
          result={shown ?? props.result}
          onClose={() => setOpen(undefined)}
        />
      )}
      {(open === 'weapons' || open === 'sets') && (
        <ComparePicture
          {...props}
          characterKey={member}
          kind={open}
          tabs={tabs}
          onClose={() => setOpen(undefined)}
        />
      )}
      {open === 'constellations' && (
        <ConstellationPicture
          {...props}
          characterKey={member}
          onClose={() => setOpen(undefined)}
        />
      )}
    </>
  )
}

/** A chart's members, as tabs (face and name): which one it shows; `team`: a Team tab first */
function MemberTabs<V extends CharacterKey | 'team' = CharacterKey>({
  keys,
  value,
  onChange,
  team,
}: {
  keys: CharacterKey[]
  value: V
  onChange: (value: V) => void
  team?: string
}) {
  const { t } = useTranslation('charNames_gen')
  const { gender } = useDBMeta()
  const shown = (keys as string[]).includes(value) || (team && value === 'team')
  return (
    <Tabs
      value={shown ? value : false}
      onChange={(_, v: V) => onChange(v)}
      variant="scrollable"
      scrollButtons={false}
      sx={{ minHeight: 0 }}
    >
      {team && (
        <Tab
          value="team"
          sx={{ minHeight: 0, py: 1, px: 1.5, textTransform: 'none' }}
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ display: 'flex' }}>
                {keys.slice(0, 4).map((k, i) => (
                  <Box key={k} sx={{ ml: i ? -1 : 0, display: 'flex' }}>
                    <MemberAvatar characterKey={k} size={20} />
                  </Box>
                ))}
              </Box>
              {team}
            </Box>
          }
        />
      )}
      {keys.map((k) => (
        <Tab
          key={k}
          value={k}
          sx={{ minHeight: 0, py: 1, px: 1.5, textTransform: 'none' }}
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MemberAvatar characterKey={k} size={24} />
              {t(`charNames_gen:${charKeyToLocGenderedCharKey(k, gender)}`)}
            </Box>
          }
        />
      ))}
    </Tabs>
  )
}

/** Names, icons and the standard's line, for every picture */
function useShareText(props: ShareProps) {
  const { t, i18n } = useTranslation([
    'page_team',
    'charNames_gen',
    'weaponNames_gen',
    'artifactNames_gen',
    // (the detailed team card's stat names)
    'keymap',
    // (the notes' line about the artifacts' rolls)
    'juanlab',
  ])
  const locale = i18n.language
  const { gender } = useDBMeta()
  const team = useTeam(props.teamId)
  const { result, setup, members } = props
  return useMemo(() => {
    const charName = (ck: CharacterKey) =>
      t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`)
    const weaponName = (key: string) => t(`weaponNames_gen:${key}`)
    const setName = (key: string) => t(`artifactNames_gen:${key}`)
    const talents = kqmTalentLevel(setup.kqm)
    const keys = members
      .map((m) => m.characterKey)
      .filter((ck) => result.builds[ck])
    const cons = (ck: CharacterKey) => result.constellations[ck] ?? 0
    // unreleased content the result rests on: a member, a build's weapon or sets
    const beta = betaOf(
      members.flatMap((m) => {
        const build = result.builds[m.characterKey]
        return [
          m.characterKey,
          ...(build ? [build.weapon.key, ...Object.keys(build.sets)] : []),
        ]
      })
    )
    return {
      t: t as unknown as TFunction,
      beta,
      gender,
      locale,
      teamName: team?.name ?? '',
      keys,
      cons,
      charName,
      weaponName,
      setName,
      standard: kqmStandardNote(
        t as unknown as TFunction,
        talents,
        kqmStandardText(
          t as unknown as TFunction,
          setup.kqm,
          members.map((m) => m.characterKey)
        )
      ),
      teamLine: keys.map((ck) => `C${cons(ck)} ${charName(ck)}`).join('  ·  '),
    }
  }, [t, locale, gender, team?.name, setup, members, result])
}

/** The written rotation, its members' turns apart */
export function rotationTurns(text: string | undefined) {
  return (text ?? '')
    .split(/\s*(?:->|→|\n)+\s*/)
    .map((turn) => turn.replace(/^>\s*/, '').trim())
    .filter(Boolean)
}

/**
 * The hidden record of how a picture was made (`CardImageDialog`'s watermark; read back with
 * tools/site/read-share-png.mjs): the app's version and build, when, the team's KQM settings,
 * written rotation and result. Not the attacks themselves (the rotation makes them again): their
 * count per member.
 */
function shareRecord(
  database: ReturnType<typeof useDatabase>,
  props: ShareProps,
  s: ReturnType<typeof useShareText>,
  picture: Picture,
  beta: string[],
  extra?: Record<string, unknown>
) {
  const { teamId, result, setup, members, rotationTime, characterKey } = props
  const document = database.teams.get(teamId)?.rotationDocuments?.kqm
  const rotation = document?.UseAttacks === '1' ? undefined : document
  const { attacks, excludedArts: _, ...settings } = setup
  const count = (a: TeamOpt['attacks'] | undefined) =>
    Object.fromEntries(
      Object.entries(a ?? {}).map(([ck, list]) => [ck, list?.length ?? 0])
    )
  return {
    app: 'Juan-optimizer',
    version: currentRelease.version,
    build: typeof __GO_BUILD_ID__ === 'string' ? __GO_BUILD_ID__ : 'dev',
    site: globalThis.location?.host,
    generatedAt: new Date().toISOString(),
    picture,
    member: picture === 'team' ? undefined : characterKey,
    beta,
    gender: s.gender,
    team: {
      id: teamId,
      name: s.teamName,
      members: members.map((m) => m.characterKey),
    },
    rotationTime,
    rotation: {
      text: rotation?.Text,
      opener: rotation?.Opener,
      timing: rotation?.Timing,
    },
    settings: { ...settings, attacks: count(attacks) },
    result: {
      total: result.after.total,
      members: result.after.members,
      constellations: result.constellations,
      energyRecharge: result.energyRecharge,
      builds: result.builds,
      assumed: result.assumed,
      optimized: result.optimized,
      rounds: result.rounds,
      played: result.played && {
        attacks: count(result.played.attacks),
        rotationTime: result.played.rotationTime,
        stalls: result.played.stalls,
      },
    },
    ...extra,
  }
}

function TeamPicture({
  onClose,
  ...props
}: ShareProps & { onClose: () => void }) {
  const s = useShareText(props)
  const database = useDatabase()
  const { result, rotationTime, teamId } = props
  const { setup } = props
  // (the usual sheet, or with each member's stats; the last pick, in this browser)
  const [view, setViewState] = useState<KqmCardView>(readKqmCardView)
  const setView = (v: KqmCardView) => {
    setViewState(v)
    writeKqmCardView(v)
  }
  // (out of combat, as the run had each member: its constellation, the KQM talents; worked out
  // once per view and result, not again when the language changes; a member whose stats fail to
  // compute gets no details, the card still opens)
  const stats = useMemo(() => {
    if (view !== 'detailed') return undefined
    return kqmMembersStats(
      database,
      (
        Object.entries(result.builds) as [CharacterKey, KqmBuild | undefined][]
      ).map(([key, build]) => ({
        key,
        build,
        constellation: result.constellations[key] ?? 0,
      })),
      kqmTalentLevel(setup.kqm)
    )
  }, [view, database, result, setup])
  const rotation = useTeam(teamId)?.rotationDocuments?.kqm
  const rotationText = rotation?.UseAttacks === '1' ? undefined : rotation?.Text
  const data = useMemo((): KqmCardData => {
    // (field time: the ER calculator's, from the rotation or as typed)
    const calc = setup.kqm?.energyCalculator
    return kqmTeamCardData({
      t: s.t,
      gender: s.gender,
      name: s.teamName,
      members: s.keys.map((ck) => ({
        key: ck,
        constellation: s.cons(ck),
        build: result.builds[ck]!,
        damage: result.after.members[ck] ?? 0,
        er: result.energyRecharge[ck]?.value,
        fieldTime: calc?.members[ck]?.fieldTime,
        stats: stats?.[ck],
      })),
      total: result.after.total,
      rotationTime,
      rotation: rotationTurns(rotationText),
      notes: s.standard,
      beta: s.beta.length > 0,
      siteName: shareStamp(s.locale),
      locale: s.locale,
    })
  }, [s, result, rotationTime, rotationText, setup, stats])
  const render = useMemo(() => () => renderKqmCard(data), [data])
  const watermark = () =>
    shareRecord(database, props, s, 'team', s.beta, { view })
  const viewLabel = s.t('page_team:teamOpt.card.view.label', 'Card view')
  return (
    <CardImageDialog
      title={s.t('page_team:teamOpt.kqm.share.team', 'Team card')}
      alt={s.t('page_team:teamOpt.kqm.share.teamAlt', {
        defaultValue: 'The KQM builds of {{team}}',
        team: s.teamName,
      })}
      fileName={kqmCardFileName(`${safeName(s.teamName)}-kqm`, view)}
      // (the detailed sheet is taller: its own height; the usual one as ever)
      aspectRatio={`${KQM_CARD_WIDTH} / ${view === 'detailed' ? kqmCardHeight(data) : KQM_CARD_HEIGHT}`}
      render={render}
      watermark={watermark}
      header={
        <Segmented<KqmCardView>
          size="small"
          value={view}
          aria-label={viewLabel}
          options={[
            {
              value: 'normal',
              label: s.t('page_team:teamOpt.card.view.normal', 'Normal'),
            },
            {
              value: 'detailed',
              label: s.t('page_team:teamOpt.card.view.detailed', 'Detailed'),
            },
          ]}
          onChange={setView}
        />
      }
      onClose={onClose}
    />
  )
}

/** A comparison's chart, and what is around it (the title, the team line) */
function useCompareChart(
  props: ShareProps,
  title: string,
  rows: CompareRow[] | undefined,
  /** the rows' weapons or sets (keys): unreleased ones mark the chart beta too */
  rowKeys: string[]
) {
  const s = useShareText(props)
  const { characterKey: ck, rotationTime } = props
  const beta = useMemo(() => betaOf([...s.beta, ...rowKeys]), [s.beta, rowKeys])
  const data = useMemo((): CompareChartData | undefined => {
    if (!rows?.length) return undefined
    return {
      title,
      // (the team's and the member's own: the legend names them)
      subtitle: rows.some((r) => r.personal !== undefined)
        ? s.standard
        : rotationTime
          ? s.t('page_team:teamOpt.kqm.share.compareDps', {
              defaultValue: 'Team DPS · {{standard}}',
              standard: s.standard,
            })
          : s.t('page_team:teamOpt.kqm.share.compareDmg', {
              defaultValue: 'Team damage · {{standard}}',
              standard: s.standard,
            }),
      rows,
      member: {
        ...kqmCardFace(ck, s.gender),
        splash: compareChartSplash(ck, s.gender),
      },
      team: s.keys.map((k) => ({
        ...kqmCardFace(k, s.gender),
        label: `C${s.cons(k)} ${s.charName(k)}`,
      })),
      footer: s.teamLine,
      beta: beta.length ? BETA_LABEL : undefined,
      labels: {
        unmet: s.t('page_team:teamOpt.kqm.share.unmet', 'ER unmet'),
        siteName: shareStamp(s.locale),
        // (the constellation chart's two bars)
        team: rotationTime
          ? s.t('page_team:teamOpt.kqm.share.teamDps', 'Team DPS')
          : s.t('page_team:teamOpt.kqm.share.teamDmg', 'Team damage'),
        personal: rotationTime
          ? s.t('page_team:teamOpt.kqm.share.ownDps', {
              defaultValue: '{{name}} DPS',
              name: s.charName(ck),
            })
          : s.t('page_team:teamOpt.kqm.share.ownDmg', {
              defaultValue: '{{name}} damage',
              name: s.charName(ck),
            }),
      },
    }
  }, [s, rows, title, ck, rotationTime, beta])
  return { data, beta, s }
}

function ComparePicture({
  kind,
  tabs,
  onClose,
  ...props
}: ShareProps & {
  kind: 'weapons' | 'sets'
  tabs: ReactNode
  onClose: () => void
}) {
  const s = useShareText(props)
  const database = useDatabase()
  const { result, characterKey: ck } = props
  const own = result.builds[ck]
  const rows = useMemo((): CompareRow[] | undefined => {
    const ranking = result.rankings[ck]
    if (!ranking || !own) return undefined
    if (kind === 'weapons') {
      // the 100%: the best of KQM's default weapon list (forged, event, Battle Pass, fishing, quest
      // and standard-wish 4★ weapons) at its default refinement (Battle Pass R1, never an R5
      // ticked too), one meeting the Energy Recharge target if any does; none in the ranking: the
      // run's pick
      const off = new Set<string>(kqmDefaultExcludedWeapons())
      const listed = ranking.weapons.filter(
        (o) =>
          !off.has(o.weapon.key) &&
          o.weapon.refinement === kqmRefinement(o.weapon.key)
      )
      const pool = listed.some((o) => !o.unmet)
        ? listed.filter((o) => !o.unmet)
        : listed
      const base = pool.reduce<(typeof pool)[number] | undefined>(
        (best, o) => (!best || o.total > best.total ? o : best),
        undefined
      )
      const isOwn = (o: (typeof ranking.weapons)[number]) =>
        o.weapon.key === own.weapon.key &&
        o.weapon.refinement === own.weapon.refinement
      return ranking.weapons.map((o) => ({
        label: `${s.weaponName(o.weapon.key)} R${o.weapon.refinement}`,
        icons: [
          {
            src: weaponAsset(o.weapon.key, true),
            rarity: getWeaponStat(o.weapon.key).rarity,
          },
        ],
        value: o.total,
        base: base ? o === base : isOwn(o),
        unmet: o.unmet,
      }))
    }
    return ranking.sets.map((o) => {
      const sets = Object.entries(o.sets)
      return {
        label: sets
          .map(([key, n]) =>
            sets.length > 1 ? `${s.setName(key)}` : `${n}× ${s.setName(key)}`
          )
          .join(' + '),
        icons: sets.map(([key]) => ({
          src: artifactDefIcon(key as never),
        })),
        value: o.total,
        base: kqmSetsId(o.sets) === kqmSetsId(own.sets),
        unmet: o.unmet,
      }
    })
  }, [result, ck, own, kind, s])
  const title =
    kind === 'weapons'
      ? s.t('page_team:teamOpt.kqm.share.weaponsTitle', {
          defaultValue: 'Weapons · C{{cons}} {{name}}',
          cons: s.cons(ck),
          name: s.charName(ck),
        })
      : s.t('page_team:teamOpt.kqm.share.setsTitle', {
          defaultValue: 'Artifact sets · C{{cons}} {{name}}',
          cons: s.cons(ck),
          name: s.charName(ck),
        })
  const rowKeys = useMemo(() => {
    const ranking = result.rankings[ck]
    if (!ranking) return []
    return kind === 'weapons'
      ? ranking.weapons.map((o) => o.weapon.key)
      : ranking.sets.flatMap((o) => Object.keys(o.sets))
  }, [result, ck, kind])
  const { data, beta } = useCompareChart(props, title, rows, rowKeys)
  const render = useMemo(() => data && (() => renderCompareChart(data)), [data])
  const watermark = () =>
    shareRecord(database, props, s, kind, beta, {
      rows: rows?.map(({ label, value, base, unmet }) => ({
        label,
        value,
        base,
        unmet,
      })),
    })
  return (
    <CardImageDialog
      title={title}
      alt={title}
      fileName={`${safeName(s.charName(ck))}-${kind}`}
      aspectRatio={`${COMPARE_CHART_WIDTH} / ${COMPARE_CHART_HEIGHT}`}
      render={render}
      watermark={watermark}
      header={tabs}
      onClose={onClose}
    />
  )
}

const NO_KEYS: string[] = []
/** 5★ members that cost nothing to have (the Traveler, Aloy) */
const FREE_FIVE_STARS = new Set<string>([...allTravelerKeys, 'Aloy'])
/**
 * What a member at a constellation costs, in copies (the usual "cost": a 5★ is 1 at C0 and 1 more
 * per constellation); a 4★ is had (KQM's standard), its constellations above the run's count as
 * the investment adds them
 */
const copiesOf = (ck: CharacterKey, cons: number) =>
  getCharStat(ck).rarity === 5 && !FREE_FIVE_STARS.has(ck) ? cons + 1 : 0

/** A constellation played (`refitConstellations`), and the rotation text it played (absent: the team's) */
type Played = { point: ConsPoint; text?: string }

/**
 * Constellations, for the whole team and each member: first the rotation each constellation
 * plays (each member's tab: the team's, unless another is written for it); then one Generate for
 * every chart. Each member at each constellation is refitted alone (`refitConstellations`: its
 * main stats and rolls, its weapon and sets and the others' builds kept: about one ranking row's
 * work); the Team tab then shows, for each cost (one constellation of any member), the team's
 * best constellations (`bestInvestments`: from those alone, a few combinations played).
 */
function ConstellationPicture({
  onClose,
  ...props
}: ShareProps & { onClose: () => void }) {
  const s = useShareText(props)
  const database = useDatabase()
  const { gender } = useDBMeta()
  const { i18n } = useTranslation()
  const { result, setup, teamId, members } = props
  const keys = s.keys
  const names = useMemberNames(members)
  const rotation = useTeam(teamId)?.rotationDocuments?.kqm
  const teamText = rotation?.UseAttacks === '1' ? '' : (rotation?.Text ?? '')
  const [view, setView] = useState<CharacterKey | 'team'>('team')
  // each member's rotation at each constellation (kept per team and member)
  const [rotationsOf, setRotationsOf] = useState<
    Partial<Record<CharacterKey, ConsRotationTexts>>
  >(() =>
    Object.fromEntries(
      keys.map((k) => [k, readConsRotations(database, teamId, k)])
    )
  )
  const setRotations = (ck: CharacterKey, next: ConsRotationTexts) => {
    setRotationsOf((r) => ({ ...r, [ck]: next }))
    writeConsRotations(database, teamId, ck, next)
  }
  // (a constellation's own, else the nearest lower one's, else the team's: absent)
  const textOf = (ck: CharacterKey, cons: number) =>
    consRotationOf(rotationsOf[ck] ?? {}, cons, s.cons(ck)).text
  // (advanced) rotations written for combinations of constellations, for the team's chart
  const [combos, setCombosState] = useState<ComboRotation[]>(() =>
    readComboRotations(database, teamId)
  )
  const setCombos = (next: ComboRotation[]) => {
    setCombosState(next)
    writeComboRotations(database, teamId, next)
  }
  const [advancedOpen, setAdvancedOpen] = useState(() => combos.length > 0)
  const runCons = useMemo(
    () => Object.fromEntries(keys.map((k) => [k, s.cons(k)])),
    [keys, s]
  )
  const rotationsKey = JSON.stringify([
    keys.map((k) => rotationsOf[k] ?? {}),
    combos,
  ])

  const baseSeconds = result.played?.rotationTime ?? props.rotationTime
  const basePoint = useMemo(
    (): ConsPoint => ({
      team: result.after.total,
      members: result.after.members,
      seconds: baseSeconds,
      builds: result.builds,
    }),
    [result, baseSeconds]
  )
  // each member at each other constellation, as played (another rotation written since: again)
  const [points, setPoints] = useState<
    Partial<Record<CharacterKey, Partial<Record<number, Played>>>>
  >({})
  const pointsRef = useRef(points)
  // the team's best for each cost, and the rotations it was found with
  const [investment, setInvestment] = useState<{
    rows: Investment[]
    key: string
  }>()
  const investmentRef = useRef(investment)
  // (combinations played, by constellations and rotation: kept while the dialog is open)
  const playedCombos = useRef(new Map<string, number>())
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<
    | {
        phase: 'member'
        ck: CharacterKey
        cons: number
        done: number
        total: number
      }
    | { phase: 'team'; cost: number; costs: number }
  >()
  const [error, setError] = useState<string>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rotations by their text
  useEffect(() => {
    if (!generating) return
    let cancelled = false
    const isCancelled = () => cancelled
    setError(undefined)
    ;(async () => {
      try {
        // every member alone at each constellation
        const total = keys.length * (CONSTELLATIONS.length - 1)
        let done = 0
        for (const ck of keys) {
          const ran = s.cons(ck)
          for (const cons of CONSTELLATIONS) {
            if (cons === ran) continue
            const text = textOf(ck, cons)
            const kept = pointsRef.current[ck]?.[cons]
            if (kept && kept.text === text) {
              done++
              continue
            }
            setProgress({ phase: 'member', ck, cons, done, total })
            const point = await refitConstellations({
              database,
              teamId,
              gender,
              i18n,
              setup,
              result,
              cons: { [ck]: cons },
              text,
              isCancelled,
            })
            if (cancelled) return
            done++
            // (nothing to play: said, not waited for)
            if (!point)
              throw new Error(
                `${s.charName(ck)} at C${cons} could not be played.`
              )
            pointsRef.current = {
              ...pointsRef.current,
              [ck]: { ...pointsRef.current[ck], [cons]: { point, text } },
            }
            setPoints(pointsRef.current)
          }
        }
        // the team: each cost's best constellations
        if (investmentRef.current?.key !== rotationsKey) {
          const base = keys.map((k) => s.cons(k))
          const pointAt = (i: number, cons: number) =>
            pointsRef.current[keys[i]]?.[cons]?.point
          const rows = await bestInvestments({
            base,
            baseDps: dpsOf(basePoint),
            single: (i, cons) => {
              const p = pointAt(i, cons)
              return p && dpsOf(p)
            },
            evaluate: async (cons) => {
              const raised = keys.flatMap((k, i) =>
                cons[i] !== base[i] ? [[k, cons[i], i] as const] : []
              )
              // (the rotation written for this combination, or one it includes; else the one
              // written for one of its constellations, the first member's; else the team's)
              const text =
                comboRotationOf(
                  combos,
                  Object.fromEntries(keys.map((k, i) => [k, cons[i]])),
                  runCons
                ) ??
                raised
                  .map(([k, c]) => textOf(k, c))
                  .find((x) => x !== undefined)
              const id = `${cons.join()}|${text ?? ''}`
              if (playedCombos.current.has(id))
                return playedCombos.current.get(id)
              const point = await refitConstellations({
                database,
                teamId,
                gender,
                i18n,
                setup,
                result,
                cons: Object.fromEntries(raised.map(([k, c]) => [k, c])),
                start: Object.fromEntries(
                  raised.flatMap(([k, c, i]) => {
                    const b = pointAt(i, c)?.builds[k]
                    return b ? [[k, b]] : []
                  })
                ),
                text,
                isCancelled,
              })
              const dps = point && dpsOf(point)
              if (dps !== undefined) playedCombos.current.set(id, dps)
              return dps
            },
            isCancelled,
            onCost: (cost, costs) =>
              setProgress({ phase: 'team', cost, costs }),
          })
          if (cancelled || !rows) return
          investmentRef.current = { rows, key: rotationsKey }
          setInvestment(investmentRef.current)
        }
        setProgress(undefined)
      } catch (e) {
        if (cancelled || e instanceof TeamOptCancelled) return
        setError(String((e as Error)?.message ?? e))
        setProgress(undefined)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    generating,
    rotationsKey,
    database,
    gender,
    i18n,
    teamId,
    setup,
    result,
    basePoint,
    keys,
  ])
  // every chart's figures are in (for the rotations written now)
  const complete =
    investment?.key === rotationsKey &&
    keys.every((ck) =>
      CONSTELLATIONS.every(
        (cons) =>
          cons === s.cons(ck) ||
          (points[ck]?.[cons] && points[ck]?.[cons]?.text === textOf(ck, cons))
      )
    )
  const done = generating && complete

  // ── a member's chart: the team's DPS and its own at each constellation
  const ck = view === 'team' ? undefined : view
  const memberRows = useMemo((): CompareRow[] | undefined => {
    if (!done || !ck) return undefined
    const ran = s.cons(ck)
    const at = (cons: number) =>
      cons === ran ? basePoint : points[ck]?.[cons]?.point
    // (per second when every rotation's length is known: rotations of different lengths compare
    // by DPS, not by damage per rotation)
    const shown = CONSTELLATIONS.flatMap((cons) => at(cons) ?? [])
    const perSecond = shown.every((p) => p.seconds)
    return CONSTELLATIONS.flatMap((cons) => {
      const p = at(cons)
      if (!p) return []
      const per = perSecond ? p.seconds! : 1
      return [
        {
          label: `C${cons}`,
          icons: [
            {
              src:
                characterAsset(
                  ck,
                  cons ? (`constellation${cons}` as 'constellation1') : 'icon',
                  gender
                ) ?? '',
            },
          ],
          value: p.team / per,
          personal: (p.members[ck] ?? 0) / per,
          base: cons === ran,
        },
      ]
    })
  }, [done, ck, s, basePoint, points, gender])
  const memberTitle = ck
    ? s.t('page_team:teamOpt.kqm.share.consTitle', {
        defaultValue: 'Constellations · {{name}}',
        name: s.charName(ck),
      })
    : ''
  const compare = useCompareChart(
    { ...props, characterKey: ck ?? props.characterKey },
    memberTitle,
    memberRows,
    NO_KEYS
  )

  // ── the team's chart: the best constellations for each cost
  const teamTitle = s.t(
    'page_team:teamOpt.kqm.share.investTitle',
    'Constellation investment'
  )
  // (the team as run already costs its 5★ copies: the rows count from there)
  const baseCost = keys.reduce((n, k) => n + copiesOf(k, s.cons(k)), 0)
  const teamData = useMemo((): InvestmentChartData | undefined => {
    if (!done || !investment) return undefined
    const perSecond = !!baseSeconds
    return {
      title: teamTitle,
      subtitle: s.t('page_team:teamOpt.kqm.share.investSubtitle', {
        defaultValue: 'The best team DPS at each cost · {{standard}}',
        standard: s.standard,
      }),
      members: keys.map((k) => ({
        ...kqmCardFace(k, s.gender),
        name: s.charName(k),
      })),
      rows: investment.rows.map((row) => ({
        cost: baseCost + row.cost,
        cons: row.cons,
        value: row.dps,
        detail: formatRateFull(row.dps, undefined, s.locale),
      })),
      beta: s.beta.length ? BETA_LABEL : undefined,
      labels: {
        cost: s.t('page_team:teamOpt.kqm.share.investCost', 'Cost'),
        dps: perSecond
          ? s.t('page_team:teamOpt.kqm.share.teamDps', 'Team DPS')
          : s.t('page_team:teamOpt.kqm.share.teamDmg', 'Team damage'),
        note: s.t(
          'page_team:teamOpt.kqm.share.investNote',
          'Cost counts copies: a 5★ is 1 at C0, and every constellation is 1 more. Each row is the best way to spend it.'
        ),
        siteName: shareStamp(s.locale),
      },
    }
  }, [done, investment, baseSeconds, teamTitle, s, keys, baseCost])

  const render = useMemo(() => {
    if (view === 'team')
      return teamData && (() => renderInvestmentChart(teamData))
    return compare.data && (() => renderCompareChart(compare.data!))
  }, [view, teamData, compare.data])
  const watermark = () =>
    shareRecord(
      database,
      { ...props, characterKey: ck ?? props.characterKey },
      s,
      'constellations',
      view === 'team' ? s.beta : compare.beta,
      {
        view,
        constellations: points,
        investment: investment?.rows,
        investmentBaseCost: baseCost,
        constellationRotations: rotationsOf,
        combinationRotations: combos,
      }
    )

  // ── before the charts: the rotations (a member's tab), the team at a glance (the Team tab)
  const generate = (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
      <Button variant="contained" onClick={() => setGenerating(true)}>
        {s.t('page_team:teamOpt.kqm.share.consGenerateAll', 'Generate charts')}
      </Button>
    </Box>
  )
  const setupView =
    view === 'team' ? (
      <Box>
        <Box sx={{ ...insetSx, overflow: 'hidden' }}>
          {keys.map((k, i) => {
            const written = Object.keys(rotationsOf[k] ?? {}).length
            return (
              <ButtonBase
                key={k}
                onClick={() => setView(k)}
                sx={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 1.75,
                  py: 1.25,
                  textAlign: 'left',
                  borderTop: i ? hairline : 'none',
                  '&:hover': { bgcolor: 'rgba(236, 229, 216, 0.035)' },
                }}
              >
                <MemberAvatar characterKey={k} size={34} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 650 }}>
                    {s.charName(k)}
                  </Typography>
                  <Typography sx={type.label}>
                    {s.t('page_team:teamOpt.kqm.share.consRunAt', {
                      defaultValue: 'C{{cons}} in the run',
                      cons: s.cons(k),
                    })}
                    {' · '}
                    {written
                      ? s.t('page_team:teamOpt.kqm.share.consOwnCount', {
                          defaultValue: '{{count}} own rotations',
                          count: written,
                        })
                      : s.t(
                          'page_team:teamOpt.kqm.share.consTeamEvery',
                          'Team rotation at every constellation'
                        )}
                  </Typography>
                </Box>
                <EditOutlinedIcon
                  sx={{ fontSize: 18, color: 'text.secondary' }}
                />
              </ButtonBase>
            )
          })}
        </Box>
        <Disclosure
          label={s.t(
            'page_team:teamOpt.kqm.share.comboTitle',
            'Advanced: rotations for combinations'
          )}
          count={combos.length || undefined}
          info={s.t(
            'page_team:teamOpt.kqm.share.comboTip',
            'When several members’ constellations change the rotation together (one member’s C2 with another’s C1), write the rotation for that combination. It is used for those constellations and any higher ones; otherwise a combination plays the first member’s rotation for its constellation, else the team’s.'
          )}
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((o) => !o)}
          sx={{ mt: 1.5 }}
        >
          <Box sx={{ pt: 1 }}>
            <ComboRotations
              keys={keys}
              base={runCons}
              combos={combos}
              teamText={teamText}
              names={names}
              onChange={setCombos}
            />
          </Box>
        </Disclosure>
        {generate}
      </Box>
    ) : (
      <Box>
        <ConsRotations
          characterKey={view}
          ran={s.cons(view)}
          rotations={rotationsOf[view] ?? {}}
          teamText={teamText}
          names={names}
          gender={gender}
          onChange={(next) => setRotations(view, next)}
        />
        {generate}
      </Box>
    )
  const progressView = (
    <Box sx={{ display: 'grid', gap: 1, py: 6, px: { xs: 1, sm: 6 } }}>
      {error ? (
        <Typography color="error">{error}</Typography>
      ) : (
        <>
          <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>
            {progress?.phase === 'team'
              ? s.t('page_team:teamOpt.kqm.share.investRunning', {
                  defaultValue:
                    'Finding the best constellations for cost {{cost}} of {{costs}}',
                  cost: baseCost + progress.cost,
                  costs: baseCost + progress.costs,
                })
              : progress?.phase === 'member'
                ? s.t('page_team:teamOpt.kqm.share.consRunningAll', {
                    defaultValue:
                      '{{name}} at C{{cons}} ({{done}} of {{total}})',
                    name: s.charName(progress.ck),
                    cons: progress.cons,
                    done: progress.done,
                    total: progress.total,
                  })
                : s.t('page_team:teamOpt.kqm.share.consStarting', 'Starting…')}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={
              progress?.phase === 'team'
                ? (progress.cost / Math.max(1, progress.costs)) * 100
                : progress?.phase === 'member'
                  ? (progress.done / Math.max(1, progress.total)) * 100
                  : 0
            }
          />
        </>
      )}
    </Box>
  )
  const tabs = (
    <MemberTabs
      keys={keys}
      value={view}
      onChange={setView}
      team={s.t('page_team:teamOpt.kqm.share.consTeamTab', 'Team')}
    />
  )
  const title = view === 'team' ? teamTitle : memberTitle
  return (
    <CardImageDialog
      title={title}
      alt={title}
      fileName={
        view === 'team'
          ? `${safeName(s.teamName || 'team')}-constellation-investment`
          : `${safeName(s.charName(view))}-constellations`
      }
      aspectRatio={`${COMPARE_CHART_WIDTH} / ${COMPARE_CHART_HEIGHT}`}
      render={render}
      watermark={watermark}
      header={tabs}
      placeholder={generating ? progressView : setupView}
      onClose={onClose}
    >
      {done && (
        <Box>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<EditOutlinedIcon />}
            onClick={() => setGenerating(false)}
          >
            {s.t(
              'page_team:teamOpt.kqm.share.consEditRotations',
              'Edit rotations'
            )}
          </Button>
        </Box>
      )}
      {generating && !done && !error && (
        <Box>
          <Button
            size="small"
            color="inherit"
            onClick={() => setGenerating(false)}
          >
            {s.t('page_team:teamOpt.kqm.share.consStop', 'Stop')}
          </Button>
        </Box>
      )}
    </CardImageDialog>
  )
}
