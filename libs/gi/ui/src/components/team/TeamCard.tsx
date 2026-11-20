import { useBoolState } from '@genshin-optimizer/common/react-util'
import { BootstrapTooltip, CardThemed } from '@genshin-optimizer/common/ui'
import { artifactDefIcon, weaponAsset } from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
  ElementKey,
  MainStatKey,
} from '@genshin-optimizer/gi/consts'
import { getCharLevelString } from '@genshin-optimizer/gi/consts'
import type { ArtifactData, ICachedWeapon } from '@genshin-optimizer/gi/db'
import {
  useCharacter,
  useDatabase,
  useDBMeta,
  useTeam,
  useTeamChar,
} from '@genshin-optimizer/gi/db-ui'
import {
  getCharEle,
  getCharStat,
  getWeaponStat,
  weaponHasRefinement,
} from '@genshin-optimizer/gi/stats'
import { ElementIcon, StatIcon } from '@genshin-optimizer/gi/svgicons'
import { giTokens } from '@genshin-optimizer/gi/theme'
import AddIcon from '@mui/icons-material/Add'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import {
  alpha,
  Box,
  ButtonBase,
  IconButton,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { Suspense, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { iconAsset } from '../../util'
import {
  ArtifactSetTooltip,
  ArtifactSlotName,
  quickTooltipProps,
} from '../artifact'
import { defaultLoadoutNumber, LoadoutName } from '../character/LoadoutName'
import { CharacterName } from '../character/Trans'
import { WeaponDetails } from '../weapon/WeaponDetails'
import { TeamDelModal } from './TeamDelModal'

/**
 * A team at a glance: its name, then the party as the game shows it. Each member is an item-card
 * tile (rarity background, the large rounded top-right corner, a parchment level strip, element and
 * constellation), with its weapon and artifact sets on one row beneath and its main stats under
 * that. The loadout and build are in the tile's tooltip.
 */
export function TeamCard({
  teamId,
  onClick,
  bgt,
}: {
  teamId: string
  bgt?: 'light' | 'dark'
  onClick: (cid?: CharacterKey) => void
}) {
  const team = useTeam(teamId)!
  const { name, description, loadoutData } = team
  const database = useDatabase()
  const [showDel, onShowDel, onHideDel] = useBoolState()
  const { t } = useTranslation(['page_team', 'page_teams'])
  const deleteLabel = t('page_team:teamSettings.deleteBtn')
  const memberKeys = loadoutData.flatMap((datum) => {
    const key =
      datum?.teamCharId && database.teamChars.get(datum.teamCharId)?.key
    return key ? [key] : []
  })

  return (
    <CardThemed
      bgt={bgt}
      data-team-card=""
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        containerType: 'inline-size',
        transition: 'outline-color 120ms ease',
        // a narrow team card: resonances as icons only
        '@container (max-width: 440px)': {
          '& .tm-res-name': { display: 'none' },
        },
        '&:hover, &:focus-within': { outlineColor: giTokens.hairlineStrong },
        // the delete action only shows where it is wanted (always on touch screens)
        '& .team-card-delete': { opacity: 0, transition: 'opacity 120ms ease' },
        '&:hover .team-card-delete, &:focus-within .team-card-delete': {
          opacity: 1,
        },
        '@media (hover: none)': { '& .team-card-delete': { opacity: 1 } },
      }}
    >
      {/* the team's name opens the team; its description sits under it */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 0.5,
          px: 2,
          pt: 1.5,
          pb: 1.25,
        }}
      >
        <ButtonBase
          onClick={() => onClick()}
          sx={{
            flexGrow: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            textAlign: 'left',
            borderRadius: 1,
            '&:hover .team-card-name': { color: giTokens.goldLight },
            '&.Mui-focusVisible': {
              outline: `2px solid ${giTokens.gold}`,
              outlineOffset: 2,
            },
          }}
        >
          <Typography
            className="team-card-name"
            component="span"
            noWrap
            sx={{
              maxWidth: '100%',
              fontWeight: 650,
              fontSize: '1.125rem',
              lineHeight: 1.35,
              transition: 'color 120ms ease',
            }}
          >
            {name}
          </Typography>
          {!!description && (
            <Typography
              component="span"
              noWrap
              title={description}
              sx={{
                maxWidth: '100%',
                fontSize: '0.8125rem',
                color: 'text.secondary',
              }}
            >
              {description}
            </Typography>
          )}
        </ButtonBase>
        <TeamDelModal
          teamId={teamId}
          show={showDel}
          onHide={onHideDel}
          onDel={(): void => {}}
        />
        <Tooltip title={deleteLabel}>
          <IconButton
            className="team-card-delete"
            size="small"
            onClick={onShowDel}
            aria-label={deleteLabel}
            sx={{
              alignSelf: 'center',
              color: 'text.secondary',
              '&:hover': { color: 'error.main' },
            }}
          >
            <DeleteForeverIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <TeamResonance characterKeys={memberKeys} />
      </Box>
      {/* the party: member cards of one height, tiles aligned at the top */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          alignItems: 'stretch',
          columnGap: 1.25,
          px: 2,
          pb: 2,
        }}
      >
        {loadoutData.map((loadoutDatum, i) => {
          const teamCharId = loadoutDatum?.teamCharId
          const characterKey =
            teamCharId && database.teamChars.get(teamCharId)?.key
          return characterKey ? (
            <Suspense key={`${i}_${teamCharId}`} fallback={<MemberSkeleton />}>
              <Member
                characterKey={characterKey}
                teamId={teamId}
                teamName={name}
                teamCharId={teamCharId}
                onClick={() => onClick(characterKey)}
              />
            </Suspense>
          ) : (
            <EmptySlot
              key={`${i}_empty`}
              label={t('page_teams:card.addMember', 'Add a member')}
              onClick={() => onClick()}
            />
          )
        })}
      </Box>
    </CardThemed>
  )
}

const resonanceByElement: Partial<Record<ElementKey, string>> = {
  pyro: 'FerventFlames',
  hydro: 'SoothingWater',
  cryo: 'ShatteringIce',
  electro: 'HighVoltage',
  anemo: 'ImpetuousWinds',
  geo: 'EnduringRock',
  dendro: 'SprawlingGreenery',
}
/**
 * The party's elemental resonances (a full party of four): two of an element, or four different
 * elements (Protective Canopy). Each is a chip in its element's colour; its effect is the tooltip.
 */
function TeamResonance({ characterKeys }: { characterKeys: CharacterKey[] }) {
  const { t } = useTranslation('elementalResonance_gen')
  if (characterKeys.length < 4) return null
  const tally: Partial<Record<ElementKey, number>> = {}
  for (const key of characterKeys) {
    const ele = getCharEle(key)
    tally[ele] = (tally[ele] ?? 0) + 1
  }
  const elements = Object.keys(tally) as ElementKey[]
  const resonances: { key: string; elements: ElementKey[] }[] =
    elements.length >= 4
      ? [{ key: 'ProtectiveCanopy', elements }]
      : elements
          .filter((ele) => (tally[ele] ?? 0) >= 2 && resonanceByElement[ele])
          .map((ele) => ({
            key: resonanceByElement[ele]!,
            elements: [ele, ele],
          }))
  if (!resonances.length) return null
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.5,
        flexShrink: 0,
        alignSelf: 'center',
      }}
    >
      {resonances.map(({ key, elements }) => {
        const single = new Set(elements).size === 1 ? elements[0] : undefined
        return (
          <BootstrapTooltip
            key={key}
            placement="top"
            disableInteractive
            {...quickTooltipProps}
            title={
              <Box sx={{ maxWidth: 280, py: 0.25 }}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  {t(`${key}.name`)}
                </Typography>
                <Typography
                  sx={{ mt: 0.5, fontSize: '0.8125rem', lineHeight: 1.5 }}
                >
                  {t(`${key}.desc`)}
                </Typography>
              </Box>
            }
          >
            <Box
              data-resonance={key}
              sx={(theme) => {
                const color = single
                  ? theme.palette[single].main
                  : giTokens.parchment
                return {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  height: 26,
                  px: 0.875,
                  borderRadius: '13px',
                  bgcolor: alpha(color, 0.12),
                  border: `1px solid ${alpha(color, 0.28)}`,
                  color: single ? color : giTokens.parchment,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  cursor: 'default',
                }
              }}
            >
              <Box
                component="span"
                sx={{ display: 'flex', fontSize: 14, gap: '1px' }}
              >
                {(single ? [single] : elements).map((ele, i) => (
                  <Box
                    key={`${ele}${i}`}
                    component="span"
                    sx={(theme) => ({
                      display: 'flex',
                      color: theme.palette[ele].main,
                    })}
                  >
                    <ElementIcon
                      ele={ele}
                      iconProps={{ fontSize: 'inherit' }}
                    />
                  </Box>
                ))}
              </Box>
              <span className="tm-res-name">{t(`${key}.name`)}</span>
            </Box>
          </BootstrapTooltip>
        )
      })}
    </Box>
  )
}

/** The game's item-card backgrounds, by rarity */
const rarityBg: Record<number, string> = {
  1: 'linear-gradient(160deg, #4f5864, #838f99)',
  2: 'linear-gradient(160deg, #48575c, #5e966c)',
  3: 'linear-gradient(160deg, #515474, #499fb3)',
  4: 'linear-gradient(160deg, #595482, #b886ca)',
  5: 'linear-gradient(160deg, #695453, #e6ac54)',
}
/** The item card's corners: small, except the large rounded top-right one */
const tileRadius = '7px 26px 7px 7px'
/** The member card around the tile: the same corners, 6px further out */
const cardRadius = '12px 32px 12px 12px'
const strip = { bg: '#e9e5dc', text: '#495366', height: 24 }
const darkChip = 'rgba(8, 8, 10, 0.6)'

/**
 * One member's card: the tile, name, gear and main stats on one raised panel, its base tinted with
 * the member's element, so each member's gear reads as theirs. Clicking anywhere opens the member;
 * the icons have their own tooltips.
 */
const memberCardSx = (accent: string) =>
  ({
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    textAlign: 'left',
    minWidth: 0,
    p: '6px',
    pb: 1.25,
    borderRadius: cardRadius,
    border: `1px solid ${giTokens.hairline}`,
    // juanlab: tinta piatta dell'elemento invece della sfumatura
    // (un colore solo sopra il pannello: tinta uniforme, senza sfumatura)
    backgroundColor: giTokens.panelRaised,
    backgroundImage: `linear-gradient(${alpha(accent, 0.08)}, ${alpha(accent, 0.08)})`,
    boxShadow: '0 1px 0 rgba(255, 255, 255, 0.03) inset',
    transition:
      'border-color 120ms ease, transform 160ms ease, box-shadow 160ms ease',
    containerType: 'inline-size',
    '&:hover': {
      borderColor: alpha(accent, 0.55),
      transform: 'translateY(-2px)',
      boxShadow: `0 10px 24px rgba(0, 0, 0, 0.45), 0 0 0 1px ${alpha(accent, 0.12)}`,
    },
    '&.Mui-focusVisible': {
      outline: `2px solid ${giTokens.gold}`,
      outlineOffset: 2,
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      '&:hover': { transform: 'none' },
    },
    // a narrow card (phones): smaller gear so the weapon and a 2+2 pair still fit on one row
    '@container (max-width: 100px)': {
      '& .tm-weapon': { width: 28, height: 28 },
      '& .tm-set': { width: 22, height: 22 },
      '& .tm-sets > * + *': { ml: '-10px' },
      '& .tm-main': { width: 20, height: 20, fontSize: 13 },
      '& .tm-gear': { gap: '4px' },
      '& .tm-element': { width: 20, height: 20, fontSize: 13, top: 4, left: 4 },
      '& .tm-cons': { fontSize: '0.625rem', lineHeight: '16px', px: 0.5 },
    },
  }) as const

function Member({
  characterKey,
  teamId,
  teamName,
  teamCharId,
  onClick,
}: {
  characterKey: CharacterKey
  teamId: string
  teamName: string
  teamCharId: string
  onClick: () => void
}) {
  const database = useDatabase()
  const character = useCharacter(characterKey)
  const { gender } = useDBMeta()
  const { t } = useTranslation(['page_team', 'page_teams', 'charNames_gen'])
  const { name: loadoutName } = useTeamChar(teamCharId)!
  const loadoutDatum = database.teams.getLoadoutDatum(teamId, teamCharId)!
  const buildName = database.teams.getActiveBuildName(loadoutDatum)
  const weapon = useMemo(
    () => database.teams.getLoadoutWeapon(loadoutDatum),
    [loadoutDatum, database]
  )
  const artifactData = useMemo(
    () => database.teams.getLoadoutArtifactData(loadoutDatum),
    [database, loadoutDatum]
  )
  const element = getCharEle(characterKey)
  const rarity = getCharStat(characterKey).rarity
  // a loadout keeps its default name ("Mitya Loadout") unless the user renamed it
  const customLoadout = defaultLoadoutNumber(loadoutName, characterKey) !== 0
  const sets = setsOf(artifactData)

  return (
    <ButtonBase
      data-member={characterKey}
      onClick={onClick}
      aria-label={t('page_teams:card.openMember', {
        defaultValue: 'Open {{name}} in {{team}}',
        name: t(`charNames_gen:${characterKey}`),
        team: teamName,
      })}
      sx={(theme) => memberCardSx(theme.palette[element].main)}
    >
      <BootstrapTooltip
        placement="top"
        disableInteractive
        {...quickTooltipProps}
        title={
          <MemberSummary
            characterKey={characterKey}
            loadoutName={loadoutName}
            buildName={buildName}
          />
        }
      >
        {/* the tile */}
        <Box
          className="team-member-tile"
          sx={{
            position: 'relative',
            borderRadius: tileRadius,
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
          }}
        >
          <Box
            sx={{
              position: 'relative',
              aspectRatio: '1 / 1',
              background: rarityBg[rarity] ?? rarityBg[4],
            }}
          >
            <Box
              component="img"
              loading="lazy"
              alt=""
              src={iconAsset(characterKey, gender)}
              sx={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                objectPosition: 'bottom',
              }}
            />
            <Box
              aria-hidden
              className="tm-element"
              sx={(theme) => ({
                position: 'absolute',
                top: 6,
                left: 6,
                width: 28,
                height: 28,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: darkChip,
                color: theme.palette[element].main,
                fontSize: 19,
              })}
            >
              <ElementIcon ele={element} iconProps={{ fontSize: 'inherit' }} />
            </Box>
            {character && (
              <Box
                className="tm-cons"
                sx={{
                  position: 'absolute',
                  bottom: 6,
                  right: 6,
                  px: 0.75,
                  borderRadius: '10px',
                  bgcolor: darkChip,
                  color: giTokens.parchment,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  lineHeight: '20px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                C{character.constellation}
              </Box>
            )}
          </Box>
          {/* the element's colour between the art and the level */}
          <Box
            aria-hidden
            sx={(theme) => ({
              height: 3,
              bgcolor: theme.palette[element].main,
            })}
          />
          <Box
            sx={{
              bgcolor: strip.bg,
              color: strip.text,
              textAlign: 'center',
              fontSize: '0.8125rem',
              fontWeight: 700,
              lineHeight: `${strip.height}px`,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {character
              ? t('page_teams:card.level', {
                  defaultValue: 'Lv. {{level}}',
                  level: character.level,
                })
              : '—'}
          </Box>
        </Box>
      </BootstrapTooltip>
      {/* what the member brings */}
      <Box
        sx={{
          pt: 1,
          px: 0.5,
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <Typography
          noWrap
          sx={{ fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.3 }}
        >
          {customLoadout ? (
            <LoadoutName name={loadoutName} characterKey={characterKey} />
          ) : (
            <CharacterName characterKey={characterKey} gender={gender} />
          )}
        </Typography>
        <Box
          className="tm-gear"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
        >
          <BootstrapTooltip
            placement="top"
            disableInteractive
            {...quickTooltipProps}
            title={<WeaponDetails weapon={weapon} />}
          >
            <Box data-weapon="">
              <WeaponThumb weapon={weapon} />
            </Box>
          </BootstrapTooltip>
          {/* a 2+2 pair overlaps a little, so it fits beside the weapon */}
          <Box
            className="tm-sets"
            sx={{ display: 'flex', '& > * + *': { ml: '-8px' } }}
          >
            {sets.map(([set, num]) => (
              <ArtifactSetTooltip key={set} setKey={set} numInSet={num}>
                <Box data-set="">
                  <SetThumb
                    set={set}
                    num={sets.length === 1 ? num : undefined}
                  />
                </Box>
              </ArtifactSetTooltip>
            ))}
          </Box>
        </Box>
        <MainStats mains={artifactData.mains} />
      </Box>
    </ButtonBase>
  )
}

/** The member's sets that count: 4-piece, or each 2-piece */
function setsOf({ setNum = {} }: ArtifactData): [ArtifactSetKey, 2 | 4][] {
  return Object.entries(setNum)
    .filter(([, num]) => num > 1)
    .map(([set, num]) => [set as ArtifactSetKey, num < 4 ? 2 : 4])
}

const weaponSize = 44
const setSize = 38
function WeaponThumb({ weapon }: { weapon: ICachedWeapon }) {
  const rarity = getWeaponStat(weapon.key)?.rarity ?? 1
  return (
    <Box
      className="tm-weapon"
      sx={{
        position: 'relative',
        width: weaponSize,
        height: weaponSize,
        flexShrink: 0,
        borderRadius: '6px 14px 6px 6px',
        background: rarityBg[rarity] ?? rarityBg[1],
      }}
    >
      <Box
        component="img"
        loading="lazy"
        alt=""
        src={weaponAsset(weapon.key, weapon.ascension >= 2)}
        sx={{ width: '100%', height: '100%', display: 'block' }}
      />
      {weaponHasRefinement(weapon.key) && (
        <Badge>{`R${weapon.refinement}`}</Badge>
      )}
    </Box>
  )
}

/** A set's icon; `num` (4 or 2) when it is the member's only set (a 2+2 pair needs no count) */
function SetThumb({ set, num }: { set: ArtifactSetKey; num?: number }) {
  return (
    <Box
      className="tm-set"
      sx={{
        position: 'relative',
        width: setSize,
        height: setSize,
        flexShrink: 0,
        borderRadius: '50%',
        bgcolor: giTokens.panelRaised,
        // a ring in the card's colour keeps an overlapping pair apart
        boxShadow: `0 0 0 2px ${giTokens.panel}`,
      }}
    >
      <Box
        component="img"
        loading="lazy"
        alt=""
        src={artifactDefIcon(set)}
        sx={{ width: '100%', height: '100%', display: 'block' }}
      />
      {num !== undefined && <Badge>{num}</Badge>}
    </Box>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        position: 'absolute',
        right: -5,
        bottom: -4,
        px: 0.5,
        minWidth: 16,
        textAlign: 'center',
        borderRadius: '8px',
        bgcolor: giTokens.inkDeep,
        boxShadow: `0 0 0 1px ${giTokens.hairlineStrong}`,
        color: giTokens.parchment,
        fontSize: '0.6875rem',
        fontWeight: 700,
        lineHeight: '16px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </Box>
  )
}

const mainSlots = ['sands', 'goblet', 'circlet'] as const
/** Sands, goblet and circlet main stats, as the game's stat icons, each with its name on hover */
function MainStats({ mains = {} }: { mains: ArtifactData['mains'] }) {
  const { t } = useTranslation('statKey_gen')
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.5,
        minHeight: 28,
      }}
    >
      {mainSlots.map((slot) => {
        const statKey = mains?.[slot] as MainStatKey | undefined
        if (!statKey) return null
        return (
          <BootstrapTooltip
            key={slot}
            placement="top"
            disableInteractive
            {...quickTooltipProps}
            title={
              <Box sx={{ fontSize: '0.8125rem' }}>
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  <ArtifactSlotName slotKey={slot as ArtifactSlotKey} />
                </Box>{' '}
                {t(statKey)}
              </Box>
            }
          >
            <Box
              className="tm-main"
              sx={{
                width: 28,
                height: 28,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '8px',
                bgcolor: alpha(giTokens.parchment, 0.06),
                color: alpha(giTokens.parchment, 0.85),
                fontSize: 17,
              }}
            >
              <StatIcon statKey={statKey} iconProps={{ fontSize: 'inherit' }} />
            </Box>
          </BootstrapTooltip>
        )
      })}
    </Box>
  )
}

/** The tile's tooltip: who it is, level, constellation, talents, loadout and build */
function MemberSummary({
  characterKey,
  loadoutName,
  buildName,
}: {
  characterKey: CharacterKey
  loadoutName: string
  buildName: string
}) {
  const { t } = useTranslation('page_teams')
  const { gender } = useDBMeta()
  const character = useCharacter(characterKey)
  const row = (label: ReactNode, value: ReactNode) => (
    <Box sx={{ display: 'flex', gap: 1.5, fontSize: '0.8125rem' }}>
      <Box component="span" sx={{ color: 'text.secondary', minWidth: 64 }}>
        {label}
      </Box>
      <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Box>
    </Box>
  )
  return (
    <Box
      sx={{
        minWidth: 200,
        py: 0.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.375,
      }}
    >
      <Typography sx={{ fontWeight: 650, fontSize: '0.9375rem', mb: 0.25 }}>
        <CharacterName characterKey={characterKey} gender={gender} />
      </Typography>
      {character && (
        <>
          {row(
            t('card.levelLabel', 'Level'),
            `${getCharLevelString(character.level, character.ascension)}, C${character.constellation}`
          )}
          {row(
            t('card.talents', 'Talents'),
            `${character.talent.auto} / ${character.talent.skill} / ${character.talent.burst}`
          )}
        </>
      )}
      {row(
        t('card.loadout', 'Loadout'),
        <LoadoutName name={loadoutName} characterKey={characterKey} />
      )}
      {row(t('card.build', 'Build'), buildName)}
    </Box>
  )
}

function EmptySlot({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={label}
      sx={{
        ...memberCardSx(giTokens.parchment),
        borderStyle: 'dashed',
        borderColor: giTokens.hairlineStrong,
        background: 'transparent',
      }}
    >
      <Box
        sx={{
          borderRadius: tileRadius,
          color: 'text.secondary',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{ aspectRatio: '1 / 1', display: 'grid', placeItems: 'center' }}
        >
          <AddIcon />
        </Box>
        <Box sx={{ height: strip.height + 3 }} />
      </Box>
    </ButtonBase>
  )
}

function MemberSkeleton() {
  return (
    <Box>
      <Skeleton
        variant="rectangular"
        sx={{
          aspectRatio: '1 / 1.2',
          height: 'auto',
          borderRadius: tileRadius,
        }}
      />
      <Skeleton variant="text" sx={{ mt: 1 }} />
      <Skeleton variant="text" width="60%" />
    </Box>
  )
}
