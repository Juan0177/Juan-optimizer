import { theme as commonTheme } from '@genshin-optimizer/common/ui'
import type { PaletteColor, Theme, ThemeOptions } from '@mui/material'
import { alpha, createTheme } from '@mui/material'

declare module '@mui/material/styles' {
  interface Palette {
    geo: Palette['primary']
    dendro: Palette['primary']
    pyro: Palette['primary']
    hydro: Palette['primary']
    cryo: Palette['primary']
    electro: Palette['primary']
    anemo: Palette['primary']
    physical: Palette['primary']

    vaporize: Palette['primary']
    melt: Palette['primary']
    spread: Palette['primary']
    aggravate: Palette['primary']
    overloaded: Palette['primary']
    superconduct: Palette['primary']
    electrocharged: Palette['primary']
    lunarcharged: Palette['primary']
    shattered: Palette['primary']
    swirl: Palette['primary']
    burning: Palette['primary']
    crystallize: Palette['primary']
    heal: Palette['primary']
    bloom: Palette['primary']
    burgeon: Palette['primary']
    hyperbloom: Palette['primary']
    lunarbloom: Palette['primary']
    lunarcrystallize: Palette['primary']
    stellarconduct: Palette['primary']
    stellarcryo: Palette['primary']
    stellarswirl: Palette['primary']
  }

  interface PaletteOptions {
    geo?: PaletteOptions['primary']
    dendro?: PaletteOptions['primary']
    pyro?: PaletteOptions['primary']
    hydro?: PaletteOptions['primary']
    cryo?: PaletteOptions['primary']
    electro?: PaletteOptions['primary']
    anemo?: PaletteOptions['primary']
    physical?: PaletteOptions['primary']

    vaporize?: PaletteOptions['primary']
    melt?: PaletteOptions['primary']
    spread?: PaletteOptions['primary']
    aggravate?: PaletteOptions['primary']
    overloaded?: PaletteOptions['primary']
    superconduct?: PaletteOptions['primary']
    electrocharged?: PaletteOptions['primary']
    lunarcharged?: PaletteOptions['primary']
    shattered?: PaletteOptions['primary']
    swirl?: PaletteOptions['primary']
    burning?: PaletteOptions['primary']
    crystallize?: PaletteOptions['primary']
    heal?: PaletteOptions['primary']
    bloom?: PaletteOptions['primary']
    burgeon?: PaletteOptions['primary']
    hyperbloom?: PaletteOptions['primary']
    lunarbloom?: PaletteOptions['primary']
    lunarcrystallize?: PaletteOptions['primary']
    stellarconduct?: PaletteOptions['primary']
    stellarcryo?: PaletteOptions['primary']
    stellarswirl?: PaletteOptions['primary']
  }
}

declare module '@mui/material/Button' {
  interface ButtonPropsColorOverrides {
    geo: true
    dendro: true
    pyro: true
    hydro: true
    cryo: true
    electro: true
    anemo: true
    physical: true

    vaporize: true
    melt: true
    spread: true
    aggravate: true
    overloaded: true
    superconduct: true
    electrocharged: true
    lunarcharged: true
    shattered: true
    swirl: true
    burning: true
    crystallize: true
    heal: true
    bloom: true
    burgeon: true
    hyperbloom: true
    lunarbloom: true
    lunarcrystallize: true
    stellarconduct: true
    stellarcryo: true
    stellarswirl: true
  }
}

declare module '@mui/material/Chip' {
  interface ChipPropsColorOverrides {
    geo: true
    dendro: true
    pyro: true
    hydro: true
    cryo: true
    electro: true
    anemo: true
    physical: true

    vaporize: true
    melt: true
    spread: true
    aggravate: true
    overloaded: true
    superconduct: true
    electrocharged: true
    lunarcharged: true
    shattered: true
    swirl: true
    burning: true
    crystallize: true
    heal: true
    bloom: true
    burgeon: true
    hyperbloom: true
    lunarbloom: true
    lunarcrystallize: true
    stellarconduct: true
    stellarcryo: true
    stellarswirl: true
  }
}

declare module '@mui/material/InputBase' {
  interface InputBasePropsColorOverrides {
    geo: true
    dendro: true
    pyro: true
    hydro: true
    cryo: true
    electro: true
    anemo: true
    physical: true

    vaporize: true
    melt: true
  }
}

declare module '@mui/material/SvgIcon' {
  interface SvgIconPropsColorOverrides {
    geo: true
    dendro: true
    pyro: true
    hydro: true
    cryo: true
    electro: true
    anemo: true
    physical: true

    vaporize: true
    melt: true
    spread: true
    aggravate: true
    overloaded: true
    superconduct: true
    electrocharged: true
    lunarcharged: true
    shattered: true
    swirl: true
    burning: true
    crystallize: true
    heal: true
    bloom: true
    burgeon: true
    hyperbloom: true
    lunarbloom: true
    lunarcrystallize: true
    stellarconduct: true
    stellarcryo: true
    stellarswirl: true
  }
}

/**
 * Design tokens of the GI frontend — "Teyvat archive".
 * Graphite surfaces, parchment text and one gold accent. Element colours stay the data colours; the
 * gold is for interactive chrome (actions, the active nav item, focus). Everything else is quiet so
 * numbers, art and element colours carry the screen.
 */
/**
 * Surfaces ("graphite"): a flat near-black page and nav (ink; `glow` is the top of the page's radial
 * gradient, equal to ink so the page is flat), graphite card levels (panelDark < panel < panelRaised
 * < panelHover) and greys for lines and muted chrome. They have no hue of their own. Until
 * 2026-11-05 they were a blue-grey slate with a violet glow (ink #121319, panel #1a1c24, glow
 * #211d33); warm charcoal, deep teal, a #0f0f11 graphite page and pure #000 were tried. Near-black
 * beats #000: same look, but no OLED smear when scrolling and shadows still read.
 */
// juanlab: tre temi scuri, scelti in Impostazioni e salvati nel browser (la pagina si ricarica al cambio, perche i
// colori sono costanti usate in tutto il sito). Tutti verificati WCAG 2.1 AA (testo 4,5:1 sui pannelli).
// - juanlab: "Notte JuanLab" (i colori di juan0177.github.io/JuanLab): blu notte, oro per le azioni, azzurro per le info
// - go: Genshin Optimizer classico: blu GO, pannelli blu-grigi, accento blu
// - stellar: Stellar Optimizer: grafite, pergamena e oro
type ThemePalette = {
  surface: {
    inkDeep: string
    ink: string
    panelDark: string
    panel: string
    panelRaised: string
    panelHover: string
    glow: string
    line: string
    muted: string
  }
  /** testo principale, come r, g, b (serve anche per le trasparenze) */
  text: [number, number, number]
  accent: string
  accentLight: string
  accentDark: string
  info: string
  neutral200: string
  neutral300: string
  neutral400: string
}
const themePalettes = {
  juanlab: {
    surface: {
      inkDeep: '#04060c',
      ink: '#060810',
      panelDark: '#0b101b',
      panel: '#0f1626',
      panelRaised: '#151e31',
      panelHover: '#1b263d',
      glow: '#060810',
      line: '#1f2a3d',
      muted: '#3a4660',
    },
    text: [237, 245, 255],
    accent: '#f5d787',
    accentLight: '#f9e4a8',
    accentDark: '#c9aa5a',
    info: '#85cbff',
    neutral200: '#d3dceb',
    neutral300: '#a3aec2',
    neutral400: '#8591a8',
  },
  go: {
    surface: {
      inkDeep: '#080b17',
      ink: '#0c1020',
      panelDark: '#172032',
      panel: '#1b263b',
      panelRaised: '#2a364d',
      panelHover: '#33415c',
      glow: '#0c1020',
      line: '#2e3a52',
      muted: '#4a5873',
    },
    text: [255, 255, 255],
    accent: '#5aaaf0',
    accentLight: '#86c1f5',
    accentDark: '#1e78c8',
    info: '#4fc3d9',
    neutral200: '#dde3ee',
    neutral300: '#b4bdcf',
    neutral400: '#9aa6bd',
  },
  stellar: {
    surface: {
      inkDeep: '#050506',
      ink: '#08080a',
      panelDark: '#141416',
      panel: '#19191c',
      panelRaised: '#212124',
      panelHover: '#2a2a2e',
      glow: '#08080a',
      line: '#27272b',
      muted: '#3f3f45',
    },
    text: [236, 229, 216],
    accent: '#d3bc8e',
    accentLight: '#e6d5b1',
    accentDark: '#a99260',
    info: '#7aa7d9',
    neutral200: '#d6cfc2',
    neutral300: '#a9a397',
    neutral400: '#9a968f',
  },
} as const satisfies Record<string, ThemePalette>
export type ThemeChoice = keyof typeof themePalettes
export const themeChoices = Object.keys(themePalettes) as ThemeChoice[]
const THEME_KEY = 'juanlab-theme'
export function getThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved && saved in themePalettes ? (saved as ThemeChoice) : 'juanlab'
  } catch {
    return 'juanlab'
  }
}
/** Salva il tema e ricarica la pagina, che riparte con i colori nuovi */
export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice)
  } catch {
    return
  }
  window.location.reload()
}
const P: ThemePalette = themePalettes[getThemeChoice()]
const textRgba = (a: number) => `rgba(${P.text.join(', ')}, ${a})`
const surface = P.surface

const ink = surface.ink
const parchment = `#${P.text.map((v) => v.toString(16).padStart(2, '0')).join('')}`
const gold = P.accent
export const giTokens = {
  ink,
  inkDeep: surface.inkDeep,
  panel: surface.panel,
  panelDark: surface.panelDark,
  panelRaised: surface.panelRaised,
  panelHover: surface.panelHover,
  parchment,
  parchmentMuted: textRgba(0.66),
  gold,
  goldLight: P.accentLight,
  goldDark: P.accentDark,
  /** kept for components written against the first token set */
  starlight: gold,
  hairline: textRgba(0.08),
  hairlineStrong: textRgba(0.16),
  fontFamily: [
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    '"Noto Sans"',
    'sans-serif',
    '"Apple Color Emoji"',
    '"Segoe UI Emoji"',
  ].join(','),
} as const

/** The one solid button per screen (the page's main action); every other button is tonal. */
export const giCtaSx = {
  backgroundColor: gold,
  color: '#0b101b',
  boxShadow: 'none',
  '&:hover': { backgroundColor: giTokens.goldLight, boxShadow: 'none' },
} as const

const augment = (main: string, name: string, extra?: Partial<PaletteColor>) =>
  commonTheme.palette.augmentColor({ color: { main, ...extra }, name })

const elementTheme = createTheme({
  ...commonTheme,
  palette: {
    ...commonTheme.palette,
    background: { default: ink, paper: giTokens.panel },
    text: {
      primary: parchment,
      secondary: textRgba(0.66),
      disabled: textRgba(0.38),
    },
    divider: giTokens.hairline,
    primary: augment(gold, 'primary', {
      light: giTokens.goldLight,
      dark: giTokens.goldDark,
      contrastText: '#0b101b',
    }),
    secondary: augment(surface.muted, 'secondary', { contrastText: parchment }),
    success: augment('#5aae8b', 'success'),
    info: augment(P.info, 'info'),
    warning: augment('#e4b25c', 'warning'),
    error: augment('#df6f62', 'error'),
    contentNormal: augment(giTokens.panel, 'contentNormal'),
    contentDark: augment(giTokens.panelDark, 'contentDark'),
    contentLight: augment(giTokens.panelRaised, 'contentLight'),
    brand500: augment(gold, 'brand500'),
    neutral100: augment(parchment, 'neutral100'),
    neutral200: augment(P.neutral200, 'neutral200'),
    neutral300: augment(P.neutral300, 'neutral300'),
    // juanlab: WCAG 2.1 AA, almeno 4,5:1 anche sui pannelli rialzati
    neutral400: augment(P.neutral400, 'neutral400'),
    neutral500: augment(surface.muted, 'neutral500'),
    neutral600: augment(surface.line, 'neutral600'),
    // the page background is a radial gradient from neutral700 (top) to neutral800
    neutral700: augment(surface.glow, 'neutral700'),
    neutral800: augment(ink, 'neutral800'),
    neutral900: augment(giTokens.inkDeep, 'neutral900'),
    geo: commonTheme.palette.augmentColor({
      color: { main: '#f8ba4e', contrastText: '#222' },
      name: 'geo',
    }),
    dendro: commonTheme.palette.augmentColor({
      color: { main: '#a5c83b', contrastText: '#222' },
      name: 'dendro',
    }),
    pyro: commonTheme.palette.augmentColor({
      color: { main: '#ff5a4f' }, // juanlab: WCAG AA come testo sui pannelli (era #FF3C32)
      name: 'pyro',
    }),
    hydro: commonTheme.palette.augmentColor({
      color: { main: '#6b8cff' }, // juanlab: WCAG AA come testo sui pannelli (era #5680ff)
      name: 'hydro',
    }),
    cryo: commonTheme.palette.augmentColor({
      color: { main: '#77a2e6', contrastText: '#fff' },
      name: 'cryo',
    }),
    electro: commonTheme.palette.augmentColor({
      color: { main: '#cd92e8' }, // juanlab: WCAG AA come testo sui pannelli in tutti i temi (era #b25dcd)
      name: 'electro',
    }),
    anemo: commonTheme.palette.augmentColor({
      color: { main: '#61dbbb', contrastText: '#fff' },
      name: 'anemo',
    }),
    physical: commonTheme.palette.augmentColor({
      color: { main: '#aaaaaa' },
      name: 'physical',
    }),
    vaporize: commonTheme.palette.augmentColor({
      color: { main: '#ffcb65' },
      name: 'vaporize',
    }),
    melt: commonTheme.palette.augmentColor({
      color: { main: '#ffcb65' },
      name: 'melt',
    }),
    spread: commonTheme.palette.augmentColor({
      color: { main: '#3bc8a7', contrastText: '#fff' },
      name: 'spread',
    }),
    aggravate: commonTheme.palette.augmentColor({
      color: { main: '#3ba0c8', contrastText: '#fff' },
      name: 'aggravate',
    }),
    overloaded: commonTheme.palette.augmentColor({
      color: { main: '#ff7e9a' },
      name: 'overloaded',
    }),
    superconduct: commonTheme.palette.augmentColor({
      color: { main: '#b7b1ff' },
      name: 'superconduct',
    }),
    electrocharged: commonTheme.palette.augmentColor({
      color: { main: '#e299fd' },
      name: 'electrocharged',
    }),
    lunarcharged: commonTheme.palette.augmentColor({
      color: { main: '#ecb8ff' },
      name: 'lunarcharged',
    }),
    shattered: commonTheme.palette.augmentColor({
      color: { main: '#98fffd' },
      name: 'shattered',
    }),
    swirl: commonTheme.palette.augmentColor({
      color: { main: '#66ffcb' },
      name: 'swirl',
    }),
    burning: commonTheme.palette.augmentColor({
      color: { main: '#bf2818' },
      name: 'burning',
    }),
    crystallize: commonTheme.palette.augmentColor({
      color: { main: '#f8ba4e' },
      name: 'crystallize',
    }),
    heal: commonTheme.palette.augmentColor({
      color: { main: '#c0e86c' },
      name: 'heal',
    }),
    bloom: commonTheme.palette.augmentColor({
      color: { main: '#47c83b', contrastText: '#222' },
      name: 'bloom',
    }),
    burgeon: commonTheme.palette.augmentColor({
      color: { main: '#c8b33b', contrastText: '#fff' },
      name: 'burgeon',
    }),
    hyperbloom: commonTheme.palette.augmentColor({
      color: { main: '#3b8dc8', contrastText: '#fff' },
      name: 'hyperbloom',
    }),
    lunarbloom: commonTheme.palette.augmentColor({
      color: { main: '#c8efc4', contrastText: '#222' },
      name: 'lunarbloom',
    }),
    lunarcrystallize: commonTheme.palette.augmentColor({
      color: { main: '#fff2baff', contrastText: '#222' },
      name: 'lunarcrystallize',
    }),
    stellarconduct: commonTheme.palette.augmentColor({
      color: { main: '#cdb0ff', contrastText: '#222' },
      name: 'stellarconduct',
    }),
    stellarcryo: commonTheme.palette.augmentColor({
      color: { main: '#abf7ff', contrastText: '#222' },
      name: 'stellarconduct_cryo',
    }),
    stellarswirl: commonTheme.palette.augmentColor({
      color: { main: '#a1facc', contrastText: '#222' },
      name: 'stellarswirl',
    }),
  },
})

const { hairline, hairlineStrong } = giTokens
const focusRing = { outline: `2px solid ${gold}`, outlineOffset: 2 }

/**
 * Contained buttons are tonal: a soft tint of their colour with the colour as text, instead of a
 * solid block. A screen full of solid buttons (the old look) gives every control the same
 * weight; tonal ones stay readable and leave `giCtaSx` as the one thing that stands out.
 */
function tonalContained(theme: Theme, colorKey: string) {
  const neutral = colorKey === 'secondary' || colorKey === 'inherit'
  const color = theme.palette[colorKey as keyof Theme['palette']] as
    | PaletteColor
    | undefined
  if (!neutral && !color?.main) return {}
  const base = neutral ? parchment : color!.main
  const [bg, bgHover, ring, ringHover] = neutral
    ? [0.07, 0.12, 0.12, 0.2]
    : [0.16, 0.26, 0.34, 0.52]
  return {
    backgroundColor: alpha(base, bg),
    color: neutral ? parchment : (color!.light ?? color!.main),
    boxShadow: `inset 0 0 0 1px ${alpha(base, ring)}`,
    '&:hover': {
      backgroundColor: alpha(base, bgHover),
      boxShadow: `inset 0 0 0 1px ${alpha(base, ringHover)}`,
      '@media (hover: none)': { backgroundColor: alpha(base, bg) },
    },
  }
}

// The variants were already computed (with MUI's Roboto stack) by the themes above, and merging
// only `typography.fontFamily` would not reach them, so every variant gets the family explicitly.
const typographyVariants = {
  h1: { fontWeight: 650, letterSpacing: '-0.02em' },
  h2: { fontWeight: 650, letterSpacing: '-0.02em' },
  h3: { fontWeight: 650, letterSpacing: '-0.02em' },
  h4: { fontWeight: 650, letterSpacing: '-0.015em' },
  h5: { fontWeight: 600, letterSpacing: '-0.01em' },
  h6: { fontWeight: 600, letterSpacing: '-0.005em' },
  subtitle1: { lineHeight: 1.6 },
  subtitle2: { fontWeight: 600 },
  body1: {},
  body2: {},
  caption: {},
  overline: { letterSpacing: '0.04em' },
  button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
} as const

const components: ThemeOptions['components'] = {
  MuiCssBaseline: {
    styleOverrides: {
      body: {
        backgroundColor: ink,
        // the app is mostly columns of numbers: keep digits the same width so they line up
        fontVariantNumeric: 'tabular-nums',
        fontFamily: giTokens.fontFamily,
      },
      '::selection': { backgroundColor: alpha(gold, 0.32) },
      '*': {
        scrollbarWidth: 'thin',
        scrollbarColor: `${alpha(parchment, 0.18)} transparent`,
      },
      // `:is()` (not `:where()`) so the ring outranks ButtonBase's `outline: 0`
      ':is(a, button, [role="button"], [role="tab"], [tabindex="0"]):focus-visible':
        focusRing,
      '@media (prefers-reduced-motion: reduce)': {
        '*, *::before, *::after': {
          animationDuration: '0.01ms !important',
          animationIterationCount: '1 !important',
          transitionDuration: '0.01ms !important',
          scrollBehavior: 'auto !important',
        },
      },
    },
  },
  MuiPaper: {
    styleOverrides: {
      // flat surfaces: no dark-mode "elevation" white overlay
      root: { backgroundImage: 'none' },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 6, // juanlab: angoli contenuti, come Genshin Optimizer
        // hairline drawn inside the box: no layout shift, and not covered by full-bleed children
        outline: `1px solid ${hairline}`,
        outlineOffset: -1,
      },
    },
  },
  MuiCardHeader: {
    styleOverrides: {
      title: { fontWeight: 600 },
    },
  },
  MuiButton: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      root: ({ ownerState, theme }) => ({
        borderRadius: 4,
        transition:
          'background-color 150ms ease, box-shadow 150ms ease, border-color 150ms ease, color 150ms ease',
        ...(ownerState.variant === 'contained' &&
          tonalContained(theme as Theme, ownerState.color ?? 'primary')),
      }),
      outlined: { borderColor: hairlineStrong },
    },
  },
  MuiButtonGroup: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      grouped: { borderColor: `${hairline} !important` },
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: { textTransform: 'none', borderColor: hairline },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: ({ ownerState }) => ({
        fontWeight: 500,
        borderRadius: 4, // juanlab: chip squadrati, niente pillole
        ...(ownerState.variant !== 'outlined' &&
          (!ownerState.color || ownerState.color === 'default') && {
            backgroundColor: alpha(parchment, 0.1),
          }),
      }),
    },
  },
  MuiTabs: {
    styleOverrides: {
      indicator: { backgroundColor: gold },
    },
  },
  MuiTab: {
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontWeight: 600,
        '&.Mui-selected': { color: parchment },
      },
    },
  },
  MuiTooltip: {
    styleOverrides: {
      tooltip: {
        backgroundColor: giTokens.inkDeep,
        color: parchment,
        border: `1px solid ${hairlineStrong}`,
        borderRadius: 4,
        fontSize: '0.8125rem',
        fontWeight: 400,
        lineHeight: 1.5,
        padding: '8px 12px',
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.5)',
      },
      arrow: {
        color: giTokens.inkDeep,
        '&::before': { border: `1px solid ${hairlineStrong}` },
      },
    },
  },
  MuiBackdrop: {
    styleOverrides: {
      root: { backgroundColor: 'rgba(4, 6, 12, 0.72)' },
      invisible: { backgroundColor: 'transparent' },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        borderRadius: 6,
        outline: `1px solid ${hairlineStrong}`,
        outlineOffset: -1,
      },
    },
  },
  MuiPopover: {
    styleOverrides: {
      paper: {
        borderRadius: 4,
        backgroundColor: giTokens.panelRaised,
        outline: `1px solid ${hairlineStrong}`,
        outlineOffset: -1,
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
      },
    },
  },
  MuiAutocomplete: {
    styleOverrides: {
      paper: {
        backgroundColor: giTokens.panelRaised,
        outline: `1px solid ${hairlineStrong}`,
        outlineOffset: -1,
      },
    },
  },
  MuiMenuItem: {
    styleOverrides: {
      root: {
        borderRadius: 4,
        marginInline: 4,
        '&.Mui-selected': { backgroundColor: alpha(gold, 0.14) },
        '&.Mui-selected:hover': { backgroundColor: alpha(gold, 0.2) },
      },
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: 4,
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: alpha(parchment, 0.3),
        },
      },
      notchedOutline: { borderColor: hairlineStrong },
    },
  },
  MuiDivider: {
    styleOverrides: {
      root: { borderColor: hairline },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: { borderRadius: 4 },
    },
  },
  MuiAccordion: {
    styleOverrides: {
      root: {
        backgroundColor: giTokens.panel,
        '&::before': { display: 'none' },
      },
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: { borderRadius: 999, backgroundColor: alpha(parchment, 0.08) },
    },
  },
  MuiSkeleton: {
    styleOverrides: {
      root: { backgroundColor: alpha(parchment, 0.06) },
    },
  },
}

export const theme = createTheme(elementTheme, {
  shape: { borderRadius: 4 }, // juanlab: come Genshin Optimizer (era 8)
  typography: {
    fontFamily: giTokens.fontFamily,
    ...Object.fromEntries(
      Object.entries(typographyVariants).map(([variant, style]) => [
        variant,
        { ...style, fontFamily: giTokens.fontFamily },
      ])
    ),
  },
  components,
})
