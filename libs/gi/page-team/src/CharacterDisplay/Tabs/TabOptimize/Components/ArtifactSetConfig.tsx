import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import {
  CardThemed,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import {
  deepClone,
  deletePropPath,
  evalIfFunc,
  isIn,
  layeredAssignment,
  objKeyMap,
  objPathValue,
} from '@genshin-optimizer/common/util'
import { artifactDefIcon } from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allArtifactSlotKeys,
} from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import {
  allArtifactSetExclusionKeys,
  forcedSet,
  handleArtSetExclusion,
} from '@genshin-optimizer/gi/db'
import {
  TeamCharacterContext,
  useDatabase,
  useOptConfig,
} from '@genshin-optimizer/gi/db-ui'
import { Translate } from '@genshin-optimizer/gi/i18n'
import type { DocumentConditional } from '@genshin-optimizer/gi/sheets'
import { getArtSheet } from '@genshin-optimizer/gi/sheets'
import { getArtSetStat } from '@genshin-optimizer/gi/stats'
import { SlotIcon } from '@genshin-optimizer/gi/svgicons'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { dataContextObj } from '@genshin-optimizer/gi/ui'
import { ArtifactSetName, DataContext } from '@genshin-optimizer/gi/ui'
import { UIData } from '@genshin-optimizer/gi/uidata'
import { setKeysByRarities } from '@genshin-optimizer/gi/util'
import { constant } from '@genshin-optimizer/gi/wr'
import { allNonstackBuffs } from '@genshin-optimizer/gi/wr-types'
import CheckIcon from '@mui/icons-material/Check'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import AutoModeIcon from '@mui/icons-material/AutoMode'
import SearchIcon from '@mui/icons-material/Search'
import TuneIcon from '@mui/icons-material/Tune'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  CardContent,
  InputAdornment,
  Menu,
  MenuItem,
  Skeleton,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import {
  Fragment,
  memo,
  Suspense,
  useCallback,
  useContext,
  useDeferredValue,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  DialogHead,
  floatSx,
  stackedBackdrop,
} from '../../../../TeamOptimize/OptionTile'
import {
  FieldLabel,
  focusSx,
  hairline,
  numSx,
  quickSx,
  Segmented,
  selectedSx,
  tokens,
  type,
} from '../../../../TeamOptimize/ui'

type View = 'owned' | 'all' | 'effects'
type SetInfo = {
  setKey: ArtifactSetKey
  slotCount: Record<ArtifactSlotKey, number>
  slotsOwned: number
  pieces: number
}

// Sets the optimizer can filter (the 1-piece "Prayers" sets are not part of builds).
export const configurableSetKeys = Object.entries(setKeysByRarities)
  .reverse()
  .flatMap(([, sets]) => sets)
  .filter(
    (key) => !key.includes('Prayers') && isIn(allArtifactSetExclusionKeys, key)
  )

/** A set's effects that have a condition the user can turn on, with the bonus they belong to */
function getConditionals(setKey: ArtifactSetKey) {
  const { setEffects } = getArtSheet(setKey)
  return ([2, 4] as const).flatMap((num) =>
    (setEffects[num]?.document ?? [])
      .filter((doc): doc is DocumentConditional => 'states' in doc)
      .map((cond) => ({ num, cond }))
  )
}
const conditionalsBySet = Object.fromEntries(
  configurableSetKeys.map((setKey) => [setKey, getConditionals(setKey)])
) as Record<ArtifactSetKey, ReturnType<typeof getConditionals>>

/**
 * Which artifact set bonuses the optimizer may use, and the conditional set effects to apply. A
 * summary card opens a dialog with one row per set. Mixed builds (pieces of no bonus) are always
 * considered: the optimizer keeps them only when they are better.
 */
export default function ArtifactSetConfig({
  disabled,
  dialogOnly,
  onDialogClose,
  timed,
}: {
  disabled?: boolean
  /** Only the dialog, open at once (e.g. from a summary elsewhere): closing it calls `onDialogClose` */
  dialogOnly?: boolean
  onDialogClose?: () => void
  /**
   * The effects (`set.condition`) Team optimize's rotation times: shown as such, not switched, and
   * not counted as on
   */
  timed?: ReadonlySet<string>
}) {
  const { t } = useTranslation(['page_character_optimize', 'artifactNames_gen'])
  const dataContext = useContext(DataContext)
  const database = useDatabase()
  const {
    teamChar: { key: charKey, conditional, optConfigId },
    teamCharId,
  } = useContext(TeamCharacterContext)
  const { artSetExclusion } = useOptConfig(optConfigId)!
  const [open, setOpen] = useState(!!dialogOnly)
  const onOpen = useCallback(() => setOpen(true), [])
  const onClose = useCallback(() => {
    setOpen(false)
    onDialogClose?.()
  }, [onDialogClose])

  const total = configurableSetKeys.length
  const isExcluded = useCallback(
    (setKey: ArtifactSetKey, num: 2 | 4) =>
      !!artSetExclusion[setKey as keyof ArtSetExclusion]?.includes(num),
    [artSetExclusion]
  )
  const allowed2 = configurableSetKeys.filter((k) => !isExcluded(k, 2))
  const allowed4 = configurableSetKeys.filter((k) => !isExcluded(k, 4))
  const forced = forcedSet(artSetExclusion)

  const condCountBySet = useMemo(
    () =>
      Object.fromEntries(
        allArtifactSetKeys.map((setKey) => [
          setKey,
          Object.keys(conditional[setKey] ?? {}).filter(
            (cond) => !timed?.has(`${setKey}.${cond}`)
          ).length,
        ])
      ) as Record<ArtifactSetKey, number>,
    [conditional, timed]
  )
  const condTotal = Object.values(condCountBySet).filter(Boolean).length

  const describe = (allowed: ArtifactSetKey[]) =>
    allowed.length === total
      ? t('artSetConfig.summary.anySet')
      : allowed.length === 0
        ? t('artSetConfig.summary.noSet')
        : allowed.length === 1
          ? t('artSetConfig.summary.onlySet', {
              name: t(`artifactNames_gen:${allowed[0]}`),
            })
          : t('artSetConfig.summary.someSets', {
              count: allowed.length,
              total,
            })

  return (
    <>
      {!dialogOnly && (
        <CardThemed bgt="light">
          <CardContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>
                {t('artSetConfig.heading')}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<TuneIcon />}
                onClick={onOpen}
                disabled={disabled}
              >
                {t('artSetConfig.edit')}
              </Button>
            </Box>
            <Box
              component="dl"
              sx={{
                m: 0,
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                columnGap: 2,
                rowGap: 0.5,
                '& dt': { color: 'text.secondary' },
                '& dd': { m: 0, textAlign: 'right' },
              }}
            >
              <SummaryRow
                label={t('artSetConfig.summary.fourPc')}
                value={describe(allowed4)}
              />
              <SummaryRow
                label={t('artSetConfig.summary.twoPc')}
                value={describe(allowed2)}
              />
              <SummaryRow
                label={t('artSetConfig.summary.effects')}
                value={
                  condTotal
                    ? t('artSetConfig.summary.effectsOn', { count: condTotal })
                    : t('artSetConfig.summary.effectsNone')
                }
              />
            </Box>
            {forced && (
              <Typography variant="caption" color="text.secondary">
                {t('artSetConfig.summary.forced', {
                  name: t(`artifactNames_gen:${forced}`),
                })}
              </Typography>
            )}
          </CardContent>
        </CardThemed>
      )}

      <ModalWrapper
        open={open}
        onClose={onClose}
        containerProps={{ maxWidth: 'lg' }}
        // (opened from another dialog: a light backdrop over its dark one)
        slotProps={dialogOnly ? stackedBackdrop : undefined}
      >
        {/* overflow: clip (not hidden) so the toolbar and footer can stick while the dialog scrolls */}
        <CardThemed sx={[{ overflow: 'clip' }, !!dialogOnly && floatSx]}>
          <Suspense
            fallback={
              <Skeleton variant="rectangular" width="100%" height={600} />
            }
          >
            <SetConfigDialog
              charKey={charKey}
              dataContext={dataContext}
              teamCharId={teamCharId}
              optConfigId={optConfigId}
              artSetExclusion={artSetExclusion}
              allowed2={allowed2.length}
              allowed4={allowed4.length}
              condCountBySet={condCountBySet}
              condTotal={condTotal}
              conditional={conditional}
              onClose={onClose}
              database={database}
              timed={timed}
            />
          </Suspense>
        </CardThemed>
      </ModalWrapper>
    </>
  )
}

function SummaryRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <>
      <Typography component="dt" variant="body2">
        {label}
      </Typography>
      <Typography component="dd" variant="body2">
        {value}
      </Typography>
    </>
  )
}

/** The rows' layout, by the list's width: one line (wide), two (narrower), three (phones) */
const ROW_WIDE = '@container (min-width: 880px)'
const ROW_MID = '@container (min-width: 560px)'

function SetConfigDialog({
  charKey,
  dataContext,
  teamCharId,
  optConfigId,
  artSetExclusion,
  allowed2,
  allowed4,
  condCountBySet,
  condTotal,
  conditional,
  onClose,
  database,
  timed,
}: {
  charKey: string
  dataContext: dataContextObj
  teamCharId: string
  optConfigId: string
  artSetExclusion: ArtSetExclusion
  allowed2: number
  allowed4: number
  condCountBySet: Record<ArtifactSetKey, number>
  condTotal: number
  conditional: Record<string, unknown>
  onClose: () => void
  database: ReturnType<typeof useDatabase>
  timed?: ReadonlySet<string>
}) {
  const { t } = useTranslation(['page_character_optimize', 'artifactNames_gen'])
  const total = configurableSetKeys.length

  // How many pieces of each set the user owns, per slot.
  const allArts = useDataManagerValues(database.arts)
  const setInfos = useMemo(() => {
    const counts = objKeyMap(configurableSetKeys, () =>
      objKeyMap(allArtifactSlotKeys, () => 0)
    )
    for (const art of allArts) {
      const c = counts[art.setKey as keyof typeof counts]
      if (c) c[art.slotKey]++
    }
    // in alphabetical order (of the names as shown)
    const { compare } = new Intl.Collator()
    return configurableSetKeys
      .map((setKey): SetInfo => {
        const slotCount = counts[setKey as keyof typeof counts]
        const values = Object.values(slotCount)
        return {
          setKey,
          slotCount,
          slotsOwned: values.filter(Boolean).length,
          pieces: values.reduce((a, b) => a + b, 0),
        }
      })
      .sort((a, b) =>
        compare(
          t(`artifactNames_gen:${a.setKey}`),
          t(`artifactNames_gen:${b.setKey}`)
        )
      )
  }, [allArts, t])
  const ownedCount = setInfos.filter((s) => s.slotsOwned >= 2).length

  const [view, setView] = useState<View>(ownedCount ? 'owned' : 'all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const effectsSetCount = configurableSetKeys.filter(
    (k) => condCountBySet[k]
  ).length
  const shownSets = setInfos.filter(({ setKey, slotsOwned }) => {
    // a search looks through every set, whatever the view
    if (deferredSearch)
      return t(`artifactNames_gen:${setKey}`)
        .toLowerCase()
        .includes(deferredSearch)
    if (view === 'owned') return slotsOwned >= 2
    if (view === 'effects') return !!condCountBySet[setKey]
    return true
  })

  const saveExclusion = useCallback(
    (next: ArtSetExclusion) =>
      database.optConfigs.set(optConfigId, { artSetExclusion: next }),
    [database, optConfigId]
  )
  const toggleSet = useCallback(
    (setKey: ArtifactSetKey, num: 2 | 4) =>
      saveExclusion(
        handleArtSetExclusion(
          artSetExclusion,
          setKey as keyof ArtSetExclusion,
          num
        )
      ),
    [artSetExclusion, saveExclusion]
  )
  const setAll = useCallback(
    (num: 2 | 4, exclude: boolean, except?: ArtifactSetKey) => {
      const next = deepClone(artSetExclusion)
      for (const setKey of configurableSetKeys) {
        const key = setKey as keyof ArtSetExclusion
        const rest = (next[key] ?? []).filter((n) => n !== num)
        const excludeThis = setKey === except ? !exclude : exclude
        if (excludeThis) next[key] = [...rest, num]
        else if (rest.length) next[key] = rest
        else delete next[key]
      }
      saveExclusion(next)
    },
    [artSetExclusion, saveExclusion]
  )
  // (every other set off: every build wears 4 of its pieces)
  const onlyThis4 = useCallback(
    (setKey: ArtifactSetKey) =>
      saveExclusion(
        Object.fromEntries(
          configurableSetKeys
            .filter((other) => other !== setKey)
            .map((other) => [other, [2, 4]])
        ) as ArtSetExclusion
      ),
    [saveExclusion]
  )
  // the basic view: a set used (both its bonuses allowed) or not (neither)
  const useSets = useCallback(
    (setKeys: readonly ArtifactSetKey[], use: boolean) => {
      const next = deepClone(artSetExclusion)
      for (const setKey of setKeys) {
        const key = setKey as keyof ArtSetExclusion
        if (use) delete next[key]
        else next[key] = [2, 4]
      }
      saveExclusion(next)
    },
    [artSetExclusion, saveExclusion]
  )
  const useSet = useCallback(
    (setKey: ArtifactSetKey, use: boolean) => useSets([setKey], use),
    [useSets]
  )
  const forced = forcedSet(artSetExclusion)
  const used = configurableSetKeys.filter(
    (k) => (artSetExclusion[k as keyof ArtSetExclusion]?.length ?? 0) < 2
  ).length
  const [advanced, setAdvanced] = useState(false)
  const setCondition = useCallback(
    (path: readonly string[], value?: string) =>
      database.teamChars.set(teamCharId, (teamChar) => {
        const next = deepClone(teamChar.conditional)
        if (value) layeredAssignment(next, path, value)
        else deletePropPath(next, path)
        teamChar.conditional = next
      }),
    [database, teamCharId]
  )
  // (the switches counted: not those of the effects the rotation times)
  const resetArtConds = useCallback(() => {
    const tconditional = Object.fromEntries(
      Object.entries(conditional).flatMap(([k, v]) => {
        if (!allArtifactSetKeys.includes(k as ArtifactSetKey)) return [[k, v]]
        if (!timed) return []
        const kept = Object.fromEntries(
          Object.entries(v as Record<string, string>).filter(([cond]) =>
            timed.has(`${k}.${cond}`)
          )
        )
        return Object.keys(kept).length ? [[k, kept]] : []
      })
    )
    database.teamChars.set(teamCharId, (teamChar) => {
      teamChar.conditional = tconditional
    })
  }, [database, teamCharId, conditional, timed])

  // Every conditional set effect's states as if the full set were equipped.
  const fakeData = useMemo(
    () =>
      new UIData(
        {
          ...dataContext.data.data[0],
          artSet: objKeyMap(allArtifactSetKeys, () => constant(4)),
          nonStacking: objKeyMap(allNonstackBuffs, () => constant(charKey)),
        },
        undefined
      ),
    [charKey, dataContext]
  )

  return (
    <>
      <DialogHead
        title={t('artSetConfig.heading')}
        info={t('artSetConfig.description')}
        onClose={onClose}
      />

      {/* Toolbar: sticks to the top while the list scrolls (not on phones, where it is tall) */}
      <Box
        sx={{
          position: { xs: 'static', sm: 'sticky' },
          top: 0,
          zIndex: 2,
          bgcolor: 'contentNormal.main',
          borderBottom: hairline,
          px: { xs: 2, sm: 3 },
          py: 1.5,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 1.25,
        }}
      >
        <TextField
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('artSetConfig.search')}
          inputProps={{ 'aria-label': t('artSetConfig.search') }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18 }} />
              </InputAdornment>
            ),
          }}
          sx={{
            flex: '1 1 200px',
            maxWidth: 260,
            '& .MuiInputBase-root': {
              height: 34,
              fontSize: 13.5,
              borderRadius: tokens.radius.control,
            },
          }}
        />
        <Box sx={{ opacity: search ? 0.5 : 1, ...quickSx }}>
          <Segmented
            size="small"
            aria-label={t('artSetConfig.view.label')}
            value={view}
            onChange={setView}
            options={[
              {
                value: 'owned',
                label: (
                  <ViewLabel count={ownedCount}>
                    {t('artSetConfig.view.owned')}
                  </ViewLabel>
                ),
              },
              {
                value: 'all',
                label: (
                  <ViewLabel count={total}>
                    {t('artSetConfig.view.all')}
                  </ViewLabel>
                ),
              },
              {
                value: 'effects',
                label: (
                  <ViewLabel count={effectsSetCount}>
                    {t('artSetConfig.view.effects')}
                  </ViewLabel>
                ),
              },
            ]}
          />
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {advanced ? (
          <>
            <BulkControl
              label={t('artSetConfig.bulk.label4')}
              allowed={allowed4}
              total={total}
              onAll={() => setAll(4, false)}
              onNone={() => setAll(4, true)}
            />
            <BulkControl
              label={t('artSetConfig.bulk.label2')}
              allowed={allowed2}
              total={total}
              onAll={() => setAll(2, false)}
              onNone={() => setAll(2, true)}
            />
          </>
        ) : (
          <BulkControl
            label={t('artSetConfig.bulk.sets', 'Sets')}
            allowed={used}
            total={total}
            onAll={() => useSets(configurableSetKeys, true)}
            onNone={() => useSets(configurableSetKeys, false)}
          />
        )}
        <Tooltip
          title={t(
            'artSetConfig.advancedTip',
            'Choose the 2-piece and 4-piece bonuses separately'
          )}
        >
          <Box
            component="label"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              cursor: 'pointer',
              ...type.label,
              '&:hover': { color: 'text.primary' },
            }}
          >
            <Switch
              size="small"
              checked={advanced}
              onChange={() => setAdvanced((a) => !a)}
            />
            {t('artSetConfig.advanced', 'Advanced')}
          </Box>
        </Tooltip>
      </Box>

      {/* One row per set */}
      <Box role="list" sx={{ containerType: 'inline-size' }}>
        {shownSets.map(({ setKey, slotCount, slotsOwned, pieces }) => (
          <SetRow
            key={setKey}
            setKey={setKey}
            slotCount={slotCount}
            slotsOwned={slotsOwned}
            pieces={pieces}
            excluded2={
              !!artSetExclusion[setKey as keyof ArtSetExclusion]?.includes(2)
            }
            excluded4={
              !!artSetExclusion[setKey as keyof ArtSetExclusion]?.includes(4)
            }
            setConditional={
              conditional[setKey] as Record<string, string> | undefined
            }
            advanced={advanced}
            onUse={useSet}
            onToggle={toggleSet}
            onOnly4={onlyThis4}
            onCondition={setCondition}
            fakeData={fakeData}
            timed={timed}
          />
        ))}
        {!shownSets.length && (
          <Typography
            color="text.secondary"
            sx={{ px: { xs: 2, sm: 3 }, py: 4, textAlign: 'center' }}
          >
            {t('artSetConfig.empty')}
          </Typography>
        )}
      </Box>

      {/* Footer: sticks to the bottom */}
      <Box
        sx={{
          position: 'sticky',
          bottom: 0,
          zIndex: 2,
          bgcolor: 'contentNormal.main',
          borderTop: hairline,
          px: { xs: 2, sm: 3 },
          py: 1.5,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Typography sx={{ ...type.label, ...numSx }}>
          {forced
            ? t('artSetConfig.summary.forced', {
                name: t(`artifactNames_gen:${forced}`),
              })
            : advanced
              ? t('artSetConfig.footer.summary', {
                  four: allowed4,
                  two: allowed2,
                  total,
                })
              : t('artSetConfig.footer.using', {
                  defaultValue: 'Using {{count}} of {{total}} sets',
                  count: used,
                  total,
                })}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {!!condTotal && (
          <Button
            variant="text"
            color="inherit"
            onClick={resetArtConds}
            sx={{
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
            }}
          >
            {t('artSetConfig.footer.resetEffects', { count: condTotal })}
          </Button>
        )}
        <Button
          variant="contained"
          sx={[{ px: 2.5 }, giCtaSx]}
          onClick={onClose}
        >
          {t('artSetConfig.footer.done')}
        </Button>
      </Box>
    </>
  )
}

function ViewLabel({
  children,
  count,
}: {
  children: ReactNode
  count: number
}) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: 0.75 }}>
      {children}
      <Box
        component="span"
        sx={{ color: 'text.secondary', fontWeight: 500, ...numSx }}
      >
        {count}
      </Box>
    </Box>
  )
}

/** All or none of the sets' 2-piece or 4-piece bonuses */
function BulkControl({
  label,
  allowed,
  total,
  onAll,
  onNone,
}: {
  label: ReactNode
  allowed: number
  total: number
  onAll: () => void
  onNone: () => void
}) {
  const { t } = useTranslation('page_character_optimize')
  const action = (text: ReactNode, onClick: () => void, off: boolean) => (
    <ButtonBase
      onClick={onClick}
      disabled={off}
      sx={{
        height: 28,
        px: 1,
        borderRadius: tokens.radius.control,
        fontSize: 12.5,
        fontWeight: 600,
        color: 'text.secondary',
        ...quickSx,
        ...focusSx,
        '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
        '&.Mui-disabled': { opacity: 0.4 },
      }}
    >
      {text}
    </ButtonBase>
  )
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
      <FieldLabel sx={{ mr: 0.5 }}>{label}</FieldLabel>
      {action(t('artSetConfig.bulk.all'), onAll, allowed === total)}
      {action(t('artSetConfig.bulk.none'), onNone, allowed === 0)}
    </Box>
  )
}

const SetRow = memo(function SetRow({
  setKey,
  slotCount,
  slotsOwned,
  pieces,
  excluded2,
  excluded4,
  setConditional,
  advanced,
  onUse,
  onToggle,
  onOnly4,
  onCondition,
  fakeData,
  timed,
}: {
  setKey: ArtifactSetKey
  slotCount: Record<ArtifactSlotKey, number>
  slotsOwned: number
  pieces: number
  excluded2: boolean
  excluded4: boolean
  /** Its effects' states (the member's conditional for this set) */
  setConditional: Record<string, string> | undefined
  /** Its 2-piece and 4-piece bonuses apart (else one switch: used or not) */
  advanced: boolean
  onUse: (setKey: ArtifactSetKey, use: boolean) => void
  onToggle: (setKey: ArtifactSetKey, num: 2 | 4) => void
  onOnly4: (setKey: ArtifactSetKey) => void
  onCondition: (path: readonly string[], value?: string) => void
  fakeData: UIData
  timed?: ReadonlySet<string>
}) {
  const { t } = useTranslation([
    'page_character_optimize',
    'artifactNames_gen',
    'artifact',
  ])
  // (as the set's own text shows them: one whose condition doesn't hold for this character, or
  // needs another of its effects on first, is not shown)
  const conditionals = conditionalsBySet[setKey].filter(
    ({ cond }) => !cond.canShow || fakeData.get(cond.canShow).value
  )
  const rarities = getArtSetStat(setKey).rarities.filter((r) => r >= 3)
  const name = t(`artifactNames_gen:${setKey}`)
  // (a set with conditions on both bonuses names which bonus each is of)
  const bothNums = new Set(conditionals.map((c) => c.num)).size > 1

  return (
    <Box role="listitem" sx={{ '& + &': { borderTop: hairline } }}>
      <Box
        sx={{
          display: 'grid',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 1,
          px: { xs: 2, sm: 3 },
          py: 1.25,
          minHeight: 64,
          gridTemplateColumns: '40px minmax(0, 1fr)',
          gridTemplateAreas: '"icon name" ". pieces" ". effects"',
          [ROW_MID]: {
            gridTemplateColumns: '40px minmax(0, 1fr) auto',
            gridTemplateAreas: '"icon name pieces" ". effects effects"',
          },
          [ROW_WIDE]: {
            gridTemplateColumns:
              '40px minmax(220px, 300px) minmax(0, 1fr) auto',
            gridTemplateAreas: '"icon name effects pieces"',
          },
        }}
      >
        <Box
          component="img"
          src={artifactDefIcon(setKey)}
          alt=""
          loading="lazy"
          sx={{
            gridArea: 'icon',
            width: 40,
            height: 40,
            // sets without two different pieces can't give a bonus
            opacity: slotsOwned >= 2 ? 1 : 0.5,
          }}
        />
        <Box
          sx={{
            gridArea: 'name',
            minWidth: 0,
            opacity: slotsOwned >= 2 ? 1 : 0.6,
          }}
        >
          <Typography
            component="div"
            sx={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.35,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <Box
              component="span"
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <ArtifactSetName setKey={setKey} />
            </Box>
            <InfoTooltipInline title={<SetBonusText setKey={setKey} />} />
          </Typography>
          <Tooltip
            title={allArtifactSlotKeys
              .map((s) => `${t(`artifact:slotName.${s}`)} ${slotCount[s]}`)
              .join(' · ')}
          >
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                ...type.label,
                fontSize: 12,
                ...numSx,
              }}
            >
              <span>{rarities.map((r) => `${r}★`).join(' · ')}</span>
              <Box
                component="span"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
              >
                {allArtifactSlotKeys.map((s) => (
                  <SlotIcon
                    key={s}
                    slotKey={s}
                    iconProps={{
                      sx: {
                        fontSize: 13,
                        color: slotCount[s]
                          ? 'text.secondary'
                          : 'text.disabled',
                        opacity: slotCount[s] ? 1 : 0.5,
                      },
                    }}
                  />
                ))}
              </Box>
              <span>{t('artSetConfig.row.pieces', { count: pieces })}</span>
            </Box>
          </Tooltip>
        </Box>

        {!!conditionals.length && (
          <Box
            sx={{
              gridArea: 'effects',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <Suspense fallback={<Skeleton width={160} height={30} />}>
              {conditionals.map(({ num, cond }, i) =>
                timed && isTimed(cond, timed, fakeData) ? (
                  // (several conditions in one: a chip each, as when switched)
                  timedLabels(cond, fakeData).map((label, j) => (
                    <TimedEffectChip
                      // biome-ignore lint/suspicious/noArrayIndexKey: a set's fixed list
                      key={`${i}.${j}`}
                    >
                      {bothNums && (
                        <Box
                          component="span"
                          sx={{ color: 'text.secondary', mr: 0.5 }}
                        >
                          {num}-pc
                        </Box>
                      )}
                      {label}
                    </TimedEffectChip>
                  ))
                ) : (
                  <EffectControl
                    // biome-ignore lint/suspicious/noArrayIndexKey: a set's fixed list
                    key={i}
                    cond={cond}
                    num={num}
                    showNum={bothNums}
                    // a 2-piece effect also applies to 4-piece builds
                    off={num === 2 ? excluded2 && excluded4 : excluded4}
                    values={setConditional}
                    onCondition={onCondition}
                    // an effect turned on wants its set: the set used (basic), its bonus (advanced)
                    onAllow={() =>
                      advanced ? onToggle(setKey, num) : onUse(setKey, true)
                    }
                    data={fakeData}
                  />
                )
              )}
            </Suspense>
          </Box>
        )}

        <Box
          sx={{
            gridArea: 'pieces',
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
          }}
        >
          {advanced ? (
            <>
              <PieceChip
                label={t('artSetConfig.row.twoPc')}
                ariaLabel={t('artSetConfig.row.allow', { name, num: 2 })}
                on={!excluded2}
                onClick={() => onToggle(setKey, 2)}
              />
              <PieceChip
                label={t('artSetConfig.row.fourPc')}
                ariaLabel={t('artSetConfig.row.allow', { name, num: 4 })}
                on={!excluded4}
                onClick={() => onToggle(setKey, 4)}
              />
              <Tooltip title={t('artSetConfig.row.only4')}>
                <ButtonBase
                  onClick={() => onOnly4(setKey)}
                  aria-label={`${t('artSetConfig.row.only4')}: ${name}`}
                  sx={{
                    height: 30,
                    px: 1,
                    ml: 0.25,
                    borderRadius: tokens.radius.control,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'text.secondary',
                    ...quickSx,
                    ...focusSx,
                    '&:hover': {
                      color: 'text.primary',
                      bgcolor: 'action.hover',
                    },
                  }}
                >
                  {t('artSetConfig.row.only', 'Only')}
                </ButtonBase>
              </Tooltip>
            </>
          ) : (
            <UseSwitch
              name={name}
              on={!(excluded2 && excluded4)}
              // (one bonus only, set in the advanced view: said, not hidden)
              note={
                excluded2 !== excluded4
                  ? excluded4
                    ? t('artSetConfig.row.only2pc', '2-pc only')
                    : t('artSetConfig.row.only4pc', '4-pc only')
                  : undefined
              }
              onChange={(use) => onUse(setKey, use)}
            />
          )}
        </Box>
      </Box>
    </Box>
  )
})

/** The basic view's one switch: the set used (its bonuses allowed) or not */
function UseSwitch({
  name,
  on,
  note,
  onChange,
}: {
  name: string
  on: boolean
  note?: ReactNode
  onChange: (use: boolean) => void
}) {
  const { t } = useTranslation('page_character_optimize')
  return (
    <Box
      component="label"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        cursor: 'pointer',
      }}
    >
      {note && (
        <Box component="span" sx={{ ...type.label, fontSize: 12 }}>
          {note}
        </Box>
      )}
      <Switch
        checked={on}
        onChange={() => onChange(!on)}
        inputProps={{
          'aria-label': t('artSetConfig.row.use', {
            defaultValue: 'Use {{name}}',
            name,
          }),
        }}
      />
    </Box>
  )
}

/** A set bonus allowed or not: a chip, one click */
function PieceChip({
  label,
  ariaLabel,
  on,
  onClick,
}: {
  label: ReactNode
  ariaLabel: string
  on: boolean
  onClick: () => void
}) {
  return (
    <ButtonBase
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onClick}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.5,
        height: 30,
        minWidth: 64,
        px: 1.25,
        borderRadius: tokens.radius.control,
        fontSize: 12.5,
        fontWeight: 600,
        ...numSx,
        ...quickSx,
        ...focusSx,
        ...(on
          ? { ...selectedSx(theme), color: 'text.primary' }
          : {
              color: 'text.secondary',
              boxShadow: `inset 0 0 0 1px ${tokens.hairlineStrong}`,
            }),
        '&:hover': {
          color: 'text.primary',
          bgcolor: on
            ? alpha(theme.palette.primary.main, 0.16)
            : 'action.hover',
        },
      })}
    >
      {on && (
        <CheckIcon sx={{ fontSize: 15, color: 'primary.main', ml: -0.25 }} />
      )}
      {label}
    </ButtonBase>
  )
}

/** A condition's name, its element and reaction names as badges (as the effect's own text has them) */
function condName(name: ReactNode): ReactNode {
  if (name && typeof name === 'object' && 'props' in name) {
    const { key18, ns, values } = (name as { props: Record<string, unknown> })
      .props
    if (typeof key18 === 'string' && typeof ns === 'string')
      return (
        <Translate
          ns={ns}
          key18={key18}
          values={values as Record<string, string>}
          useBadge
        />
      )
  }
  return name
}

/**
 * A set effect's condition, on its row: on or off in one click (one state), or its state picked
 * from a menu (stacks). Green while on, as conditions are everywhere in the app.
 */
function EffectControl({
  cond,
  num,
  showNum,
  off,
  values,
  onCondition: setCondition,
  onAllow,
  data,
}: {
  cond: DocumentConditional
  /** The bonus it belongs to (named when the set has conditions on both) */
  num: 2 | 4
  showNum: boolean
  /** Its bonus is not allowed: it can't apply */
  off: boolean
  values: Record<string, string> | undefined
  onCondition: (path: readonly string[], value?: string) => void
  /** Allows its bonus: an effect turned on while it isn't */
  onAllow: () => void
  data: UIData
}) {
  const onCondition = (path: readonly string[], value?: string) => {
    setCondition(path, value)
    if (value && off) onAllow()
  }
  const current = (path: readonly string[]) =>
    objPathValue({ [path[0]]: values }, path as string[]) as string | undefined
  const prefix = showNum && (
    <Box component="span" sx={{ color: 'text.secondary', mr: 0.5 }}>
      {num}-pc
    </Box>
  )

  // several conditions in one (each its own state): a chip each
  if (!('path' in cond))
    return (
      <>
        {Object.entries(evalIfFunc(cond.states, data)).map(([stateKey, st]) => {
          const { path, name } = st
          const on = current(path) === stateKey
          return (
            <EffectChip
              key={stateKey}
              on={on}
              off={off}
              num={num}
              onClick={() => onCondition(path, on ? undefined : stateKey)}
            >
              {prefix}
              {condName(name)}
            </EffectChip>
          )
        })}
      </>
    )
  const states = evalIfFunc(cond.states, data)
  const entries = Object.entries(states)
  const value = current(cond.path)
  const state = value ? states[value] : undefined
  if (entries.length === 1) {
    const [stateKey] = entries[0]
    const on = value === stateKey
    return (
      <EffectChip
        on={on}
        off={off}
        num={num}
        onClick={() => onCondition(cond.path, on ? undefined : stateKey)}
      >
        {prefix}
        {condName(cond.name)}
      </EffectChip>
    )
  }
  return (
    <EffectMenu
      on={!!state}
      off={off}
      label={
        <>
          {prefix}
          {condName(cond.name)}
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {': '}
          </Box>
          {state ? (state.name ?? value) : <OffText />}
        </>
      }
      options={entries.map(([stateKey, st]) => ({
        key: stateKey,
        label: st.name ?? stateKey,
        selected: value === stateKey,
      }))}
      onPick={(stateKey) => onCondition(cond.path, stateKey)}
    />
  )
}

/** Whether the rotation times a set effect (each of its states' own, for one of several) */
const isTimed = (
  cond: DocumentConditional,
  timed: ReadonlySet<string>,
  data: UIData
) =>
  'path' in cond
    ? timed.has(cond.path.join('.'))
    : Object.values(evalIfFunc(cond.states, data)).every(({ path }) =>
        timed.has(path.join('.'))
      )

/**
 * A timed effect's labels: its name, with its states when it has two (Blizzard Strayer's "Enemy is"
 * reads as nothing alone); several conditions in one: each one's
 */
function timedLabels(cond: DocumentConditional, data: UIData): ReactNode[] {
  const states = Object.values(evalIfFunc(cond.states, data))
  if (!('path' in cond)) return states.map((st) => condName(st.name))
  if (states.length !== 2) return [condName(cond.name)]
  return [
    <>
      {condName(cond.name)}
      {': '}
      {states.map((st, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a condition's fixed states
        <Fragment key={i}>
          {i > 0 && ' / '}
          {st.name}
        </Fragment>
      ))}
    </>,
  ]
}

/** A set effect Team optimize's rotation turns on and off for each hit: shown, not switched */
function TimedEffectChip({ children }: { children: ReactNode }) {
  const { t } = useTranslation('page_character_optimize')
  return (
    <Tooltip
      title={t(
        'artSetConfig.row.timedTip',
        'Team optimize turns this on and off for each hit, as your rotation triggers it'
      )}
    >
      <Box
        sx={(theme) => ({
          ...effectSx(false, false)(theme),
          cursor: 'default',
          '&:hover': {},
        })}
      >
        <AutoModeIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
        <span>{children}</span>
        <Box component="span" sx={{ color: 'text.disabled', flexShrink: 0 }}>
          {t('artSetConfig.row.timed', 'From rotation')}
        </Box>
      </Box>
    </Tooltip>
  )
}

function OffText() {
  const { t } = useTranslation('page_character_optimize')
  return <>{t('artSetConfig.row.effectOff', 'Off')}</>
}

const effectSx =
  (on: boolean, off: boolean) => (theme: Parameters<typeof selectedSx>[0]) => {
    const { success } = theme.palette
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.75,
      maxWidth: '100%',
      minHeight: 30,
      px: 1.25,
      py: 0.375,
      borderRadius: tokens.radius.control,
      fontSize: 12.5,
      fontWeight: 500,
      lineHeight: 1.3,
      textAlign: 'left' as const,
      color: on ? 'text.primary' : 'text.secondary',
      bgcolor: on ? alpha(success.main, 0.12) : 'transparent',
      boxShadow: `inset 0 0 0 1px ${on ? alpha(success.main, 0.45) : tokens.hairlineStrong}`,
      opacity: off ? 0.45 : 1,
      ...quickSx,
      ...focusSx,
      '&:hover': {
        color: 'text.primary',
        bgcolor: on ? alpha(success.main, 0.18) : 'action.hover',
      },
    }
  }

/** A condition with one state: on or off */
function EffectChip({
  on,
  off,
  num,
  onClick,
  children,
}: {
  on: boolean
  off: boolean
  num: 2 | 4
  onClick: () => void
  children: ReactNode
}) {
  const { t } = useTranslation('page_character_optimize')
  const chip = (
    <ButtonBase
      role="switch"
      aria-checked={on}
      onClick={onClick}
      sx={effectSx(on, off)}
    >
      <Box
        component="span"
        sx={(theme) => ({
          display: 'inline-grid',
          placeItems: 'center',
          width: 14,
          height: 14,
          flexShrink: 0,
          borderRadius: '4px',
          ...(on
            ? {
                bgcolor: 'success.main',
                color: theme.palette.background.default,
              }
            : { boxShadow: `inset 0 0 0 1.5px ${tokens.hairlineStrong}` }),
        })}
      >
        {on && <CheckIcon sx={{ fontSize: 12 }} />}
      </Box>
      <Box component="span" sx={{ minWidth: 0 }}>
        {children}
      </Box>
    </ButtonBase>
  )
  return off ? (
    <Tooltip title={t('artSetConfig.row.excludedNote', { num })}>
      {chip}
    </Tooltip>
  ) : (
    chip
  )
}

/** A condition with several states (stacks): the current one, the others in a menu */
function EffectMenu({
  on,
  off,
  label,
  options,
  onPick,
}: {
  on: boolean
  off: boolean
  label: ReactNode
  options: { key: string; label: ReactNode; selected: boolean }[]
  onPick: (key?: string) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        sx={effectSx(on, off)}
      >
        <Box component="span" sx={{ minWidth: 0 }}>
          {label}
        </Box>
        <ExpandMoreIcon
          sx={{ fontSize: 16, color: 'text.secondary', mr: -0.5 }}
        />
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <MenuItem
          selected={!options.some((o) => o.selected)}
          onClick={() => {
            setAnchor(null)
            onPick(undefined)
          }}
        >
          <OffText />
        </MenuItem>
        {options.map((o) => (
          <MenuItem
            key={o.key}
            selected={o.selected}
            onClick={() => {
              setAnchor(null)
              onPick(o.key)
            }}
          >
            {o.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

function SetBonusText({ setKey }: { setKey: ArtifactSetKey }) {
  const { t } = useTranslation('sheet')
  return (
    <Suspense
      fallback={<Skeleton variant="rectangular" width={300} height={120} />}
    >
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {([2, 4] as const).map((num) => (
          <Box key={num}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t(`${num}set`)}
            </Typography>
            <Typography variant="body2">
              <Translate
                ns={`artifact_${setKey}_gen`}
                key18={`setEffects.${num}`}
              />
            </Typography>
          </Box>
        ))}
      </Box>
    </Suspense>
  )
}
