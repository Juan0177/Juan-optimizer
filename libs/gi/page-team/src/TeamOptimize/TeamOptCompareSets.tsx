import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import {
  ArtifactSetName,
  CharacterName,
  type TeamOptSession,
  type TeamOptSetComparison,
} from '@genshin-optimizer/gi/ui'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function TeamOptCompareSets({
  members,
  currentSets,
  session,
  disabled,
  onCompared,
}: {
  members: CharacterKey[]
  currentSets: Partial<Record<CharacterKey, string>>
  session: () => Promise<TeamOptSession | undefined>
  disabled?: boolean
  onCompared: (comparison: TeamOptSetComparison) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const [open, setOpen] = useState(false)
  const [solver, setSolver] = useState<TeamOptSession>()
  const [pair, setPair] = useState(() => members.slice(-2))
  const [sets, setSets] = useState<Partial<Record<CharacterKey, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    []
  )
  const choices = useMemo(() => solver?.setChoices(pair) ?? {}, [solver, pair])
  const choice = (ck: CharacterKey) => {
    const set = sets[ck] ?? currentSets[ck]
    return set && choices[ck]?.includes(set) ? set : ''
  }
  const title = t('teamOpt.result.compareSets', 'Compare set assignments')
  const close = () => {
    request.current++
    setBusy(false)
    setOpen(false)
  }
  const enable = async () => {
    const id = ++request.current
    setOpen(true)
    setError(false)
    setSolver(undefined)
    try {
      const next = await session()
      if (id !== request.current) return
      setSolver(next)
      setError(!next)
    } catch {
      if (id === request.current) setError(true)
    }
  }
  const compare = async () => {
    if (!solver || busy || pair.some((ck) => !choice(ck))) return
    const id = ++request.current
    setBusy(true)
    setError(false)
    try {
      const found = await solver.compareSets(
        Object.fromEntries(pair.map((ck) => [ck, choice(ck)])),
        () => id !== request.current
      )
      if (id !== request.current) return
      if (found) {
        onCompared(found)
        close()
      } else setError(true)
    } catch {
      if (id === request.current) setError(true)
    } finally {
      if (id === request.current) setBusy(false)
    }
  }
  return (
    <>
      <Button size="small" onClick={enable} disabled={disabled}>
        {title}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        fullWidth
        maxWidth="xs"
        aria-label={title}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          {!solver && !error && <CircularProgress size={20} />}
          {solver &&
            pair.map((ck, i) => (
              <Box key={ck} sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('teamOpt.result.compareMember', {
                    defaultValue: 'Member {{number}}',
                    number: i + 1,
                  })}
                  value={ck}
                  disabled={busy}
                  onChange={(e) => {
                    setError(false)
                    setPair(
                      pair.map((key, j) =>
                        j === i ? (e.target.value as CharacterKey) : key
                      )
                    )
                  }}
                >
                  {members
                    .filter((key) => key !== pair[1 - i])
                    .map((key) => (
                      <MenuItem key={key} value={key}>
                        <CharacterName characterKey={key} gender={gender} />
                      </MenuItem>
                    ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('teamOpt.result.compareFourPiece', '4-piece set')}
                  value={choice(ck)}
                  disabled={busy || !choices[ck]?.length}
                  helperText={
                    !choices[ck]?.length &&
                    t(
                      'teamOpt.result.compareNoFourPiece',
                      'No eligible 4-piece sets'
                    )
                  }
                  onChange={(e) => {
                    setError(false)
                    setSets({ ...sets, [ck]: e.target.value })
                  }}
                >
                  {(choices[ck] ?? []).map((set) => (
                    <MenuItem key={set} value={set}>
                      <ArtifactSetName setKey={set as ArtifactSetKey} />
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            ))}
          {error && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {solver
                ? t(
                    'teamOpt.result.compareSetsUnmet',
                    'No build was found for these sets with the available artifacts and requirements.'
                  )
                : t(
                    'teamOpt.result.compareSetsUnavailable',
                    'This result could not be opened for comparison.'
                  )}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t('teamOpt.kqm.cancel', 'Cancel')}</Button>
          <Button
            variant="contained"
            onClick={compare}
            disabled={!solver || busy || pair.some((ck) => !choice(ck))}
            startIcon={busy ? <CircularProgress size={14} /> : undefined}
          >
            {t('teamOpt.result.compareSetsRun', 'Compare')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
