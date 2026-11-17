import { ColorText, ImgIcon } from '@genshin-optimizer/common/ui'
import { range } from '@genshin-optimizer/common/util'
import {
  artifactDefIcon,
  characterAsset,
  imgAssets,
  weaponAsset,
} from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { Translate } from '@genshin-optimizer/gi/i18n'
import { getCharSheet } from '@genshin-optimizer/gi/sheets'
import type { CalcResult, UIData } from '@genshin-optimizer/gi/uidata'
import type { DisplaySub } from '@genshin-optimizer/gi/wr'
import { input } from '@genshin-optimizer/gi/wr'
import BarChartIcon from '@mui/icons-material/BarChart'
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize'
import GroupsIcon from '@mui/icons-material/Groups'
import { Box } from '@mui/material'
import type { ReactNode } from 'react'
import { ArtifactSetName, WeaponName } from '../components'

const errHeader = {
  title: (
    <ColorText color="warning">
      <Translate ns="ui" key18="displayHeader.error" />
    </ColorText>
  ),
}

const talentKeys = [
  'normal',
  'charged',
  'plunging',
  'skill',
  'burst',
  'passive',
  'passive1',
  'passive2',
  'passive3',
  ...range(1, 6).map((i) => `constellation${i}`),
]
/** The talent's short name in a section header ("Normal Atk.", "Const. 1"), in the site's language */
const talentMap = Object.fromEntries(
  talentKeys.map((k) => [
    k,
    <Translate key={k} ns="ui" key18={`displayHeader.talent.${k}`} />,
  ])
) as Record<string, ReactNode>
const headerTitle = (key: string) => (
  <Translate ns="ui" key18={`displayHeader.${key}`} />
)

export function getDisplayHeader(
  data: UIData,
  sectionKey: string,
  database: ArtCharDatabase
): {
  title: ReactNode
  icon?: ReactNode
  action?: ReactNode
} {
  if (!sectionKey) return errHeader
  if (sectionKey === 'basic') return { title: headerTitle('basic') }
  if (sectionKey === 'character') return { title: headerTitle('character') }
  if (sectionKey === 'bonusStats')
    return { title: headerTitle('bonusStats'), icon: <BarChartIcon /> }
  if (sectionKey === 'custom')
    return {
      title: headerTitle('custom'),
      icon: <DashboardCustomizeIcon />,
    }
  if (sectionKey === 'teamBuff')
    return { title: headerTitle('teamBuff'), icon: <GroupsIcon /> }
  else if (sectionKey === 'reaction') return { title: headerTitle('reaction') }
  else if (sectionKey === 'nicole')
    return {
      title: headerTitle('nicole'),
      icon: (
        <Box
          component="img"
          src={characterAsset('Nicole', 'burst')}
          width="2em"
          height="auto"
        />
      ),
    }
  else if (sectionKey === 'moonsign')
    return {
      title: headerTitle('moonsign'),
      icon: (
        <Box display="flex">
          <Box
            component="img"
            src={imgAssets.resonance.moonsign}
            width="2em"
            height="auto"
          />
          <Box
            component="img"
            src={imgAssets.resonance.moonsign}
            width="2em"
            height="auto"
          />
        </Box>
      ),
    }
  else if (sectionKey.includes(':')) {
    const [namespace, key] = sectionKey.split(':')
    if (namespace === 'artifact') {
      return {
        title: <ArtifactSetName setKey={key as ArtifactSetKey} />,
        icon: <ImgIcon size={2} src={artifactDefIcon(key as ArtifactSetKey)} />,
      }
    } else if (namespace === 'weapon') {
      const asc = data.get(input.weapon.asc).value
      return {
        title: <WeaponName weaponKey={key as WeaponKey} />,
        icon: (
          <ImgIcon size={2} src={weaponAsset(key as WeaponKey, asc >= 2)} />
        ),
      }
    }
  } else {
    const cKey = data.get(input.charKey).value
    if (!cKey) return errHeader
    const sheet = getCharSheet(cKey as CharacterKey, database.gender)
    const talentKey = ['normal', 'charged', 'plunging'].includes(sectionKey)
      ? 'auto'
      : sectionKey
    const talent = sheet?.getTalentOfKey(talentKey as any)
    if (!talent) return errHeader
    const actionText = talentMap[sectionKey]
    return {
      icon: <ImgIcon size={2} src={talent.img} />,
      title: talent.name,
      action: actionText,
    }
  }
  return errHeader
}

type DisplaySections = Array<[key: string, results: DisplaySub<CalcResult>]>
/**
 * Use this function to reorganize the sections to have basic stats, custom at the beginning, and reaction at the end.
 * @param data
 * @returns
 */
export function getDisplaySections(data: UIData): DisplaySections {
  const display = data.getDisplay()
  const teamBuff = data.getTeamBuff()
  const sections = Object.entries(display)
  const basic = sections.filter(([k]) => k === 'basic')
  const reaction = sections.filter(([k]) => k === 'reaction')
  const custom = sections.filter(([k]) => k === 'custom')
  // Show multi-target always
  if (custom.length === 0) custom.push(['custom', {}])
  const moonsign = sections.filter(([k]) => k === 'moonsign')
  const weapon = sections.filter(([k]) => k.startsWith('weapon'))
  const artifact = sections.filter(([k]) => k.startsWith('artifact'))
  const rest = sections.filter(
    ([k]) =>
      k !== 'basic' &&
      k !== 'reaction' &&
      !k.startsWith('weapon') &&
      !k.startsWith('artifact') &&
      k !== 'custom' &&
      k !== 'moonsign'
  )
  return [
    ...basic,
    ['character', data.getCharacterStats()],
    ['bonusStats', data.getBonusStats()],
    ...moonsign,
    ...reaction,
    ...custom,
    ...rest,
    ...weapon,
    ...artifact,
    [
      'teamBuff',
      [
        ...Object.values(teamBuff.total ?? {}),
        ...Object.values(teamBuff.premod ?? {}),
        ...Object.values(teamBuff.enemy ?? {}),
      ],
    ],
  ] as DisplaySections
}
