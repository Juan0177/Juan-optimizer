import { artifactDefIcon, weaponAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { getWeaponStat } from '@genshin-optimizer/gi/stats'
import type {
  CompareChartData,
  CompareRow,
  KqmCardData,
  KqmResult,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  BETA_KEYS,
  BETA_LABEL,
  CardImageDialog,
  compareChartSplash,
  currentRelease,
  COMPARE_CHART_HEIGHT,
  COMPARE_CHART_WIDTH,
  KQM_CARD_HEIGHT,
  KQM_CARD_WIDTH,
  kqmCardFace,
  kqmDefaultExcludedWeapons,
  kqmSetsId,
  kqmTalentLevel,
  renderCompareChart,
  renderKqmCard,
  safeName,
} from '@genshin-optimizer/gi/ui'
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded'
import {
  Box,
  Button,
  Divider,
  Menu,
  MenuItem,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import type { TFunction } from 'i18next'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRateFull } from './format'
import { MemberAvatar } from './MemberAvatar'

type Picture = 'team' | 'weapons' | 'sets'

/** The Share tip was seen on this device */
const SHARE_TIP_KEY = 'kqm_share_tip_seen'

/**
 * What made the picture and when, small in its corner (to check a shared picture against later):
 * "Stellar Optimizer v1.11.2 · 16 Nov 2026"
 */
const shareStamp = () =>
  `Stellar Optimizer v${currentRelease.version} · ${new Date().toLocaleDateString(
    undefined,
    { day: 'numeric', month: 'short', year: 'numeric' }
  )}`

declare const __GO_BUILD_ID__: string

/** The unreleased content (keys) among `keys`, each once */
const betaOf = (keys: Iterable<string>) =>
  [...new Set(keys)].filter((k) => BETA_KEYS.has(k)).sort()

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
  ...props
}: ShareProps & { disabled?: boolean }) {
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
  const { characterKey: ck, result, members } = props
  const build = result.builds[ck]
  const setKey = build && Object.keys(build.sets)[0]
  // the members a chart can show (tabs in its dialog): the ranked ones; it opens on the one shown
  // in the inspector
  const ranked = members
    .map((m) => m.characterKey)
    .filter((k) => result.rankings[k])
  const [member, setMember] = useState<CharacterKey>(ck)
  const choose = (picture: Picture) => {
    setAnchor(null)
    setMember(ranked.includes(ck) ? ck : (ranked[0] ?? ck))
    setOpen(picture)
  }
  const tabs = open && open !== 'team' && (
    <MemberTabs keys={ranked} value={member} onChange={setMember} />
  )
  const tipOpen = tipReady && !tipSeen && !disabled && !anchor
  /** a picture to make: its thumbnail, its name */
  const item = (picture: Picture, thumb: ReactNode, label: string) => (
    <MenuItem
      onClick={() => choose(picture)}
      disabled={picture !== 'team' && !ranked.length}
      sx={{ gap: 1.5, py: 1, px: 1.25, borderRadius: 2, minHeight: 0 }}
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
                'A team card, and weapon and artifact set charts, as images for Discord, Reddit or X.'
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
              borderRadius: 2.5,
              p: 1.25,
            },
          },
          arrow: { sx: { color: 'background.paper' } },
        }}
      >
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<IosShareRoundedIcon />}
          disabled={disabled}
          aria-haspopup="menu"
          onClick={(e) => {
            seeTip()
            setAnchor(e.currentTarget)
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
              borderRadius: 3,
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
      </Menu>
      {open === 'team' && (
        <TeamPicture {...props} onClose={() => setOpen(undefined)} />
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
    </>
  )
}

/** A chart's members, as tabs (face and name): which one it shows */
function MemberTabs({
  keys,
  value,
  onChange,
}: {
  keys: CharacterKey[]
  value: CharacterKey
  onChange: (ck: CharacterKey) => void
}) {
  const { t } = useTranslation('charNames_gen')
  const { gender } = useDBMeta()
  return (
    <Tabs
      value={keys.includes(value) ? value : false}
      onChange={(_, v: CharacterKey) => onChange(v)}
      variant="scrollable"
      scrollButtons={false}
      sx={{ minHeight: 0 }}
    >
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
  const { t } = useTranslation([
    'page_team',
    'charNames_gen',
    'weaponNames_gen',
    'artifactNames_gen',
  ])
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
      teamName: team?.name ?? '',
      keys,
      cons,
      charName,
      weaponName,
      setName,
      standard: t('page_team:teamOpt.kqm.share.standard', {
        defaultValue: 'KQM Standards · Talents {{talents}}',
        talents: `${talents}/${talents}/${talents}`,
      }),
      teamLine: keys.map((ck) => `C${cons(ck)} ${charName(ck)}`).join('  ·  '),
    }
  }, [t, gender, team?.name, setup, members, result])
}

/** The written rotation, its members' turns apart */
function rotationTurns(teamId: string) {
  const text = globalThis.localStorage?.getItem(`teamOptRotationText_${teamId}`)
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
  props: ShareProps,
  s: ReturnType<typeof useShareText>,
  picture: Picture,
  beta: string[],
  extra?: Record<string, unknown>
) {
  const { teamId, result, setup, members, rotationTime, characterKey } = props
  const stored = (key: string) => {
    try {
      return globalThis.localStorage?.getItem(`${key}_${teamId}`) ?? undefined
    } catch {
      return undefined
    }
  }
  const { attacks, excludedArts: _, ...settings } = setup
  const count = (a: TeamOpt['attacks'] | undefined) =>
    Object.fromEntries(
      Object.entries(a ?? {}).map(([ck, list]) => [ck, list?.length ?? 0])
    )
  return {
    app: 'Stellar Optimizer',
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
      text: stored('teamOptRotationText'),
      opener: stored('teamOptRotationOpener'),
      timing: stored('teamOptRotationTiming'),
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
  const { result, rotationTime, teamId } = props
  const { setup } = props
  const data = useMemo((): KqmCardData => {
    const { total } = result.after
    // (field time: the ER calculator's, from the rotation or as typed)
    const calc = setup.kqm?.energyCalculator
    return {
      name: s.teamName,
      members: s.keys.map((ck) => {
        const build = result.builds[ck]!
        const damage = result.after.members[ck] ?? 0
        const fieldTime = calc?.members[ck]?.fieldTime
        return {
          ...kqmCardFace(ck, s.gender),
          name: s.charName(ck),
          constellation: s.cons(ck),
          weapon: {
            name: s.weaponName(build.weapon.key),
            refinement: build.weapon.refinement,
            icon: weaponAsset(build.weapon.key, true),
          },
          sets: Object.keys(build.sets).map((key) => ({
            name: s.setName(key),
            icon: artifactDefIcon(key as never),
          })),
          damage: formatRateFull(damage, undefined),
          share: total > 0 ? damage / total : 0,
          field:
            rotationTime && fieldTime !== undefined
              ? `${((fieldTime / 100) * rotationTime).toFixed(1)}s`
              : undefined,
          er: `${Math.round(result.energyRecharge[ck]?.value ?? 100)}%`,
        }
      }),
      total: formatRateFull(total, undefined),
      dps: rotationTime ? formatRateFull(total, rotationTime) : undefined,
      seconds: rotationTime
        ? s.t('page_team:teamOpt.kqm.share.seconds', {
            defaultValue: '{{seconds}}s rotation',
            seconds: rotationTime,
          })
        : undefined,
      rotation: rotationTurns(teamId),
      notes: s.standard,
      beta: s.beta.length ? BETA_LABEL : undefined,
      labels: {
        team: s.t('page_team:teamOpt.kqm.share.colTeam', 'Team'),
        damage: s.t('page_team:teamOpt.kqm.share.colDamage', 'Damage'),
        dist: s.t('page_team:teamOpt.kqm.share.colShare', 'Share'),
        field: s.t('page_team:teamOpt.kqm.share.colField', 'Field'),
        er: 'ER',
        total: s.t('page_team:teamOpt.kqm.share.total', 'Total'),
        dpr: 'DPR',
        dps: 'DPS',
        rotation: s.t('page_team:teamOpt.kqm.share.rotation', 'Rotation'),
        notes: s.t('page_team:teamOpt.kqm.share.notes', 'Notes'),
        siteName: shareStamp(),
      },
    }
  }, [s, result, rotationTime, teamId, setup])
  const render = useMemo(() => () => renderKqmCard(data), [data])
  const watermark = () => shareRecord(props, s, 'team', s.beta)
  return (
    <CardImageDialog
      title={s.t('page_team:teamOpt.kqm.share.team', 'Team card')}
      alt={s.t('page_team:teamOpt.kqm.share.teamAlt', {
        defaultValue: 'The KQM builds of {{team}}',
        team: s.teamName,
      })}
      fileName={`${safeName(s.teamName)}-kqm`}
      aspectRatio={`${KQM_CARD_WIDTH} / ${KQM_CARD_HEIGHT}`}
      render={render}
      watermark={watermark}
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
      subtitle: rotationTime
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
        siteName: shareStamp(),
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
  const { result, characterKey: ck } = props
  const own = result.builds[ck]
  const rows = useMemo((): CompareRow[] | undefined => {
    const ranking = result.rankings[ck]
    if (!ranking || !own) return undefined
    if (kind === 'weapons') {
      // the 100%: the best of KQM's default weapon list (forged, event, Battle Pass, fishing, quest
      // and standard-wish 4★ weapons) at the refinement it is built at (not a compared one), one
      // meeting the Energy Recharge target if any does; none in the ranking: the run's pick
      const off = new Set<string>(kqmDefaultExcludedWeapons())
      const listed = ranking.weapons.filter(
        (o) => !o.compare && !off.has(o.weapon.key)
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
    shareRecord(props, s, kind, beta, {
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
