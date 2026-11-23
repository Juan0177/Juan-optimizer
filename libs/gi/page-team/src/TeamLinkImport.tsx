import { PageHeader } from '@genshin-optimizer/common/ui'
import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  RotationMember,
  RotationStep,
  TeamLinkMember,
  TeamLinkProblem,
  TeamLinkTeam,
} from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  decodeTeamLink,
  parseRotation,
  readTeamLink,
  TEAM_LINK_PARAM,
  teamLinkBuildTc,
} from '@genshin-optimizer/gi/ui'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import {
  alpha,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Link,
  Tooltip,
  Typography,
} from '@mui/material'
import type { TFunction } from 'i18next'
import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Link as RouterLink,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import { mainStatLabel } from './TeamOptimize/format'
import { MemberAvatar } from './TeamOptimize/MemberAvatar'
import { laneColor } from './TeamOptimize/RotationTimeline'
import { memberNamesOf } from './TeamOptimize/RotationWriter'
import { TcBuildGear } from './TeamOptimize/TcBuildGear'
import { hairline, insetSx, numSx, tokens, type } from './TeamOptimize/ui'
import { importTeamFromLink } from './teamLinkApply'

/**
 * A team link opened (`#/teams/import?data=…`, from another site's button): each team as it will
 * be added, what is wrong with it, and Import. Nothing is saved until Import, and then only as new
 * teams: the player's teams, characters and gear stay as they are.
 */
export function TeamLinkImportPage() {
  const { t, i18n } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const payload = params.get(TEAM_LINK_PARAM) ?? ''
  const link = useMemo(
    () => (payload ? readTeamLink(decodeTeamLink(payload)) : undefined),
    [payload]
  )
  const [busy, setBusy] = useState(false)
  const importable = (link?.teams ?? []).flatMap(({ team }) =>
    team ? [team] : []
  )
  const buildName = link?.source?.name
    ? t('teamLink.buildName', {
        defaultValue: 'From {{source}}',
        source: link.source.name,
      })
    : t('teamLink.buildNameLink', 'From a team link')
  const importTeams = (teams: TeamLinkTeam[]) => {
    setBusy(true)
    // (after the page has shown the busy state: playing the rotations takes a moment)
    requestAnimationFrame(() =>
      setTimeout(() => {
        const ids = teams
          .map((team) =>
            importTeamFromLink(database, team, {
              i18n,
              gender,
              buildName,
              source: link?.source,
            })
          )
          .filter(Boolean)
        // (replaced: going back does not import it again)
        navigate(ids.length === 1 ? `/teams/${ids[0]}/optimize` : '/teams', {
          replace: true,
        })
      })
    )
  }
  const fatal = link?.problems.find((p) => p.level === 'error')

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        maxWidth: 960,
        mx: 'auto',
        width: '100%',
      }}
    >
      <PageHeader
        title={t('teamLink.title', 'Import team')}
        actions={
          importable.length > 1 && !fatal ? (
            <ImportButton
              busy={busy}
              onClick={() => importTeams(importable)}
              label={t('teamLink.importAll', {
                defaultValue: 'Import all {{count}}',
                count: importable.length,
              })}
            />
          ) : undefined
        }
      />
      {!link || fatal ? (
        <Card>
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
            <ErrorOutlineRoundedIcon sx={{ color: 'error.main', mt: 0.25 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography sx={type.body}>
                {fatal
                  ? problemText(t, fatal)
                  : t(
                      'teamLink.none',
                      'Open a team link from its site, or paste one in Teams › Import.'
                    )}
              </Typography>
              <Box>
                <Button
                  component={RouterLink}
                  to="/teams"
                  variant="outlined"
                  color="inherit"
                >
                  {t('teamLink.toTeams', 'Go to Teams')}
                </Button>
              </Box>
            </Box>
          </Box>
        </Card>
      ) : (
        <>
          {(link.source?.name || link.source?.url) && (
            <Box sx={{ mt: -0.5 }}>
              <SourceChip name={link.source.name} url={link.source.url} />
            </Box>
          )}
          {link.teams.map(({ team, name, problems }, i) => (
            <TeamPreview
              key={i}
              team={team}
              name={name}
              problems={problems}
              busy={busy}
              onImport={team ? () => importTeams([team]) : undefined}
              sourceName={link.source?.name}
            />
          ))}
          {link.problems.length > 0 && <Problems problems={link.problems} />}
        </>
      )}
    </Box>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="section"
      sx={{
        bgcolor: tokens.panel,
        border: hairline,
        borderRadius: tokens.radius.panel,
        p: { xs: 1.75, sm: 2.25 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
      }}
    >
      {children}
    </Box>
  )
}

function ImportButton({
  busy,
  onClick,
  label,
}: {
  busy: boolean
  onClick: () => void
  label: string
}) {
  return (
    <Button
      sx={{
        ...giCtaSx,
        minWidth: 128,
        flexShrink: 0,
        width: { xs: '100%', sm: 'auto' },
      }}
      disabled={busy}
      onClick={onClick}
      startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
    >
      {label}
    </Button>
  )
}

/** Where the link came from: a pill, linking back when it has a site */
function SourceChip({ name, url }: { name?: string; url?: string }) {
  const label = name || (url ? new URL(url).hostname : '')
  const sx = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.5,
    px: 1.25,
    py: 0.375,
    borderRadius: tokens.radius.pill,
    border: `1px solid ${giTokens.hairlineStrong}`,
    bgcolor: tokens.raised,
    fontSize: 13,
    fontWeight: 600,
    color: 'text.primary',
    textDecoration: 'none',
  }
  return url ? (
    <Link href={url} target="_blank" rel="noopener noreferrer" sx={sx}>
      {label}
      <OpenInNewRoundedIcon sx={{ fontSize: 13, opacity: 0.7 }} />
    </Link>
  ) : (
    <Box component="span" sx={sx}>
      {label}
    </Box>
  )
}

function TeamPreview({
  team,
  name,
  problems,
  busy,
  onImport,
  sourceName,
}: {
  team?: TeamLinkTeam
  name?: string
  problems: TeamLinkProblem[]
  busy: boolean
  onImport?: () => void
  sourceName?: string
}) {
  const { t, i18n } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const names = useMemo(
    () => (team ? memberNamesOf(team.members, i18n, gender) : []),
    [team, i18n, gender]
  )
  const dps = team?.reference?.dps
  return (
    <Card>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 1.25,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            minWidth: 0,
            flexGrow: 1,
          }}
        >
          <Typography component="h2" sx={{ ...type.step }} noWrap>
            {team?.name ??
              name ??
              t('teamLink.unreadable', 'A team that cannot be imported')}
          </Typography>
          {team?.url && (
            <Tooltip
              title={t('teamLink.original', {
                defaultValue: 'Open on {{source}}',
                source: sourceName || new URL(team.url).hostname,
              })}
            >
              <IconButton
                size="small"
                href={team.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ color: 'text.secondary' }}
              >
                <OpenInNewRoundedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        {dps ? (
          <Box sx={{ textAlign: 'right', lineHeight: 1.1 }}>
            <Typography sx={{ ...type.stat }}>
              {Math.round(dps).toLocaleString()}
            </Typography>
            <Typography sx={{ ...type.label, fontSize: 12 }}>
              {t('teamLink.reference', 'DPS, their result')}
            </Typography>
          </Box>
        ) : null}
        {onImport && (
          <ImportButton
            busy={busy}
            onClick={onImport}
            label={t('teamLink.import', 'Import team')}
          />
        )}
      </Box>
      {team && (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                sm: 'repeat(2, minmax(0, 1fr))',
                md: `repeat(${Math.min(team.members.length, 4)}, minmax(0, 1fr))`,
              },
              gap: 1,
            }}
          >
            {team.members.map((member) => (
              <MemberTile key={member.characterKey} member={member} />
            ))}
          </Box>
          {team.rotation && (
            <RotationRows
              text={team.rotation.text}
              opener={team.rotation.opener}
              names={names}
            />
          )}
          <Facts team={team} />
        </>
      )}
      {problems.length > 0 && <Problems problems={problems} />}
    </Card>
  )
}

/** The order substats read in: crit first, then what most builds care about */
const SUBSTAT_ORDER: readonly SubstatKey[] = [
  'critRate_',
  'critDMG_',
  'atk_',
  'hp_',
  'def_',
  'eleMas',
  'enerRech_',
  'atk',
  'hp',
  'def',
]
const formatStat = (key: string, value: number) =>
  key.endsWith('_')
    ? `${value.toFixed(1)}%`
    : Math.round(value).toLocaleString()

/** A label and its value on one line, the value lined up on the right */
function StatRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode
  label: React.ReactNode
  value?: React.ReactNode
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        minWidth: 0,
        fontSize: 12.5,
        lineHeight: 1.6,
      }}
    >
      {icon}
      <Box
        component="span"
        sx={{
          color: 'text.secondary',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flexGrow: 1,
        }}
      >
        {label}
      </Box>
      {value !== undefined && (
        <Box component="span" sx={{ fontWeight: 600, ...numSx }}>
          {value}
        </Box>
      )}
    </Box>
  )
}

const tileDivider = { borderTop: hairline, pt: 1 } as const
/** A group of stat rows: as many columns as the tile's width fits */
const statGrid = {
  ...tileDivider,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  columnGap: 2,
} as const

/** A member as it comes: portrait and constellation, talents, then its whole build */
function MemberTile({ member }: { member: TeamLinkMember }) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const { build, talent } = member
  const substats = build
    ? SUBSTAT_ORDER.filter((key) => build.substats[key] > 0)
    : []
  return (
    <Box
      sx={{
        ...insetSx,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: 1.25,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <MemberAvatar characterKey={member.characterKey} size={40} />
          <Box
            component="span"
            sx={{
              position: 'absolute',
              right: -4,
              bottom: -2,
              px: 0.5,
              borderRadius: tokens.radius.pill,
              bgcolor: tokens.raised,
              border: `1px solid ${giTokens.hairlineStrong}`,
              fontSize: 10.5,
              fontWeight: 700,
              lineHeight: 1.5,
              ...numSx,
            }}
          >
            C{member.constellation}
          </Box>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ ...type.body, fontWeight: 650 }} noWrap>
            <CharacterName characterKey={member.characterKey} gender={gender} />
          </Typography>
          <Tooltip
            title={t('teamLink.talents', {
              defaultValue:
                'Talents: Normal Attack {{auto}}, Skill {{skill}}, Burst {{burst}}',
              ...talent,
            })}
          >
            <Typography
              component="span"
              sx={{ ...type.label, fontSize: 12, ...numSx }}
            >
              {talent.auto} · {talent.skill} · {talent.burst}
              {member.level !== 90 ? ` · Lv. ${member.level}` : ''}
            </Typography>
          </Tooltip>
        </Box>
      </Box>
      {build ? (
        <>
          <TcBuildGear buildTc={teamLinkBuildTc(member, build)} />
          {!!substats.length && (
            <Box sx={statGrid}>
              {substats.map((key) => (
                <StatRow
                  key={key}
                  label={mainStatLabel(key)}
                  value={formatStat(key, build.substats[key])}
                />
              ))}
            </Box>
          )}
          {member.minEnergyRecharge !== undefined && (
            <Box sx={tileDivider}>
              <StatRow
                label={t('teamLink.minEr', 'Min Energy Recharge')}
                value={`${member.minEnergyRecharge}%`}
              />
            </Box>
          )}
        </>
      ) : (
        <Typography sx={{ ...type.label, fontSize: 12.5, ...tileDivider }}>
          {t('teamLink.ownGear', 'Your own weapon and artifacts')}
        </Typography>
      )}
    </Box>
  )
}

/** The rotation in two rows, the opener (when there is one) and the rotation: one pill a step */
function RotationRows({
  text,
  opener,
  names,
}: {
  text: string
  opener: string
  names: RotationMember[]
}) {
  const { t } = useTranslation('page_team')
  const main = useMemo(() => parseRotation(text, names), [text, names])
  const first = useMemo(
    () => (opener ? parseRotation(opener, names) : undefined),
    [opener, names]
  )
  const nameOf = (ck: string) =>
    names.find((n) => n.characterKey === ck)?.name ?? ck
  const rows = [
    ...(first
      ? [{ label: t('teamLink.opener', 'Opener'), text: opener, parsed: first }]
      : []),
    { label: t('teamLink.rotation', 'Rotation'), text, parsed: main },
  ]
  return (
    <Box
      sx={{
        ...insetSx,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '76px minmax(0, 1fr)' },
        columnGap: 1.5,
        rowGap: { xs: 0.5, sm: 1.25 },
        px: 1.5,
        py: 1.25,
      }}
    >
      {rows.map(({ label, text, parsed }) => (
        <Fragment key={label}>
          <Typography
            sx={{
              ...type.label,
              fontSize: 11,
              fontWeight: 650,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              pt: { sm: 0.5 },
            }}
          >
            {label}
          </Typography>
          {parsed.warnings.length || !parsed.steps.length ? (
            // (what the reader cannot show as steps is shown as written)
            <Box
              component="span"
              sx={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {text}
            </Box>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              {parsed.steps.map((step, i) => {
                const pill = (
                  <StepPill step={step} name={nameOf(step.characterKey)} />
                )
                const last = i === parsed.steps.length - 1
                return (
                  <Fragment key={i}>
                    {i > 0 && (
                      <ChevronRightRoundedIcon
                        sx={{
                          fontSize: 16,
                          color: 'text.secondary',
                          opacity: 0.45,
                        }}
                      />
                    )}
                    {last && parsed.loopsTo ? (
                      // (the loop marker stays on the last step's line)
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pill}
                        <Tooltip
                          title={t('teamLink.loopsTo', {
                            defaultValue: 'Loops back to {{name}}',
                            name: nameOf(parsed.loopsTo),
                          })}
                        >
                          <Box
                            component="span"
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 0.25,
                              ml: 0.5,
                              color: 'text.secondary',
                            }}
                          >
                            <ReplayRoundedIcon sx={{ fontSize: 15 }} />
                            <MemberAvatar
                              characterKey={parsed.loopsTo}
                              size={18}
                            />
                          </Box>
                        </Tooltip>
                      </Box>
                    ) : (
                      pill
                    )}
                  </Fragment>
                )
              })}
            </Box>
          )}
        </Fragment>
      ))}
    </Box>
  )
}

/** One step: who (portrait, in their element's colour; their name on hover), then what */
function StepPill({ step, name }: { step: RotationStep; name: string }) {
  return (
    <Tooltip title={name}>
      <Box
        component="span"
        sx={(theme) => {
          const color = laneColor(theme, step.characterKey)
          return {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.625,
            pl: 0.375,
            pr: 1,
            py: 0.25,
            borderRadius: tokens.radius.pill,
            bgcolor: alpha(color, 0.12),
            border: `1px solid ${alpha(color, 0.32)}`,
          }
        }}
      >
        <MemberAvatar characterKey={step.characterKey} size={20} />
        <Box
          component="span"
          sx={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12.5,
            whiteSpace: 'nowrap',
          }}
        >
          {step.actions.map((a) => a.text).join(' ')}
        </Box>
      </Box>
    </Tooltip>
  )
}

/** What differs from the usual: an enemy other than level 100 at 10% RES, extra buffs, a note */
function Facts({ team }: { team: TeamLinkTeam }) {
  const { t } = useTranslation('page_team')
  const facts: string[] = []
  const e = team.enemy?.enemyOverride
  if (e) {
    const res = Object.entries(e)
      .filter(([k]) => k.endsWith('_enemyRes_'))
      .map(([, v]) => v)
    const same = res.every((v) => v === res[0])
    const usual =
      e.enemyLevel === 100 &&
      same &&
      res[0] === 10 &&
      !e.enemyDefRed_ &&
      !e.enemyDefIgn_
    if (!usual)
      facts.push(
        t('teamLink.enemy', {
          defaultValue: 'Enemy Lv. {{level}}, RES {{res}}',
          level: e.enemyLevel,
          res: same ? `${res[0]}%` : t('teamLink.resMixed', 'by element'),
        })
      )
  }
  if (team.buffs) facts.push(t('teamLink.buffs', 'Extra buffs'))
  if (team.reference?.note) facts.push(team.reference.note)
  if (!facts.length) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {facts.map((fact) => (
        <Box
          key={fact}
          component="span"
          sx={{
            px: 1,
            py: 0.25,
            borderRadius: tokens.radius.pill,
            border: hairline,
            fontSize: 12.5,
            color: 'text.secondary',
            ...numSx,
          }}
        >
          {fact}
        </Box>
      ))}
    </Box>
  )
}

function Problems({ problems }: { problems: TeamLinkProblem[] }) {
  const { t } = useTranslation('page_team')
  const errors = problems.filter((p) => p.level === 'error')
  const warnings = problems.filter((p) => p.level === 'warning')
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {errors.map((p) => (
        <Box
          key={`${p.code}|${p.at}`}
          sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'flex-start',
            px: 1.25,
            py: 0.75,
            borderRadius: tokens.radius.inset,
            bgcolor: (theme) => alpha(theme.palette.error.main, 0.1),
            border: (theme) =>
              `1px solid ${alpha(theme.palette.error.main, 0.35)}`,
          }}
        >
          <ErrorOutlineRoundedIcon
            sx={{ fontSize: 18, color: 'error.main', mt: 0.1 }}
          />
          <Typography sx={type.body}>{problemText(t, p)}</Typography>
        </Box>
      ))}
      {warnings.length > 0 && (
        <Box component="details">
          <Box
            component="summary"
            sx={{ ...type.label, cursor: 'pointer', color: giTokens.goldLight }}
          >
            {t('teamLink.notes', {
              defaultValue_one: '{{count}} note on how it was read',
              defaultValue_other: '{{count}} notes on how it was read',
              count: warnings.length,
            })}
          </Box>
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
            {warnings.map((p) => (
              <Typography
                component="li"
                key={`${p.code}|${p.at}`}
                sx={type.label}
              >
                {problemText(t, p)}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  )
}

/** A problem as a sentence */
export function problemText(
  t: TFunction<'page_team'>,
  p: TeamLinkProblem
): string {
  const values = { value: p.value ?? '', used: p.used ?? '', at: p.at }
  switch (p.code) {
    case 'payload':
      return t(
        'teamLink.problem.payload',
        'This link’s team can’t be read. It may have been cut off when it was copied: open it again from its site.'
      )
    case 'format':
      return t(
        'teamLink.problem.format',
        'This isn’t a Stellar Optimizer team link.'
      )
    case 'version':
      return t('teamLink.problem.version', {
        defaultValue:
          'This link was made for a newer Stellar Optimizer (format version {{value}}). Reload the page to update it, then open the link again.',
        ...values,
      })
    case 'teams':
      return p.level === 'error'
        ? t('teamLink.problem.noTeams', 'The link has no teams in it.')
        : t('teamLink.problem.manyTeams', {
            defaultValue:
              'Only the first {{used}} of its {{value}} teams are shown.',
            ...values,
          })
    case 'members':
      return t('teamLink.problem.members', {
        defaultValue: 'A team needs 1 to 4 members ({{at}}).',
        ...values,
      })
    case 'character':
      return p.level === 'error'
        ? t('teamLink.problem.character', {
            defaultValue:
              'Unknown character “{{value}}”: it may be newer than this site.',
            ...values,
          })
        : t('teamLink.problem.buffsFor', {
            defaultValue: 'Buffs for “{{value}}” left out: not in the team.',
            ...values,
          })
    case 'duplicate':
      return t('teamLink.problem.duplicate', {
        defaultValue: '“{{value}}” is in the team twice.',
        ...values,
      })
    case 'weapon':
      return t('teamLink.problem.weapon', {
        defaultValue:
          'Unknown weapon “{{value}}”: it may be newer than this site.',
        ...values,
      })
    case 'weaponType':
      return t('teamLink.problem.weaponType', {
        defaultValue:
          '“{{value}}” is a weapon this character can’t use ({{at}}).',
        ...values,
      })
    case 'set':
      return t('teamLink.problem.set', {
        defaultValue:
          'Unknown artifact set “{{value}}”: it may be newer than this site.',
        ...values,
      })
    case 'setCount':
      return t('teamLink.problem.setCount', {
        defaultValue:
          'The artifact sets don’t fit: {{value}} ({{at}}). Use 2 or 4 of a set, 5 pieces at most.',
        ...values,
      })
    case 'mainStat':
      return t('teamLink.problem.mainStat', {
        defaultValue: '“{{value}}” can’t be the main stat there ({{at}}).',
        ...values,
      })
    case 'stat':
      return t('teamLink.problem.stat', {
        defaultValue: 'Unknown stat “{{value}}” ({{at}}).',
        ...values,
      })
    case 'number':
      return t('teamLink.problem.number', {
        defaultValue: '{{at}}: {{value}} is out of range, {{used}} used.',
        ...values,
      })
    case 'text':
      return t('teamLink.problem.text', {
        defaultValue:
          '{{at}}: missing or too long (cut to {{used}} characters).',
        ...values,
      })
    case 'url':
      return t('teamLink.problem.url', {
        defaultValue: '{{at}}: left out (only https links are kept).',
        ...values,
      })
    case 'unused':
      return t('teamLink.problem.unused', {
        defaultValue: '{{at}}: not used by this version of Stellar Optimizer.',
        ...values,
      })
  }
}
