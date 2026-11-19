import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import {
  type CharacterKey,
  charKeyToLocGenderedCharKey,
} from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type { RotationTemplate } from '@genshin-optimizer/gi/ui'
import { rotationTemplateKinds } from '@genshin-optimizer/gi/ui'
import { alpha, Box, Button, ButtonBase, Menu, Typography } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import { focusSx, hairline, numSx, quickSx, tokens, type } from './ui'

/** The template's text with the team's own names leading each step (the parser reads keys too) */
export function templateText(
  text: string,
  names: { characterKey: CharacterKey; name: string }[]
) {
  const nameOf = new Map(names.map((n) => [n.characterKey, n.name]))
  return text
    .split('->')
    .map((part) =>
      part.replace(
        /^(\s*)([A-Za-z]+)/,
        (_, space: string, key: string) =>
          space + (nameOf.get(key as CharacterKey) ?? key)
      )
    )
    .join('->')
}

function useTemplateWords() {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  return {
    label: (template: RotationTemplate) =>
      t(
        `teamOpt.templates.kind.${template.kind}`,
        rotationTemplateKinds[template.kind]
      ),
    length: (template: RotationTemplate) =>
      template.rotations && template.rotations > 1
        ? t('teamOpt.templates.rotations', '{{count}} rotations · {{s}} s', {
            count: template.rotations,
            s: template.seconds.toFixed(1),
          })
        : t('teamOpt.templates.seconds', '{{s}} s', {
            s: template.seconds.toFixed(1),
          }),
    missing: (template: RotationTemplate, team: CharacterKey[]) => {
      const out = template.members.filter((m) => !team.includes(m))
      return out.length
        ? t('teamOpt.templates.missing', 'Not in this team: {{names}}', {
            names: out
              .map((k) =>
                t(`charNames_gen:${charKeyToLocGenderedCharKey(k, gender)}`)
              )
              .join(', '),
          })
        : ''
    },
  }
}

/** The template's team, the main DPS first; members not in this team dimmed */
function TemplateFaces({
  template,
  team,
  size = 22,
}: {
  template: RotationTemplate
  team: CharacterKey[]
  size?: number
}) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
      {template.members.map((k) => (
        <Box
          key={k}
          sx={
            team.includes(k)
              ? undefined
              : { opacity: 0.35, filter: 'grayscale(1)' }
          }
        >
          <MemberAvatar characterKey={k} size={size} />
        </Box>
      ))}
    </Box>
  )
}

/** One template: its team, kind and length (and which members this team lacks) */
function TemplateRow({
  template,
  team,
}: {
  template: RotationTemplate
  team: CharacterKey[]
}) {
  const words = useTemplateWords()
  const missing = words.missing(template, team)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
      <TemplateFaces template={template} team={team} />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 600 }}>
          {words.label(template)}
        </Typography>
        <Typography
          noWrap
          title={missing || template.source.name}
          sx={{ ...type.label, fontSize: 11.5 }}
        >
          {missing || template.source.name}
        </Typography>
      </Box>
      <Typography
        sx={{ ...type.label, ...numSx, flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        {words.length(template)}
      </Typography>
    </Box>
  )
}

const infoText = (t: ReturnType<typeof useTranslation>['t']) =>
  t(
    'teamOpt.templates.info',
    'Standard rotations for these main DPS characters, from KQM’s guides and team calcs (community calcs where KQM has none), each played here first. Picking one opens it in the writer; members it uses that are not in this team are left out.'
  )

/** The start screen's templates for the team: a card each, opening it in the writer */
export function TemplateCards({
  templates,
  team,
  onPick,
}: {
  templates: RotationTemplate[]
  team: CharacterKey[]
  onPick: (template: RotationTemplate) => void
}) {
  const { t } = useTranslation('page_team')
  if (!templates.length) return null
  return (
    <Box sx={{ width: '100%', maxWidth: 620, mt: 2.5 }}>
      <Typography
        component="h4"
        sx={{
          ...type.label,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          mb: 1,
        }}
      >
        {t('teamOpt.templates.heading', 'Templates')}
        <InfoTooltipInline title={infoText(t)} />
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            // (one template takes the row: its name and source are not cut short)
            sm:
              templates.length > 1
                ? 'repeat(2, minmax(0, 1fr))'
                : 'minmax(0, 1fr)',
          },
          gap: 1,
        }}
      >
        {templates.slice(0, 6).map((template) => (
          <ButtonBase
            key={template.id}
            focusRipple
            onClick={() => onPick(template)}
            sx={{
              ...quickSx,
              ...focusSx,
              display: 'block',
              textAlign: 'left',
              px: 1.5,
              py: 1.1,
              borderRadius: tokens.radius.inset,
              bgcolor: tokens.inset,
              border: hairline,
              '&:hover': {
                borderColor: tokens.hairlineStrong,
                bgcolor: alpha('#ffffff', 0.02),
              },
            }}
          >
            <TemplateRow template={template} team={team} />
          </ButtonBase>
        ))}
      </Box>
    </Box>
  )
}

/** The writer's Templates menu: picking one puts its rotation (and first rotation) in the boxes */
export function TemplatesButton({
  templates,
  team,
  onPick,
}: {
  templates: RotationTemplate[]
  team: CharacterKey[]
  onPick: (template: RotationTemplate) => void
}) {
  const { t } = useTranslation('page_team')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!templates.length) return null
  return (
    <>
      <Button
        size="small"
        color="inherit"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          fontSize: 12.5,
          whiteSpace: 'nowrap',
          color: anchor ? 'primary.main' : 'text.secondary',
        }}
      >
        {t('teamOpt.templates.heading', 'Templates')}
      </Button>
      <Menu
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: '92vw' } } }}
      >
        <Typography
          sx={{
            ...type.label,
            px: 2,
            pt: 0.75,
            pb: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          {t('teamOpt.templates.replace', 'Replaces the rotation written here')}
          <InfoTooltipInline title={infoText(t)} />
        </Typography>
        {templates.map((template) => (
          <ButtonBase
            key={template.id}
            role="menuitem"
            onClick={() => {
              setAnchor(null)
              onPick(template)
            }}
            sx={{
              ...quickSx,
              ...focusSx,
              display: 'block',
              width: '100%',
              textAlign: 'left',
              px: 2,
              py: 1,
              '&:hover': { bgcolor: alpha('#ffffff', 0.04) },
            }}
          >
            <TemplateRow template={template} team={team} />
          </ButtonBase>
        ))}
      </Menu>
    </>
  )
}
