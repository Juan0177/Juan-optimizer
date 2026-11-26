import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DownloadIcon from '@mui/icons-material/Download'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import type { ButtonProps } from '@mui/material'
import {
  Alert,
  Box,
  Button,
  CardContent,
  Divider,
  IconButton,
  LinearProgress,
  Skeleton,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SubstatToggle } from '../../artifact/SubstatToggle'
import { useBuildCardData } from './buildCardData'
import { CARD_HEIGHT, CARD_WIDTH, renderBuildCard } from './renderBuildCard'
import { embedWatermark, pngWithRecord } from './shareWatermark'

const canCopyImage = () =>
  typeof window !== 'undefined' &&
  'ClipboardItem' in window &&
  !!navigator.clipboard?.write

/**
 * "Build card": a shareable PNG of the character's build, from the page's DataContext (the
 * equipped build on the character page; on a team page, the loadout's build), with the
 * character's own stats
 */
export function BuildCardButton({
  disabledReason,
  compact = false,
  ...props
}: ButtonProps & {
  /** why there is no card to make (the button is then disabled, with this as its tooltip) */
  disabledReason?: string
  /** only the icon (its name as the tooltip), for narrow screens */
  compact?: boolean
}) {
  const { t } = useTranslation('ui')
  const [open, setOpen] = useState(false)
  const label = t('buildCard.button', 'Build card')
  const button = (
    <Button
      variant="outlined"
      color="neutral400"
      size="small"
      startIcon={compact ? undefined : <ImageOutlinedIcon />}
      aria-label={compact ? label : undefined}
      onClick={() => setOpen(true)}
      disabled={!!disabledReason}
      {...props}
      sx={[
        compact ? { minWidth: 0, px: 1 } : {},
        ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
      ]}
    >
      {compact ? <ImageOutlinedIcon /> : label}
    </Button>
  )
  const tooltip = disabledReason ?? (compact ? label : undefined)
  return (
    <>
      {tooltip ? (
        <Tooltip title={tooltip}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      {open && <BuildCardDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function BuildCardDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['ui', 'artifact'])
  const database = useDatabase()
  const data = useBuildCardData()
  const render = useMemo(() => data && (() => renderBuildCard(data)), [data])
  return (
    <CardImageDialog
      title={t('buildCard.title', 'Build card')}
      alt={t('buildCard.alt', {
        defaultValue: '{{name}}’s build',
        name: data?.name,
      })}
      fileName={data ? `${safeName(data.characterKey)}-build` : 'build'}
      aspectRatio={`${CARD_WIDTH} / ${CARD_HEIGHT}`}
      render={render}
      onClose={onClose}
    >
      {data && (
        <>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            {t('artifact:efficiencyFilter.title')}
          </Typography>
          <SubstatToggle
            quiet
            selectedKeys={data.rvKeys}
            onChange={(rvFilter) =>
              database.charMeta.set(data.characterKey, { rvFilter })
            }
          />
        </>
      )}
    </CardImageDialog>
  )
}

/**
 * A picture to share: its preview, then any controls (`children`), then Copy image and Download
 * PNG. `render` draws it, again whenever it changes: the last picture stays up meanwhile, and a
 * quick series of changes is drawn once.
 */
export function CardImageDialog({
  title,
  alt,
  fileName,
  aspectRatio,
  render,
  format = 'png',
  watermark,
  header,
  placeholder,
  onClose,
  children,
}: {
  title: string
  alt: string
  /** without its date and extension: "Furina-build" saves as "Furina-build-2026-11-09.png" */
  fileName: string
  /** the picture's usual proportions, for its placeholder: "1600 / 958" */
  aspectRatio: string
  /** undefined while its data is not ready */
  render: (() => Promise<HTMLCanvasElement>) | undefined
  /**
   * the file to download: a PNG, or a JPEG for a large picture (a fraction of the size, to stay
   * shareable). Copying always copies a PNG (the clipboard takes no other images).
   */
  format?: 'png' | 'jpeg'
  /**
   * a hidden record of how the picture was made (any JSON), for debugging a shared picture: in
   * its pixels and its PNG file (`shareWatermark.ts`; a JPEG keeps neither). Read when drawn.
   */
  watermark?: () => unknown
  /** controls above the picture (what it shows: a member's tabs) */
  header?: ReactNode
  /**
   * shown in the picture's place while there is nothing to draw (`render` undefined): what to set
   * before it is made; absent: a placeholder of the picture's shape
   */
  placeholder?: ReactNode
  onClose: () => void
  children?: ReactNode
}) {
  const { t } = useTranslation('ui')
  const [canvas, setCanvas] = useState<HTMLCanvasElement | undefined>()
  const [blobState, setBlobState] = useState<{
    canvas: HTMLCanvasElement
    blob: Blob
  }>()
  const [busy, setBusy] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)
  const touch = useMediaQuery('(pointer: coarse)')
  const [zoomed, setZoomed] = useState(false)

  const watermarkRef = useRef(watermark)
  watermarkRef.current = watermark
  const hasRenderedRef = useRef(false)
  // Cache the encoded (and watermarked) blob per rendered canvas so preview shows immediately
  // without blocking on slow PNG compression.
  const blobTaskRef = useRef<
    { canvas: HTMLCanvasElement; promise: Promise<Blob> } | undefined
  >()

  const encodeCanvas = useCallback(
    (target: HTMLCanvasElement, fmt: 'png' | 'jpeg'): Promise<Blob> => {
      if (blobTaskRef.current?.canvas === target)
        return blobTaskRef.current.promise
      const promise = (async () => {
        let record: unknown
        try {
          if (fmt === 'png') record = watermarkRef.current?.()
        } catch {
          record = undefined
        }
        if (record) await embedWatermark(target, record).catch(() => {})
        let blob = await new Promise<Blob | null>((resolve) =>
          target.toBlob(resolve, `image/${fmt}`, 0.92)
        )
        if (!blob) throw new Error('The image could not be made')
        if (record) blob = await pngWithRecord(blob, record).catch(() => blob!)
        return blob
      })()
      blobTaskRef.current = { canvas: target, promise }
      return promise
    },
    []
  )

  useEffect(() => {
    if (!render) return
    let cancelled = false
    let bgTimer: ReturnType<typeof setTimeout> | undefined
    setBusy(true)
    setError(undefined)
    const timer = setTimeout(
      () =>
        render()
          .then((drawn) => {
            if (cancelled) return
            hasRenderedRef.current = true
            blobTaskRef.current = undefined
            setBlobState(undefined)
            setCanvas(drawn)
            setBusy(false)
            // Pre-encode lazily after the canvas paints so Download/Copy/Share stay instant
            // without stalling interactive checkbox/order edits.
            bgTimer = setTimeout(() => {
              if (cancelled) return
              encodeCanvas(drawn, format)
                .then((blob) => {
                  if (!cancelled) setBlobState({ canvas: drawn, blob })
                })
                .catch(() => {})
            }, 180)
          })
          .catch((e) => {
            if (cancelled) return
            setError(String(e?.message ?? e))
            setBusy(false)
          }),
      hasRenderedRef.current ? 80 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (bgTimer) clearTimeout(bgTimer)
    }
  }, [render, format, encodeCanvas])

  const readyBlob =
    blobState && blobState.canvas === canvas ? blobState.blob : undefined
  const fullName = `${fileName}-${new Date().toISOString().slice(0, 10)}.${format === 'jpeg' ? 'jpg' : 'png'}`

  const ensureBlob = async () => {
    if (!canvas) return undefined
    if (readyBlob) return readyBlob
    setExporting(true)
    try {
      const blob = await encodeCanvas(canvas, format)
      setBlobState({ canvas, blob })
      return blob
    } finally {
      setExporting(false)
    }
  }

  const download = async () => {
    if (!canvas) return
    try {
      const blob = await ensureBlob()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fullName
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }
  const shareFile = useMemo(
    () =>
      readyBlob && touch
        ? new File([readyBlob], fullName, { type: readyBlob.type })
        : undefined,
    [readyBlob, touch, fullName]
  )
  const canShare =
    touch &&
    !!navigator.canShare &&
    (shareFile
      ? navigator.canShare({ files: [shareFile] })
      : !!canvas &&
        navigator.canShare({
          files: [new File([''], fullName, { type: `image/${format}` })],
        }))
  const share = async () => {
    if (!canvas) return
    try {
      const file =
        shareFile ??
        (await ensureBlob().then(
          (b) => b && new File([b], fullName, { type: b.type })
        ))
      if (!file) return
      await navigator.share({ files: [file], title })
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError')
        setError(String((e as Error)?.message ?? e))
    }
  }
  const copy = async () => {
    if (!canvas) return
    try {
      const pngPromise =
        format === 'png'
          ? readyBlob
            ? Promise.resolve(readyBlob)
            : encodeCanvas(canvas, 'png')
          : new Promise<Blob>((resolve, reject) =>
              canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('No image'))),
                'image/png'
              )
            )
      // Passing the Promise directly keeps the browser user-gesture active even if encoding is
      // still finishing.
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngPromise }),
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }

  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'lg' }}
      aria-labelledby="card-image-title"
    >
      <CardThemed>
        <CardContent
          sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}
        >
          <Typography
            variant="h6"
            component="h2"
            id="card-image-title"
            sx={{ flexGrow: 1 }}
          >
            {title}
          </Typography>
          <IconButton
            onClick={onClose}
            size="small"
            aria-label={t('buildCard.close', 'Close')}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </CardContent>
        <Divider />
        {header && <Box sx={{ px: 2, pt: 1 }}>{header}</Box>}
        <CardContent>
          {placeholder && !render ? (
            placeholder
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : canvas ? (
            <Box sx={{ position: 'relative' }}>
              <Box
                onClick={touch ? () => setZoomed((z) => !z) : undefined}
                sx={{
                  overflow: zoomed ? 'auto' : 'visible',
                  maxHeight: zoomed ? '65vh' : undefined,
                  borderRadius: 1,
                }}
              >
                <CanvasPreview
                  canvas={canvas}
                  alt={alt}
                  zoomed={zoomed}
                  busy={busy}
                />
              </Box>
              {touch && (
                <IconButton
                  size="small"
                  onClick={() => setZoomed((z) => !z)}
                  aria-label={
                    zoomed
                      ? t('buildCard.zoomOut', 'Fit to screen')
                      : t('buildCard.zoomIn', 'Zoom in')
                  }
                  sx={{
                    position: 'absolute',
                    right: 8,
                    bottom: 8,
                    color: '#fff',
                    bgcolor: 'rgba(0, 0, 0, 0.55)',
                    '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.7)' },
                  }}
                >
                  {zoomed ? (
                    <ZoomOutRoundedIcon fontSize="small" />
                  ) : (
                    <ZoomInRoundedIcon fontSize="small" />
                  )}
                </IconButton>
              )}
              {busy && (
                <LinearProgress
                  sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 0,
                    borderRadius: 1,
                  }}
                />
              )}
            </Box>
          ) : (
            <Skeleton
              variant="rounded"
              sx={{ width: '100%', height: 'auto', aspectRatio }}
            />
          )}
        </CardContent>
        {children && (
          <>
            <Divider />
            <CardContent
              sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
            >
              {children}
            </CardContent>
          </>
        )}
        <Divider />
        <CardContent
          sx={{
            display: 'flex',
            gap: 1,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            py: 1.5,
            '&:last-child': { pb: 1.5 },
          }}
        >
          {canCopyImage() && (
            <Button
              variant="outlined"
              color="neutral400"
              startIcon={canShare ? undefined : <ContentCopyIcon />}
              onClick={copy}
              disabled={
                !canvas || busy || exporting || (!!placeholder && !render)
              }
              aria-label={
                canShare
                  ? copied
                    ? t('buildCard.copied', 'Copied')
                    : t('buildCard.copy', 'Copy image')
                  : undefined
              }
              sx={canShare ? { minWidth: 0, px: 1.25 } : undefined}
            >
              {canShare ? (
                copied ? (
                  <CheckRoundedIcon />
                ) : (
                  <ContentCopyIcon />
                )
              ) : copied ? (
                t('buildCard.copied', 'Copied')
              ) : (
                t('buildCard.copy', 'Copy image')
              )}
            </Button>
          )}
          <Button
            variant={canShare ? 'outlined' : 'contained'}
            color={canShare ? 'neutral400' : undefined}
            startIcon={<DownloadIcon />}
            onClick={download}
            disabled={
              !canvas || busy || exporting || (!!placeholder && !render)
            }
          >
            {format === 'jpeg'
              ? t('buildCard.downloadJpg', 'Download JPG')
              : t('buildCard.download', 'Download PNG')}
          </Button>
          {canShare && (
            <Button
              variant="contained"
              startIcon={<IosShareRoundedIcon />}
              onClick={share}
              disabled={busy || exporting}
            >
              {t('buildCard.share', 'Share')}
            </Button>
          )}
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}

/** Displays the rendered canvas directly without blocking preview on PNG encoding. */
function CanvasPreview({
  canvas,
  alt,
  zoomed,
  busy,
}: {
  canvas: HTMLCanvasElement
  alt: string
  zoomed: boolean
  busy: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', alt)
    canvas.style.display = 'block'
    canvas.style.maxWidth = 'none'
    canvas.style.height = 'auto'
    canvas.style.borderRadius = '4px'
    host.replaceChildren(canvas)
    return () => {
      if (canvas.parentElement === host) host.removeChild(canvas)
    }
  }, [canvas, alt])
  useEffect(() => {
    canvas.style.width = zoomed ? `max(100%, ${canvas.width / 2}px)` : '100%'
    canvas.style.opacity = busy ? '0.7' : '1'
    canvas.style.transition = 'opacity 150ms'
  }, [canvas, zoomed, busy])
  return <Box ref={hostRef} />
}

/** A name as a file name: letters and digits only ("Furina", "SandroneMityaDanica") */
export function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9]+/g, '') || 'card'
}
