import { PageHeader } from '@genshin-optimizer/common/ui'
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  TeamLinkMember,
  TeamLinkProblem,
  TeamLinkTeam,
} from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  CharacterName,
  decodeTeamLink,
  readTeamLink,
  TEAM_LINK_PARAM,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import { alpha, Box, Button, Link, Typography } from '@mui/material'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Link as RouterLink,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import { MemberAvatar } from './TeamOptimize/MemberAvatar'
import {
  hairline,
  insetSx,
  numSx,
  Panel,
  tokens,
  type,
} from './TeamOptimize/ui'
import { importTeamFromLink } from './teamLinkApply'

/**
 * A team link opened (`#/teams/import?data=…`, from another site's button): what it holds, each
 * team as it will be added, what is wrong with it, and Import. Nothing is saved until Import, and
 * then only as new teams: the player's teams, characters and gear stay as they are.
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
        maxWidth: 880,
        mx: 'auto',
        width: '100%',
      }}
    >
      <PageHeader title={t('teamLink.title', 'Import a team')} />
      {!link || fatal ? (
        <Panel>
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
            <ErrorOutlineRoundedIcon sx={{ color: 'error.main', mt: 0.25 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography sx={type.body}>
                {fatal
                  ? problemText(t, fatal)
                  : t(
                      'teamLink.none',
                      'This page opens team links from other sites. Open one from its site’s button, or paste it in Teams › Import.'
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
        </Panel>
      ) : (
        <>
          <Typography sx={{ ...type.body, color: 'text.secondary' }}>
            {link.source?.name || link.source?.url ? (
              <>
                {t('teamLink.from', 'From')}{' '}
                <SourceLink name={link.source.name} url={link.source.url} />
                {'. '}
              </>
            ) : null}
            {t(
              'teamLink.intro',
              'Each team is added as a new team, on the builds below (as theorycraft builds). Run it as it is, or switch it to My builds to optimize your own characters, weapons and artifacts. Nothing you already have is changed.'
            )}
          </Typography>
          {link.teams.map(({ team, name, problems }, i) => (
            <TeamPreview
              key={i}
              team={team}
              name={name}
              problems={problems}
              busy={busy}
              onImport={team ? () => importTeams([team]) : undefined}
              gender={gender}
            />
          ))}
          {importable.length > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                sx={giCtaSx}
                disabled={busy}
                onClick={() => importTeams(importable)}
              >
                {t('teamLink.importAll', {
                  defaultValue: 'Import all {{count}} teams',
                  count: importable.length,
                })}
              </Button>
            </Box>
          )}
          {link.problems.length > 0 && <Problems problems={link.problems} />}
        </>
      )}
    </Box>
  )
}

function SourceLink({ name, url }: { name?: string; url?: string }) {
  if (!url)
    return (
      <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
        {name}
      </Box>
    )
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
      }}
    >
      {name || new URL(url).hostname}
      <OpenInNewRoundedIcon sx={{ fontSize: 14 }} />
    </Link>
  )
}

function TeamPreview({
  team,
  name,
  problems,
  busy,
  onImport,
  gender,
}: {
  team?: TeamLinkTeam
  name?: string
  problems: TeamLinkProblem[]
  busy: boolean
  onImport?: () => void
  gender: 'F' | 'M'
}) {
  const { t } = useTranslation('page_team')
  return (
    <Panel
      title={
        team?.name ??
        name ??
        t('teamLink.unreadable', 'A team that cannot be imported')
      }
      actions={
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {team?.url && (
            <Link
              href={team.url}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                ...type.label,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.25,
              }}
            >
              {t('teamLink.original', 'Original')}
              <OpenInNewRoundedIcon sx={{ fontSize: 14 }} />
            </Link>
          )}
          {onImport && (
            <Button sx={giCtaSx} disabled={busy} onClick={onImport}>
              {busy
                ? t('teamLink.importing', 'Importing…')
                : t('teamLink.import', 'Import team')}
            </Button>
          )}
        </Box>
      }
    >
      {team && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
              },
              gap: 1,
            }}
          >
            {team.members.map((member) => (
              <MemberRow
                key={member.characterKey}
                member={member}
                gender={gender}
              />
            ))}
          </Box>
          {team.rotation && (
            <Box>
              <Typography sx={{ ...type.label, mb: 0.5 }}>
                {t('teamLink.rotation', 'Rotation')}
              </Typography>
              <Box
                component="pre"
                sx={{
                  ...insetSx,
                  m: 0,
                  px: 1.25,
                  py: 1,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 160,
                  overflowY: 'auto',
                }}
              >
                {team.rotation.opener && (
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    {t('teamLink.opener', 'Opener')}: {team.rotation.opener}
                    {'\n'}
                  </Box>
                )}
                {team.rotation.text}
              </Box>
            </Box>
          )}
          <Facts team={team} />
        </Box>
      )}
      {problems.length > 0 && <Problems problems={problems} />}
    </Panel>
  )
}

function MemberRow({
  member,
  gender,
}: {
  member: TeamLinkMember
  gender: 'F' | 'M'
}) {
  const { t } = useTranslation('page_team')
  const { build } = member
  const sets = Object.entries(build?.sets ?? {}) as [ArtifactSetKey, number][]
  return (
    <Box
      sx={{
        ...insetSx,
        display: 'flex',
        gap: 1.25,
        alignItems: 'center',
        px: 1.25,
        py: 1,
        minWidth: 0,
      }}
    >
      <MemberAvatar characterKey={member.characterKey} size={40} />
      <Box
        sx={{
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
        }}
      >
        <Typography sx={{ ...type.body, fontWeight: 600 }} noWrap>
          <CharacterName characterKey={member.characterKey} gender={gender} />
          <Box component="span" sx={{ ...type.label, ...numSx, ml: 0.75 }}>
            C{member.constellation} · {member.talent.auto}/{member.talent.skill}
            /{member.talent.burst}
            {member.level !== 90 ? ` · Lv. ${member.level}` : ''}
          </Box>
        </Typography>
        <Typography sx={type.label} noWrap>
          {build ? (
            <>
              <WeaponName weaponKey={build.weapon.key} /> R
              {build.weapon.refinement}
              {sets.length > 0 && ' · '}
              {sets.map(([key, n], i) => (
                <span key={key}>
                  {i > 0 && ' + '}
                  <ArtifactSetName setKey={key} /> {n}
                </span>
              ))}
            </>
          ) : (
            t('teamLink.ownGear', 'Your own weapon and artifacts')
          )}
        </Typography>
      </Box>
    </Box>
  )
}

/** The enemy, the extra buffs and the source's own result, when the link has them */
function Facts({ team }: { team: TeamLinkTeam }) {
  const { t } = useTranslation('page_team')
  const facts: string[] = []
  if (team.enemy) {
    const e = team.enemy.enemyOverride
    const res = Object.entries(e)
      .filter(([k]) => k.endsWith('_enemyRes_'))
      .map(([, v]) => v)
    const same = res.every((v) => v === res[0])
    facts.push(
      t('teamLink.enemy', {
        defaultValue: 'Enemy level {{level}}, RES {{res}}',
        level: e.enemyLevel,
        res: same ? `${res[0]}%` : t('teamLink.resMixed', 'by element'),
      })
    )
  }
  if (team.buffs) facts.push(t('teamLink.buffs', 'Extra buffs included'))
  const ref = team.reference
  if (ref?.dps)
    facts.push(
      t('teamLink.reference', {
        defaultValue: 'Their result: {{dps}} DPS',
        dps: Math.round(ref.dps).toLocaleString(),
      })
    )
  if (!facts.length && !ref?.note) return null
  return (
    <Typography sx={{ ...type.label, ...numSx }}>
      {facts.join(' · ')}
      {ref?.note ? `${facts.length ? ' · ' : ''}${ref.note}` : ''}
    </Typography>
  )
}

function Problems({ problems }: { problems: TeamLinkProblem[] }) {
  const { t } = useTranslation('page_team')
  const errors = problems.filter((p) => p.level === 'error')
  const warnings = problems.filter((p) => p.level === 'warning')
  return (
    <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {errors.map((p, i) => (
        <Box
          key={`e${i}`}
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
        <Box component="details" sx={{ borderTop: hairline, pt: 0.75 }}>
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
            {warnings.map((p, i) => (
              <Typography component="li" key={`w${i}`} sx={type.label}>
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
