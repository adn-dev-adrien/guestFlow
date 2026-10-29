import { createTheme } from '@mui/material/styles';
// A finger, not a mouse: phones and tablets, whatever their width.
import { COARSE_POINTER, TOUCH_TARGET, touchHitArea } from './utils/touchHitArea';

/**
 * GuestFlow theme — « Maison » direction (specs/design-system.md §3.1-§3.2).
 *
 * Single source of design tokens: hospitality identity — fir-green primary, honey accent, warm paper
 * background, humanist-serif titles, radius 14, warm shadows. Semantic colors carry a `soft` background
 * used by status chips (soft bg + its `text` colour — never filled semantic Chips).
 *
 * Typography roles (custom variants — use these, not raw h4/h6, for the roles they name):
 *   pageTitle     serif 600 — the one page title (rendered by PageActionBar)
 *   sectionHeader serif 600 — section headings inside a page
 *   kpiValue      sans 700, tabular-nums — KPI figures (amounts/dates NEVER render in serif)
 *   kpiLabel      sans 600, muted — KPI captions
 */

const SERIF = "'Source Serif 4', 'Iowan Old Style', Charter, Georgia, serif";
const SANS = "'Inter', sans-serif";
// Shared by the palette and by the component overrides below (which run before the theme exists).
const FIR = '#2F5D46';
const INK_MUTED = '#6E6A5E';
// Chart palette (specs/finance-dashboard-redesign.md rule 45): every chart colour of the app, kept
// apart from the semantic palette. Contrast on white, WCAG 1.4.11 (3:1 for a mark), 1.4.3 (4.5:1 for
// a tick): checked by components/__tests__/chartPalette.contrast.test.js.
const CHART = {
  current: FIR,              // this year, encaissé ou passé — 7.6:1
  upcoming: '#B07F2E',       // miel profond, à venir — 3.6:1
  lastYear: '#D9CFBA',       // sable, last year's bar (fill only, always with its edge)
  lastYearEdge: '#8E8470',   // its 1 px outline and the dashed « au final » ghost — 3.7:1
  ghostFill: 'rgba(217, 207, 186, 0.22)',
  today: '#B07F2E',          // the « aujourd'hui » marker of a curve
  grid: '#EFEBE3',           // decoration, never information
  tick: INK_MUTED,           // axis labels — 5.4:1
  value: '#27251F',          // a value written on a mark — 15:1
  band: '#F3EFE6',           // the window's months behind « Revenu par mois »
  selected: '#F6EDD7',       // the open month behind the pace chart
  cursor: 'rgba(60, 54, 36, 0.05)',
  channels: '#6B8F76',       // the « Canaux » tile's dot (decoration beside its label)
  tooltip: '#27251F',
  // One per logement, in the server's slot order; each ≥ 3:1 and told apart under the three
  // colour-vision deficiencies (dataviz validator, adjacent pairs).
  series: [FIR, '#B07F2E', '#2F6690', '#A8433A', '#6A4F86', '#71792B'],
  // The ink banner (rule 31).
  onInk: { surface: '#27251F', accent: '#E3B566', muted: 'rgba(255, 255, 255, 0.8)', hairline: 'rgba(255, 255, 255, 0.12)', previous: 'rgba(255, 255, 255, 0.7)' },
};
// Every icon button except those sitting in a text field's adornment.
const IN_FIELD_EXCLUDED = '&:not(:is(.MuiInputAdornment-root, .MuiAutocomplete-endAdornment) *)';

const theme = createTheme({
  palette: {
    primary: { main: FIR },
    secondary: { main: '#C99038' },
    background: { default: '#F8F5EF', paper: '#ffffff' },
    text: { primary: '#27251F', secondary: INK_MUTED },
    // `text` — the colour of text written on `soft`, every one ≥ 4.5:1 there
    // (specs/shell-and-home-day-first.md rule 14): `main` itself is 4.2:1 on soft for success/warning.
    success: { main: '#3E7D54', soft: '#E6EFE7', text: '#2F6A43' },
    warning: { main: '#8F6A1D', soft: '#F6EDD7', text: '#6F5112' },
    error: { main: '#A8433A', soft: '#F7E8E5', text: '#A8433A' },
    info: { main: '#31556E', soft: '#E4EDF3', text: '#31556E' },
    // The « stable » shade of a comparison badge: no good, no bad news.
    neutral: { main: INK_MUTED, soft: '#EEEBE4', text: INK_MUTED },
    divider: 'rgba(60, 54, 36, 0.1)',
    chart: CHART,
  },
  typography: {
    fontFamily: SANS,
    h4: { fontWeight: 600, fontSize: '1.6rem' },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    pageTitle: { fontFamily: SERIF, fontWeight: 600, fontSize: '1.35rem', lineHeight: 1.25 },
    sectionHeader: { fontFamily: SERIF, fontWeight: 600, fontSize: '1.05rem', lineHeight: 1.3 },
    kpiValue: { fontFamily: SANS, fontWeight: 700, fontSize: '1.6rem', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' },
    kpiLabel: { fontFamily: SANS, fontWeight: 600, fontSize: '0.72rem', lineHeight: 1.4 },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiTypography: {
      defaultProps: {
        // Custom role variants need an element mapping; kpiLabel is a caption-like block.
        variantMapping: { pageTitle: 'h1', sectionHeader: 'h2', kpiValue: 'p', kpiLabel: 'p' },
      },
    },
    // Tabs — house style for every strip, whatever draws it (specs/ds-tabs.md rules 5, 6, 9).
    // Structure and behaviour live in the PageTabs component.
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44 },
        indicator: { height: 2, borderRadius: '2px 2px 0 0' },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontFamily: SANS,
          fontSize: '0.9rem',
          fontWeight: 500,
          minHeight: 44,
          padding: '0 14px',
          color: INK_MUTED,
          '&.Mui-selected': { color: FIR, fontWeight: 600 },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 500, [COARSE_POINTER]: { minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET } },
      },
    },
    // Touch targets (specs/ds-components.md rule 21): on a finger-driven screen every icon button,
    // checkbox, radio and toggle button is at least 44 × 44, whatever `size` the page asked for. The
    // icon buttons inside a text field are left as the field sets them (the field itself is the
    // target, and a stepper like QuantityField already sizes its own).
    MuiIconButton: {
      styleOverrides: {
        root: {
          [COARSE_POINTER]: {
            [IN_FIELD_EXCLUDED]: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET },
          },
        },
      },
    },
    // An inline link (a client's name, « Fiche », « Plan comptable ») keeps its size in the text and gets a
    // 44 px hit area on touch (specs/plugins-phase-p-productisation.md rule 39, ds-components.md rule 21).
    MuiLink: {
      styleOverrides: {
        root: touchHitArea,
      },
    },
    // A clickable chip (a slot, a « compl. » toggle) keeps its compact size, with a 44 px hit area on touch.
    MuiChip: {
      styleOverrides: {
        clickable: touchHitArea,
      },
    },
    // The sidebar rows are 36-40 px tall on a desktop-sized tablet: 44 px on touch (specs/ds-components.md rule 21).
    MuiListItemButton: {
      styleOverrides: {
        root: { [COARSE_POINTER]: { minHeight: TOUCH_TARGET } },
      },
    },
    // A switch is 24 or 38 px tall: on touch its (invisible) input, which takes the tap, is 44 px tall around
    // the thumb, so the track keeps its look.
    MuiSwitch: {
      styleOverrides: {
        root: { [COARSE_POINTER]: { overflow: 'visible' } },
        input: {
          [COARSE_POINTER]: { top: '50%', height: TOUCH_TARGET, transform: 'translateY(-50%)' },
        },
      },
    },
    // Sentence case like every button (specs/plugins-phase-p-productisation.md rule 39), 44 px on touch.
    MuiToggleButton: {
      styleOverrides: {
        root: { textTransform: 'none', [COARSE_POINTER]: { minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET } },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: { [COARSE_POINTER]: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET } },
      },
    },
    MuiRadio: {
      styleOverrides: {
        root: { [COARSE_POINTER]: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET } },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: { width: '100%', overflowX: 'auto' },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          width: 'calc(100% - 16px)',
          margin: 8,
          // fullScreen dialogs (xs) must actually cover the viewport — don't let the mobile
          // margin above shrink them (specs/ds-components.md §3.3).
          '&.MuiDialog-paperFullScreen': {
            width: '100%',
            margin: 0,
          },
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          paddingLeft: 16,
          paddingRight: 16,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { boxShadow: '0 3px 16px rgba(60, 54, 36, 0.09)' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { boxShadow: '0 3px 16px rgba(60, 54, 36, 0.09)' },
      },
    },
  },
});

theme.typography.h4 = {
  ...theme.typography.h4,
  [theme.breakpoints.down('sm')]: {
    fontSize: '1.35rem',
  },
};

theme.typography.pageTitle = {
  ...theme.typography.pageTitle,
  [theme.breakpoints.down('sm')]: {
    fontSize: '1.2rem',
  },
};

export default theme;
