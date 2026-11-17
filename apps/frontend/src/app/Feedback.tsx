import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import { currentRelease } from '@genshin-optimizer/gi/ui'
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  IconButton,
  InputBase,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'

declare const __GO_BUILD_ID__: string

/**
 * Where feedback goes: the stellar-feedback Worker (tools/feedback-worker), which keeps it where only
 * the site's owner can read it (tools/site/feedback.mjs), served at stellaroptimizer.com/api/feedback.
 * On a local page, the local Worker
 * (`npx wrangler@4 dev` there).
 */
const FEEDBACK_URL = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(
  globalThis.location?.host ?? ''
)
  ? 'http://127.0.0.1:8787/feedback'
  : 'https://stellaroptimizer.com/api/feedback'
/** Screenshots a message can carry, and the most each one may be once made small (a data URL) */
const MAX_SHOTS = 4
const MAX_SHOT_CHARS = 2_900_000

type Kind = 'bug' | 'idea' | 'other'
interface Shot {
  id: string
  url: string
}

/**
 * A screenshot made small enough to send: at most 1920 px across, WebP (JPEG where the browser
 * cannot write WebP), smaller again if it is still too large
 */
async function shrink(file: Blob): Promise<string | undefined> {
  const bitmap = await createImageBitmap(file)
  for (const [side, quality] of [
    [1920, 0.85],
    [1600, 0.75],
    [1280, 0.65],
  ] as const) {
    const ratio = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * ratio)
    canvas.height = Math.round(bitmap.height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    let url = canvas.toDataURL('image/webp', quality)
    if (!url.startsWith('data:image/webp'))
      url = canvas.toDataURL('image/jpeg', quality)
    if (url.length <= MAX_SHOT_CHARS) return url
  }
  return undefined
}

/**
 * Feedback, from any page: a small button at the bottom right opens a panel to report a bug or send
 * an idea, with screenshots (added, dropped anywhere on the panel or pasted) and, if they like, a
 * Discord name for a reply. The page and the app's version go with it. Drafts survive closing it.
 */
export function FeedbackButton() {
  const { t } = useTranslation('ui')
  const { pathname } = useLocation()
  const anchor = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const messageInput = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('bug')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState<
    'idle' | 'sending' | 'sent' | 'error' | 'limited'
  >('idle')
  const [note, setNote] = useState<string>()
  // (a moment after it is sent, the panel closes by itself)
  useEffect(() => {
    if (status !== 'sent') return
    const id = setTimeout(() => setOpen(false), 2400)
    return () => clearTimeout(id)
  }, [status])
  const opened = () => {
    if (status === 'sent') {
      setStatus('idle')
      setMessage('')
      setShots([])
    }
    setOpen(true)
  }

  const attach = async (files: Iterable<File>) => {
    const images = [...files].filter((f) => f.type.startsWith('image/'))
    if (!images.length) return
    const room = MAX_SHOTS - shots.length
    if (room <= 0) {
      setNote(
        t('feedback.tooMany', {
          defaultValue: 'Up to {{count}} screenshots.',
          count: MAX_SHOTS,
        })
      )
      return
    }
    setNote(undefined)
    const made = await Promise.all(
      images.slice(0, room).map((f) => shrink(f).catch(() => undefined))
    )
    const added = made
      .filter((url): url is string => !!url)
      .map((url) => ({ id: crypto.randomUUID(), url }))
    if (added.length < made.length)
      setNote(t('feedback.unreadable', 'A file could not be read as an image.'))
    if (images.length > room)
      setNote(
        t('feedback.tooMany', {
          defaultValue: 'Up to {{count}} screenshots.',
          count: MAX_SHOTS,
        })
      )
    setShots((s) => [...s, ...added].slice(0, MAX_SHOTS))
  }

  const send = async () => {
    if (message.trim().length < 3 || status === 'sending') return
    setStatus('sending')
    try {
      const response = await fetch(FEEDBACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          contact: contact.trim() || undefined,
          page: pathname,
          version: currentRelease.version,
          build: typeof __GO_BUILD_ID__ === 'string' ? __GO_BUILD_ID__ : 'dev',
          site: globalThis.location?.host,
          images: shots.map((s) => s.url),
          // (left empty: a field only bots fill in)
          website: '',
        }),
      })
      if (response.status === 429) return setStatus('limited')
      if (!response.ok) throw new Error(String(response.status))
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  const placeholder = {
    bug: t(
      'feedback.bugPlaceholder',
      'What happened, and what did you expect? Steps to see it again help a lot.'
    ),
    idea: t('feedback.ideaPlaceholder', 'What would make it better for you?'),
    other: t('feedback.otherPlaceholder', 'Your message'),
  }[kind]
  const ready = message.trim().length >= 3 && status !== 'sending'

  return (
    <>
      <Tooltip
        title={t('feedback.button', 'Feedback')}
        placement="left"
        disableHoverListener={open}
      >
        <ButtonBase
          ref={anchor}
          onClick={opened}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t('feedback.open', 'Send feedback or report a bug')}
          sx={(theme) => ({
            position: 'fixed',
            right: 16,
            bottom: 20,
            zIndex: theme.zIndex.speedDial,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            height: 40,
            px: { xs: 0, sm: 1.75 },
            width: { xs: 40, sm: 'auto' },
            justifyContent: 'center',
            borderRadius: 999,
            bgcolor: alpha(giTokens.panelRaised, 0.92),
            backdropFilter: 'blur(8px)',
            color: giTokens.parchment,
            boxShadow: `inset 0 0 0 1px ${giTokens.hairlineStrong}, 0 8px 24px rgba(0, 0, 0, 0.35)`,
            fontSize: 13.5,
            fontWeight: 600,
            transition: 'color .15s, box-shadow .15s, transform .15s',
            '&:hover': {
              color: giTokens.gold,
              boxShadow: `inset 0 0 0 1px ${alpha(giTokens.gold, 0.55)}, 0 8px 24px rgba(0, 0, 0, 0.35)`,
            },
            '&:focus-visible': {
              outline: `2px solid ${giTokens.gold}`,
              outlineOffset: 2,
            },
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          })}
        >
          <FeedbackOutlinedIcon sx={{ fontSize: 19 }} />
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            {t('feedback.button', 'Feedback')}
          </Box>
        </ButtonBase>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchor.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        // (the message box takes the focus once the panel is in: the popover keeps it otherwise)
        disableAutoFocus
        TransitionProps={{ onEntered: () => messageInput.current?.focus() }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-labelledby': titleId,
            sx: {
              mt: -1.25,
              width: { xs: 'calc(100vw - 16px)', sm: 380 },
              maxWidth: 380,
              borderRadius: 3,
              bgcolor: giTokens.panel,
              backgroundImage: 'none',
              boxShadow: `inset 0 0 0 1px ${giTokens.hairlineStrong}, 0 16px 48px rgba(0, 0, 0, 0.5)`,
              overflow: 'hidden',
            },
          },
        }}
      >
        <Box
          onDragEnter={(e) => {
            if (e.dataTransfer.types.includes('Files')) setDragging(true)
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            attach(e.dataTransfer.files)
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (files.some((f) => f.type.startsWith('image/'))) {
              e.preventDefault()
              attach(files)
            }
          }}
          sx={{ position: 'relative', p: 2, display: 'grid', gap: 1.5 }}
        >
          {/* dropping files: the whole panel takes them */}
          {dragging && (
            <Box
              sx={{
                position: 'absolute',
                inset: 6,
                zIndex: 2,
                borderRadius: 2.5,
                border: `2px dashed ${giTokens.gold}`,
                bgcolor: alpha(giTokens.panel, 0.92),
                display: 'grid',
                placeItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <Typography sx={{ fontWeight: 650, color: giTokens.gold }}>
                {t('feedback.drop', 'Drop to attach')}
              </Typography>
            </Box>
          )}

          {status === 'sent' ? (
            <Box
              role="status"
              sx={{ display: 'grid', justifyItems: 'center', gap: 1, py: 3 }}
            >
              <CheckCircleRoundedIcon
                sx={{ fontSize: 36, color: giTokens.gold }}
              />
              <Typography sx={{ fontSize: 16, fontWeight: 650 }}>
                {t('feedback.sent', 'Sent. Thank you!')}
              </Typography>
              <Typography sx={{ fontSize: 13, color: giTokens.parchmentMuted }}>
                {contact.trim()
                  ? t('feedback.sentReply', 'You may get a reply on Discord.')
                  : t('feedback.sentNoReply', 'Every message is read.')}
              </Typography>
            </Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography
                  id={titleId}
                  sx={{ fontSize: 15.5, fontWeight: 650, flex: 1 }}
                >
                  {t('feedback.title', 'Send feedback')}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => setOpen(false)}
                  aria-label={t('feedback.close', 'Close')}
                  sx={{ mr: -0.75, color: giTokens.parchmentMuted }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>

              <ToggleButtonGroup
                exclusive
                size="small"
                value={kind}
                onChange={(_, value: Kind | null) => value && setKind(value)}
                aria-label={t('feedback.kind', 'Kind of feedback')}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  bgcolor: giTokens.panelDark,
                  borderRadius: 2,
                  p: 0.375,
                  '& .MuiToggleButton-root': {
                    border: 0,
                    borderRadius: '6px !important',
                    py: 0.5,
                    textTransform: 'none',
                    fontSize: 13,
                    fontWeight: 600,
                    color: giTokens.parchmentMuted,
                    '&.Mui-selected': {
                      bgcolor: giTokens.panelRaised,
                      color: giTokens.parchment,
                      boxShadow: `inset 0 0 0 1px ${giTokens.hairlineStrong}`,
                    },
                  },
                }}
              >
                <ToggleButton value="bug">
                  {t('feedback.bug', 'Bug')}
                </ToggleButton>
                <ToggleButton value="idea">
                  {t('feedback.idea', 'Idea')}
                </ToggleButton>
                <ToggleButton value="other">
                  {t('feedback.other', 'Other')}
                </ToggleButton>
              </ToggleButtonGroup>

              <InputBase
                inputRef={messageInput}
                multiline
                minRows={4}
                maxRows={10}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value)
                  if (status !== 'idle') setStatus('idle')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder={placeholder}
                inputProps={{
                  'aria-label': t('feedback.message', 'Message'),
                  maxLength: 4000,
                }}
                sx={fieldSx}
              />

              {/* screenshots: added, dropped or pasted */}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {shots.map((shot) => (
                  <Box
                    key={shot.id}
                    sx={{
                      position: 'relative',
                      width: 64,
                      height: 64,
                      borderRadius: 1.5,
                      overflow: 'hidden',
                      boxShadow: `inset 0 0 0 1px ${giTokens.hairlineStrong}`,
                    }}
                  >
                    <Box
                      component="img"
                      src={shot.url}
                      alt=""
                      sx={{ width: 1, height: 1, objectFit: 'cover' }}
                    />
                    <IconButton
                      size="small"
                      onClick={() =>
                        setShots((s) => s.filter((x) => x.id !== shot.id))
                      }
                      aria-label={t('feedback.removeShot', 'Remove screenshot')}
                      sx={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        p: 0.25,
                        bgcolor: 'rgba(10, 10, 14, 0.72)',
                        color: giTokens.parchment,
                        '&:hover': { bgcolor: 'rgba(10, 10, 14, 0.9)' },
                      }}
                    >
                      <CloseRoundedIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                ))}
                {shots.length < MAX_SHOTS && (
                  <ButtonBase
                    onClick={() => fileInput.current?.click()}
                    sx={{
                      flex: shots.length ? '0 0 auto' : 1,
                      minWidth: 64,
                      height: 64,
                      px: shots.length ? 0 : 1.5,
                      borderRadius: 1.5,
                      border: `1px dashed ${giTokens.hairlineStrong}`,
                      color: giTokens.parchmentMuted,
                      gap: 1,
                      justifyContent: shots.length ? 'center' : 'flex-start',
                      transition: 'color .15s, border-color .15s',
                      '&:hover': {
                        color: giTokens.parchment,
                        borderColor: alpha(giTokens.gold, 0.6),
                      },
                      '&:focus-visible': {
                        outline: `2px solid ${giTokens.gold}`,
                        outlineOffset: 2,
                      },
                    }}
                  >
                    <AddPhotoAlternateOutlinedIcon sx={{ fontSize: 20 }} />
                    {!shots.length && (
                      <Typography sx={{ fontSize: 12.5, textAlign: 'left' }}>
                        {t(
                          'feedback.addShots',
                          'Add screenshots: click, drop or paste'
                        )}
                      </Typography>
                    )}
                  </ButtonBase>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) attach(e.target.files)
                    e.target.value = ''
                  }}
                />
              </Box>

              <InputBase
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t(
                  'feedback.contact',
                  'Discord name, if you would like a reply'
                )}
                inputProps={{
                  'aria-label': t('feedback.contactLabel', 'Discord name'),
                  maxLength: 100,
                }}
                sx={{ ...fieldSx, '& textarea, & input': { py: 0 } }}
              />

              {(note || status === 'error' || status === 'limited') && (
                <Typography
                  role="status"
                  sx={{
                    fontSize: 12.5,
                    color:
                      status === 'error' || status === 'limited'
                        ? 'error.main'
                        : giTokens.parchmentMuted,
                  }}
                >
                  {status === 'error'
                    ? t(
                        'feedback.error',
                        'Could not send. Check your connection and try again.'
                      )
                    : status === 'limited'
                      ? t(
                          'feedback.limited',
                          'Several sent already. Please try again in an hour.'
                        )
                      : note}
                </Typography>
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography
                  sx={{
                    fontSize: 11.5,
                    color: giTokens.parchmentMuted,
                    flex: 1,
                  }}
                >
                  {t(
                    'feedback.includes',
                    'The page and app version are included.'
                  )}
                </Typography>
                <Button
                  variant="contained"
                  disabled={!ready}
                  onClick={send}
                  sx={{
                    ...giCtaSx,
                    textTransform: 'none',
                    fontWeight: 650,
                    px: 2.25,
                    '&.Mui-disabled': {
                      bgcolor: alpha(giTokens.gold, 0.25),
                      color: alpha('#17181f', 0.6),
                    },
                  }}
                >
                  {status === 'sending'
                    ? t('feedback.sending', 'Sending…')
                    : t('feedback.send', 'Send')}
                </Button>
              </Box>
            </>
          )}
        </Box>
      </Popover>
    </>
  )
}

const fieldSx = {
  width: '100%',
  px: 1.5,
  py: 1,
  fontSize: 14,
  lineHeight: 1.5,
  borderRadius: 2,
  bgcolor: giTokens.panelDark,
  boxShadow: `inset 0 0 0 1px ${giTokens.hairline}`,
  transition: 'box-shadow .15s',
  '&.Mui-focused': {
    boxShadow: `inset 0 0 0 1px ${alpha(giTokens.gold, 0.7)}, 0 0 0 3px ${alpha(giTokens.gold, 0.14)}`,
  },
  '& textarea::placeholder, & input::placeholder': {
    color: giTokens.parchmentMuted,
    opacity: 0.8,
  },
} as const
