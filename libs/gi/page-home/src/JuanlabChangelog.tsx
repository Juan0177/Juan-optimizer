// juanlab: le novità di Juan-optimizer nella home. I testi stanno in juanlab.json (changelog.entries), in
// italiano e in inglese (le altre lingue ricadono sull'inglese); la più recente si vede per prima, il resto
// dell'aggiornamento e quelli precedenti si aprono con un clic.
import { CardThemed } from '@genshin-optimizer/common/ui'
import { NewReleases } from '@mui/icons-material'
import {
  Box,
  Button,
  CardContent,
  CardHeader,
  Collapse,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { Fragment, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** A bullet: its text, and the points under it */
type ChangelogItem = string | { text: string; sub: string[] }
type ChangelogSection = {
  kind: 'new' | 'improved' | 'fixed' | 'juanlab'
  items: ChangelogItem[]
}
type ChangelogEntry = {
  /** YYYY-MM-DD */
  date: string
  title: string
  summary?: string
  sections: ChangelogSection[]
}

/** "**bold**" and "`code`" in a changelog line; the rest as written */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith('`') ? (
      <Box
        component="code"
        key={i}
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.92em',
          px: 0.5,
          borderRadius: 0.5,
          bgcolor: 'action.hover',
        }}
      >
        {part.slice(1, -1)}
      </Box>
    ) : (
      part
    )
  )
}

const listSx = {
  m: 0,
  pl: 2.25,
  '& li': { mb: 0.5 },
  '& li::marker': { color: 'neutral400.main' },
} as const

/** The bullets; `brief`: only the headings, not the points under them */
function Items({ items, brief }: { items: ChangelogItem[]; brief?: boolean }) {
  return (
    <Box component="ul" sx={listSx}>
      {items.map((item) =>
        typeof item === 'string' ? (
          <Typography component="li" variant="body2" key={item}>
            {inline(item)}
          </Typography>
        ) : (
          <Typography component="li" variant="body2" key={item.text}>
            {inline(item.text)}
            {!brief && (
              <Box component="ul" sx={{ ...listSx, mt: 0.5 }}>
                {item.sub.map((sub) => (
                  <Typography component="li" variant="body2" key={sub}>
                    {inline(sub)}
                  </Typography>
                ))}
              </Box>
            )}
          </Typography>
        )
      )}
    </Box>
  )
}

/** "20 nov 2026" in the reader's language (a plain YYYY-MM-DD, no time zone shift) */
function entryDate(date: string, language?: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function Sections({
  sections,
  brief,
}: {
  sections: ChangelogSection[]
  brief?: boolean
}) {
  const { t } = useTranslation('juanlab')
  return (
    <Stack spacing={1.5}>
      {sections.map((section) => (
        <Box key={section.kind}>
          <Typography
            variant="overline"
            component="h4"
            sx={{
              color: 'neutral400.main',
              lineHeight: 1.5,
              letterSpacing: '0.08em',
            }}
          >
            {t(`changelog.kind.${section.kind}`)}
          </Typography>
          <Items items={section.items} brief={brief} />
        </Box>
      ))}
    </Stack>
  )
}

export function ChangelogCard() {
  const { t, i18n } = useTranslation('juanlab')
  const [open, setOpen] = useState(false)
  const moreId = useId()
  const entries = t('changelog.entries', { returnObjects: true })
  if (!Array.isArray(entries) || !entries.length) return null
  const [latest, ...older] = entries as ChangelogEntry[]
  // closed: the latest update's first section, its headings only; open: all of it and the earlier ones
  const [first] = latest.sections
  return (
    <CardThemed component="section" aria-labelledby="juanlab-changelog-title">
      <CardHeader
        title={
          <Typography variant="h5" component="h2" id="juanlab-changelog-title">
            {t('changelog.title')}
          </Typography>
        }
        avatar={<NewReleases fontSize="large" />}
      />
      <Divider />
      <CardContent>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            columnGap: 1,
          }}
        >
          <Typography
            variant="subtitle1"
            component="h3"
            sx={{ fontWeight: 600 }}
          >
            {latest.title}
          </Typography>
          <Typography variant="caption" sx={{ color: 'neutral400.main' }}>
            {entryDate(latest.date, i18n.language)}
          </Typography>
        </Box>
        {latest.summary && (
          <Typography variant="body2" sx={{ color: 'neutral300.main', mb: 1 }}>
            {inline(latest.summary)}
          </Typography>
        )}
        {!open && first && <Sections sections={[first]} brief />}
        <Collapse in={open} id={moreId} unmountOnExit>
          <Box>
            <Sections sections={latest.sections} />
            {older.map((entry) => (
              <Fragment key={`${entry.date}-${entry.title}`}>
                <Divider sx={{ my: 2 }} />
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    columnGap: 1,
                    mb: 1,
                  }}
                >
                  <Typography
                    variant="subtitle1"
                    component="h3"
                    sx={{ fontWeight: 600 }}
                  >
                    {entry.title}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: 'neutral400.main' }}
                  >
                    {entryDate(entry.date, i18n.language)}
                  </Typography>
                </Box>
                {entry.summary && (
                  <Typography
                    variant="body2"
                    sx={{ color: 'neutral300.main', mb: 1 }}
                  >
                    {inline(entry.summary)}
                  </Typography>
                )}
                <Sections sections={entry.sections} />
              </Fragment>
            ))}
          </Box>
        </Collapse>
        {(latest.sections.length > 1 ||
          older.length > 0 ||
          latest.sections.some((s) =>
            s.items.some((i) => typeof i !== 'string')
          )) && (
          <Button
            size="small"
            variant="outlined"
            color="neutral400"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={moreId}
            sx={{ mt: 2 }}
          >
            {open ? t('changelog.showLess') : t('changelog.showAll')}
          </Button>
        )}
      </CardContent>
    </CardThemed>
  )
}
