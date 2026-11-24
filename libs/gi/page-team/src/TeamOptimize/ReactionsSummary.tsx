import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type { SimulationResult, TeamData } from '@genshin-optimizer/gi/ui'
import { CharacterName } from '@genshin-optimizer/gi/ui'
import { alpha, Box, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HitLabel } from './AttackName'
import { MemberAvatar } from './MemberAvatar'
import type { ReactionEvent } from './reactionEvents'
import { reactionEvents, reactionKind } from './reactionEvents'
import { numSx, Segmented, tokens } from './ui'

/** The English names, the translations' defaults */
const REACTION_DEFAULT: Record<string, string> = {
  melt: 'Melt',
  vaporize: 'Vaporize',
  aggravate: 'Aggravate',
  spread: 'Spread',
  overloaded: 'Overloaded',
  superconduct: 'Superconduct',
  electroCharged: 'Electro-Charged',
  lunarCharged: 'Lunar-Charged',
  frozen: 'Frozen',
  shattered: 'Shattered',
  quicken: 'Quicken',
  burning: 'Burning',
  bloom: 'Bloom',
  lunarBloom: 'Lunar-Bloom',
  crystallize: 'Crystallize',
  lunarCrystallize: 'Lunar-Crystallize',
  moondriftHarmony: 'Moondrift Harmony',
  stellarConduct: 'Stellar-Conduct',
  stellarSwirl: 'Stellar Swirl',
  swirl: 'Swirl',
}

/** A reaction's colour: its own in the palette, else its element's */
export function reactionColor(theme: Theme, reaction: string) {
  const palette = theme.palette as unknown as Record<string, { main: string }>
  return (
    palette[reactionKind(reaction).palette]?.main ?? theme.palette.grey[500]
  )
}

/** A reaction's name, with Melt's and Vaporize's direction ("Melt, forward ×2") */
export function useReactionName() {
  const { t } = useTranslation('page_team')
  return (e: Pick<ReactionEvent, 'reaction' | 'direction'>) => {
    const { key } = reactionKind(e.reaction)
    const name = t(`teamOpt.timeline.reactions.${key}`, {
      defaultValue: REACTION_DEFAULT[key] ?? e.reaction,
    }) as string
    if (!e.direction) return name
    return t(`teamOpt.timeline.reactions.${e.direction}`, {
      defaultValue:
        e.direction === 'forward'
          ? '{{name}}, forward ×2'
          : '{{name}}, reverse ×1.5',
      name,
    }) as string
  }
}

/** Seconds into the rotation, as the timeline's ruler counts them */
export function useReactionSeconds(start: number) {
  const { i18n } = useTranslation()
  return (t: number) =>
    ((t - start) / 60).toLocaleString(i18n?.language ?? 'en', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
}

/**
 * The reactions in the rotation shown: per member, how many of each and when, with the hit that
 * triggers them. By default only the on-field member's own (what the player's character does);
 * "All" adds what the off-field members trigger (Citlali's Frostfall Storm on Mavuika's Pyro).
 */
export function ReactionsSummary({
  sim,
  members,
  teamData,
}: {
  sim: SimulationResult
  members: CharacterKey[]
  teamData: TeamData | undefined
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const [all, setAll] = useState(false)
  const events = useMemo(
    () => reactionEvents(sim, { onFieldOnly: !all }),
    [sim, all]
  )
  const name = useReactionName()
  const seconds = useReactionSeconds(sim.start)
  const byMember = members
    .map((m) => ({
      characterKey: m,
      events: events.filter((e) => e.characterKey === m),
    }))
    .filter((x) => x.events.length)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Segmented
          size="small"
          value={all ? 'all' : 'onField'}
          onChange={(v) => setAll(v === 'all')}
          aria-label={t('teamOpt.timeline.reactions.which', 'Which reactions')}
          options={[
            {
              value: 'onField',
              label: t('teamOpt.timeline.reactions.onField', 'On field'),
              tip: t(
                'teamOpt.timeline.reactions.onFieldTip',
                'The reactions the on-field member triggers with their own hits'
              ),
            },
            {
              value: 'all',
              label: t('teamOpt.timeline.reactions.all', 'All'),
              tip: t(
                'teamOpt.timeline.reactions.allTip',
                'Also the ones off-field members trigger while someone else is on the field'
              ),
            },
          ]}
        />
      </Box>
      {!byMember.length ? (
        <Typography variant="caption" color="text.secondary">
          {t(
            'teamOpt.timeline.reactions.none',
            'No reactions in this rotation'
          )}
        </Typography>
      ) : (
        byMember.map(({ characterKey, events }) => {
          // how many of each, forward and reverse apart, in the order they first happen
          const counts = new Map<string, { e: ReactionEvent; n: number }>()
          for (const e of events) {
            const k = `${e.reaction}.${e.direction ?? ''}`
            const c = counts.get(k)
            if (c) c.n++
            else counts.set(k, { e, n: 1 })
          }
          return (
            <Box
              key={characterKey}
              sx={{
                px: 1.5,
                py: 1,
                borderRadius: tokens.radius.inset,
                bgcolor: tokens.inset,
                border: `1px solid ${tokens.hairline}`,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1,
                  pb: 0.75,
                }}
              >
                <MemberAvatar characterKey={characterKey} size={22} />
                <Typography sx={{ fontSize: 14, fontWeight: 650 }}>
                  <CharacterName characterKey={characterKey} gender={gender} />
                </Typography>
                {[...counts.values()].map(({ e, n }) => (
                  <Box
                    key={`${e.reaction}.${e.direction ?? ''}`}
                    component="span"
                    sx={(theme) => {
                      const color = reactionColor(theme, e.reaction)
                      return {
                        px: 0.75,
                        borderRadius: 1,
                        fontSize: 12,
                        fontWeight: 650,
                        lineHeight: '20px',
                        whiteSpace: 'nowrap',
                        color,
                        bgcolor: alpha(color, 0.14),
                        boxShadow: `inset 0 0 0 1px ${alpha(color, 0.4)}`,
                        ...numSx,
                      }
                    }}
                  >
                    {name(e)} · {n}
                  </Box>
                ))}
              </Box>
              <Box
                component="ol"
                sx={{
                  m: 0,
                  p: 0,
                  listStyle: 'none',
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                  columnGap: 1.25,
                  rowGap: 0.25,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                {events.map((e, i) => (
                  <Box component="li" key={i} sx={{ display: 'contents' }}>
                    <Box
                      component="span"
                      sx={{
                        ...numSx,
                        color: 'text.secondary',
                        textAlign: 'right',
                      }}
                    >
                      {seconds(e.t)} s
                    </Box>
                    <Box
                      component="span"
                      sx={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.label && e.path ? (
                        <HitLabel
                          label={e.label}
                          data={teamData?.[characterKey]?.target}
                          path={e.path}
                        />
                      ) : (
                        (e.label ?? '')
                      )}
                      {all && e.onField && e.onField !== characterKey && (
                        <Box
                          component="span"
                          sx={{ color: 'text.secondary', fontSize: 11.5 }}
                        >
                          {' · '}
                          {t(
                            'teamOpt.timeline.reactions.offField',
                            'off field, on field:'
                          )}{' '}
                          <CharacterName
                            characterKey={e.onField}
                            gender={gender}
                          />
                        </Box>
                      )}
                    </Box>
                    <Box
                      component="span"
                      sx={(theme) => ({
                        color: reactionColor(theme, e.reaction),
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      })}
                    >
                      {name(e)}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )
        })
      )}
    </Box>
  )
}
