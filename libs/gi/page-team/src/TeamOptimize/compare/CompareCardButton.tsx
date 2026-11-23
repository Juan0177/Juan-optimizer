import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import {
  CardImageDialog,
  KQM_COMPARE_CARD_HEIGHT,
  KQM_COMPARE_CARD_WIDTH,
  KQM_TALENT_DEFAULT,
  kqmCompareCardHeight,
  renderKqmCompareCard,
  safeName,
} from '@genshin-optimizer/gi/ui'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import { Button, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type KqmCardView,
  kqmCardFileName,
  kqmMembersStats,
  readKqmCardView,
  writeKqmCardView,
} from '../kqmTeamCard'
import { Segmented } from '../ui'
import { compareCardData, compareCardRecord } from './compareCardData'
import type { Side } from './sides'
import { type SidePair, versionComparison } from './versionCompare'

/*
 * juanlab: the comparison card in the versions panel: the original (A) against the team open (B),
 * or, on the original's page, the version picked
 */

/** A team of the family as the button needs it */
export interface CompareCandidate {
  id: string
  name: string
  /** Its last KQM run is for its settings, rotation and members now */
  fresh: boolean
  /** It has a KQM run at all */
  hasRun: boolean
}

/**
 * "Comparison card": the original against the team open (a version), or on the original's page
 * against a version picked from a menu. A team whose run is missing or out of date can't be picked.
 */
export function VersionCompareButton({
  rootId,
  teamId,
  original,
  versions,
}: {
  rootId: string
  /** The team open */
  teamId: string
  original: CompareCandidate
  versions: CompareCandidate[]
}) {
  const { t } = useTranslation('juanlab')
  const [menu, setMenu] = useState<HTMLElement>()
  const [comparing, setComparing] = useState<string>()
  const ready = (c: CompareCandidate) => c.hasRun && c.fresh
  const onOriginal = teamId === rootId
  const current = versions.find((v) => v.id === teamId)
  // (why it can't be made now; empty: it can)
  const blocked = !versions.length
    ? t('versionsCompare.needVersion')
    : !ready(original)
      ? t('versionsCompare.needRunOriginal')
      : !onOriginal && current && !ready(current)
        ? t('versionsCompare.needRunCurrent')
        : onOriginal && !versions.some(ready)
          ? t('versionsCompare.needRunVersion')
          : ''
  const button = (
    <Button
      size="small"
      variant="outlined"
      startIcon={<ImageOutlinedIcon />}
      disabled={!!blocked}
      onClick={(e) =>
        onOriginal ? setMenu(e.currentTarget) : setComparing(teamId)
      }
      sx={{ minHeight: 34, flexShrink: 0 }}
    >
      {t('kqmCompare.card.create')}
    </Button>
  )
  return (
    <>
      <Tooltip
        arrow
        title={blocked || t('versionsCompare.tip')}
        disableInteractive
      >
        {/* (a disabled button still shows why) */}
        <span>{button}</span>
      </Tooltip>
      <Menu
        anchorEl={menu}
        open={!!menu}
        onClose={() => setMenu(undefined)}
      >
        {versions.map((v) => (
          <MenuItem
            key={v.id}
            disabled={!ready(v)}
            onClick={() => {
              setMenu(undefined)
              setComparing(v.id)
            }}
          >
            <ListItemText
              primary={v.name}
              secondary={
                ready(v)
                  ? undefined
                  : v.hasRun
                    ? t('versionsCompare.stale')
                    : t('versionsCompare.notRun')
              }
            />
          </MenuItem>
        ))}
      </Menu>
      {comparing && (
        <VersionCompareDialog
          rootId={rootId}
          teamId={comparing}
          onClose={() => setComparing(undefined)}
        />
      )}
    </>
  )
}

/**
 * A side's members' stats out of combat: each one's build and constellation, the run's KQM talents
 * (a member whose stats fail to compute: none, see `kqmMembersStats`)
 */
const sideStats = (database: ArtCharDatabase, side: Side, talent: number) =>
  kqmMembersStats(database, side.members, talent)

function VersionCompareDialog({
  rootId,
  teamId,
  onClose,
}: {
  rootId: string
  teamId: string
  onClose: () => void
}) {
  const { t, i18n } = useTranslation([
    'juanlab',
    'page_team',
    'charNames_gen',
    'weaponNames_gen',
    'artifactNames_gen',
    // (the detailed card's stat names)
    'keymap',
  ])
  const { gender } = useDBMeta()
  const database = useDatabase()
  const teamName = database.teams.get(rootId)?.name ?? ''
  // (read once, when it opens: the saved results as they are)
  const compared = useMemo(
    () => versionComparison(database, rootId, teamId, { i18n, gender }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [database, rootId, teamId, gender]
  )
  // (the usual card, or with each member's stats; the last pick, in this browser, as the team card)
  const [view, setViewState] = useState<KqmCardView>(readKqmCardView)
  const setView = (v: KqmCardView) => {
    setViewState(v)
    writeKqmCardView(v)
  }
  const ok = 'a' in compared ? compared : undefined
  // (worked out once per view; both at A's run's KQM talents, both halves or none)
  const stats = useMemo(() => {
    if (view !== 'detailed' || !ok) return undefined
    const talent = ok.a.talents ?? KQM_TALENT_DEFAULT
    return {
      statsA: sideStats(database, ok.a, talent),
      statsB: sideStats(database, ok.b, talent),
    }
  }, [view, database, ok])
  const data = useMemo(
    () =>
      ok &&
      compareCardData(ok.a, ok.b, {
        teamName,
        pairs: ok.pairs,
        gender,
        locale: i18n.language,
        t: t as unknown as TFunction,
        ...stats,
      }),
    [ok, gender, t, teamName, i18n.language, stats]
  )
  const render = useMemo(
    () => () => (data ? renderKqmCompareCard(data) : Promise.reject()),
    [data]
  )
  if (!ok || !data) return null
  const pairs: readonly SidePair[] = ok.pairs
  // (the hidden record of how it was made, as KQM Theorycrafting's pictures carry theirs)
  const watermark = () =>
    compareCardRecord({
      teamId,
      teamName,
      gender,
      pairs,
      a: ok.a,
      b: ok.b,
      view,
    })
  return (
    <CardImageDialog
      title={t('kqmCompare.card.title')}
      alt={t('kqmCompare.card.alt', { team: data.name })}
      fileName={kqmCardFileName(`KQM-Compare-${safeName(data.name)}`, view)}
      // (the detailed card is taller: its own height; the usual one as ever)
      aspectRatio={`${KQM_COMPARE_CARD_WIDTH} / ${view === 'detailed' ? kqmCompareCardHeight(data) : KQM_COMPARE_CARD_HEIGHT}`}
      render={render}
      watermark={watermark}
      header={
        <Segmented<KqmCardView>
          size="small"
          value={view}
          aria-label={t('page_team:teamOpt.card.view.label')}
          options={[
            {
              value: 'normal',
              label: t('page_team:teamOpt.card.view.normal'),
            },
            {
              value: 'detailed',
              label: t('page_team:teamOpt.card.view.detailed'),
            },
          ]}
          onChange={setView}
        />
      }
      onClose={onClose}
    />
  )
}
