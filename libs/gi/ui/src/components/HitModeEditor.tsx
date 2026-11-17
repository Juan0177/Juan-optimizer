import { iconInlineProps } from '@genshin-optimizer/common/svgicons'
import { SolidToggleButtonGroup, SqBadge } from '@genshin-optimizer/common/ui'
import type {
  AdditiveReactionKey,
  AmpReactionKey,
  ElementKey,
} from '@genshin-optimizer/gi/consts'
import {
  allAmpReactionKeys,
  allHitModeKeys,
  allowedAdditiveReactions,
  allowedAmpReactions,
} from '@genshin-optimizer/gi/consts'
import { TeamCharacterContext, useDatabase } from '@genshin-optimizer/gi/db-ui'
import { Translate } from '@genshin-optimizer/gi/i18n'
import {
  CryoIcon,
  ElectroIcon,
  HydroIcon,
  PyroIcon,
} from '@genshin-optimizer/gi/svgicons'
import { infusionNode, uiInput as input } from '@genshin-optimizer/gi/wr'
import type { ToggleButtonGroupProps } from '@mui/material'
import { ToggleButton } from '@mui/material'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { DataContext } from '../context'
import { AdditiveReactionModeText } from './AdditiveReactionModeText'
import { AmpReactionModeText } from './AmpReactionModeText'

export const infusionVals = {
  '': (
    <span>
      <Translate ns="ui" key18="infusion.none" />
    </span>
  ),
  pyro: (
    <span>
      <PyroIcon {...iconInlineProps} /> <SqBadge>Bennett C6</SqBadge>{' '}
      <Translate ns="char_Bennett_gen" key18="constellation6.name" />
    </span>
  ),
  cryo: (
    <span>
      <CryoIcon {...iconInlineProps} />{' '}
      <SqBadge>
        Chongyun <Translate ns="ui" key18="infusion.skill" />
      </SqBadge>{' '}
      <Translate ns="char_Chongyun_gen" key18="skill.name" />
    </span>
  ),
  hydro: (
    <span>
      <HydroIcon {...iconInlineProps} />{' '}
      <SqBadge>
        Candace <Translate ns="ui" key18="infusion.burst" />
      </SqBadge>{' '}
      <Translate ns="char_Candace_gen" key18="burst.name" />
    </span>
  ),
  electro: (
    <span>
      <ElectroIcon {...iconInlineProps} />{' '}
      <SqBadge>
        Somnia <Translate ns="ui" key18="infusion.burst" />
      </SqBadge>{' '}
      <Translate ns="char_Somnia" key18="burst.name" />
    </span>
  ),
}

type ReactionToggleProps = Omit<ToggleButtonGroupProps, 'color'> & {
  /** The quiet toggle style (see `SolidToggleButtonGroup`) */
  quiet?: boolean
}
export function ReactionToggle({
  quiet = false,
  ...props
}: ReactionToggleProps) {
  const { t } = useTranslation('page_character')
  const {
    teamCharId,
    teamChar: { reaction },
  } = useContext(TeamCharacterContext)
  const database = useDatabase()
  const { data } = useContext(DataContext)
  const charEleKey = data.get(input.charEle).value as ElementKey
  const infusion = data.get(infusionNode).value as ElementKey
  const reactions = [
    ...new Set([
      ...(allowedAmpReactions[charEleKey] ?? []),
      ...(allowedAmpReactions[infusion] ?? []),
      ...(allowedAdditiveReactions[charEleKey] ?? []),
      ...(allowedAdditiveReactions[infusion] ?? []),
    ]),
  ]
  return (
    <SolidToggleButtonGroup
      exclusive
      baseColor="secondary"
      quiet={quiet}
      value={reaction || ''}
      // null: the selected one was clicked again; one of them stays selected
      onChange={(_, reaction) =>
        reaction !== null && database.teamChars.set(teamCharId, { reaction })
      }
      disabled={!teamCharId}
      {...props}
    >
      {/* the classic style disables the selected one; the quiet style keeps it looking selected */}
      <ToggleButton value="" disabled={!quiet && !reaction}>
        {t('noReaction')}
      </ToggleButton>
      {reactions.map((rm) => (
        <ToggleButton key={rm} value={rm} disabled={!quiet && reaction === rm}>
          {([...allAmpReactionKeys] as string[]).includes(rm) ? (
            <AmpReactionModeText reaction={rm as AmpReactionKey} />
          ) : (
            <AdditiveReactionModeText reaction={rm as AdditiveReactionKey} />
          )}
        </ToggleButton>
      ))}
    </SolidToggleButtonGroup>
  )
}
type HitModeToggleProps = Omit<ToggleButtonGroupProps, 'color'> & {
  /** The quiet toggle style (see `SolidToggleButtonGroup`) */
  quiet?: boolean
}
export function HitModeToggle({ quiet = false, ...props }: HitModeToggleProps) {
  const { t } = useTranslation('page_character')
  const {
    teamCharId,
    teamChar: { hitMode = 'avgHit' },
  } = useContext(TeamCharacterContext)
  const database = useDatabase()
  return (
    <SolidToggleButtonGroup
      exclusive
      baseColor="secondary"
      quiet={quiet}
      value={hitMode}
      onChange={(_, hitMode) =>
        hitMode !== null && database.teamChars.set(teamCharId, { hitMode })
      }
      disabled={!teamCharId}
      {...props}
    >
      {allHitModeKeys.map((hm) => (
        <ToggleButton key={hm} value={hm} disabled={!quiet && hitMode === hm}>
          {t(`hitmode.${hm}`)}
        </ToggleButton>
      ))}
    </SolidToggleButtonGroup>
  )
}
