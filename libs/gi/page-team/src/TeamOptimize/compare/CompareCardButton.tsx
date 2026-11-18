import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type { KqmMemberStats } from '@genshin-optimizer/gi/ui'
import {
  CardImageDialog,
  KQM_COMPARE_CARD_HEIGHT,
  KQM_COMPARE_CARD_WIDTH,
  KQM_TALENT_DEFAULT,
  kqmCompareCardHeight,
  kqmOutOfCombatStats,
  renderKqmCompareCard,
  safeName,
} from '@genshin-optimizer/gi/ui'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import { Button } from '@mui/material'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type KqmCardView,
  readKqmCardView,
  writeKqmCardView,
} from '../kqmTeamCard'
import { Segmented } from '../ui'
import { compareCardData, compareCardRecord } from './compareCardData'
import type { Side } from './compareSwapKqm'

type CardProps = {
  teamId: string
  a: Side
  b: Side
  out: CharacterKey
  inKey: CharacterKey
  /** The copy of the database team B was computed on (its members' stats are read there) */
  sandbox?: ArtCharDatabase
}

/** "Create card": the comparison as a picture to copy or download (writes nothing) */
export function CompareCardButton({
  disabled,
  ...props
}: CardProps & {
  /** Off while the result is for settings changed since */
  disabled?: boolean
}) {
  const { t } = useTranslation('juanlab')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<ImageOutlinedIcon />}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {t('kqmCompare.card.create')}
      </Button>
      {open && <CompareCardDialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * A side's members' stats out of combat, on the database it was computed on: each one's build and
 * constellation, the run's KQM talents
 */
function sideStats(database: ArtCharDatabase, side: Side, talent: number) {
  const stats: Partial<Record<CharacterKey, KqmMemberStats>> = {}
  for (const m of side.members) {
    const s =
      m.build &&
      kqmOutOfCombatStats(database, m.key, m.build, {
        constellation: m.constellation,
        talent,
      })
    if (s) stats[m.key] = s
  }
  return stats
}

function CompareCardDialog({
  teamId,
  a,
  b,
  out,
  inKey,
  sandbox,
  onClose,
}: CardProps & { onClose: () => void }) {
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
  const teamName = database.teams.get(teamId)?.name ?? ''
  // (the usual card, or with each member's stats; the last pick, in this browser, as the team card)
  const [view, setViewState] = useState<KqmCardView>(readKqmCardView)
  const setView = (v: KqmCardView) => {
    setViewState(v)
    writeKqmCardView(v)
  }
  // (worked out once per view and comparison, not again when the language changes; A's on the
  // user's database, B's on its sandbox; both at A's run's KQM talents. Both halves or none)
  const stats = useMemo(() => {
    if (view !== 'detailed' || !sandbox) return undefined
    const talent = a.talents ?? KQM_TALENT_DEFAULT
    return {
      statsA: sideStats(database, a, talent),
      statsB: sideStats(sandbox, b, talent),
    }
  }, [view, database, sandbox, a, b])
  const data = useMemo(
    () =>
      compareCardData(a, b, {
        teamName,
        out,
        in: inKey,
        gender,
        locale: i18n.language,
        t: t as unknown as TFunction,
        ...stats,
      }),
    [a, b, out, inKey, gender, t, teamName, i18n.language, stats]
  )
  const render = useMemo(() => () => renderKqmCompareCard(data), [data])
  // (the hidden record of how it was made, as KQM Theorycrafting's pictures carry theirs)
  const watermark = () =>
    compareCardRecord({ teamId, teamName, gender, out, inKey, a, b, view })
  return (
    <CardImageDialog
      title={t('kqmCompare.card.title')}
      alt={t('kqmCompare.card.alt', { team: data.name })}
      fileName={`KQM-Compare-${safeName(data.name)}`}
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
