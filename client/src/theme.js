import { createTheme } from '@mui/material/styles';

/**
 * GuestFlow theme — « Maison » direction (specs/design-system.md §3.1-§3.2).
 *
 * Single source of design tokens: hospitality identity — fir-green primary, honey accent, warm paper
 * background, humanist-serif titles, radius 14, warm shadows. Semantic colors carry a `soft` background
 * used by status chips (soft bg + dark text — never filled semantic Chips).
 *
 * Typography roles (custom variants — use these, not raw h4/h6, for the roles they name):
 *   pageTitle     serif 600 — the one page title (rendered by PageActionBar / PageHeader)
 *   sectionHeader serif 600 — section headings inside a page
 *   kpiValue      sans 700, tabular-nums — KPI figures (amounts/dates NEVER render in serif)
 *   kpiLabel      sans 600, muted — KPI captions
 */

const SERIF = "'Source Serif 4', 'Iowan Old Style', Charter, Georgia, serif";
const SANS = "'Inter', sans-serif";

const theme = createTheme({
  palette: {
    primary: { main: '#2F5D46' },
    secondary: { main: '#C99038' },
    background: { default: '#F8F5EF', paper: '#ffffff' },
    text: { primary: '#27251F', secondary: '#6E6A5E' },
    success: { main: '#3E7D54', soft: '#E6EFE7' },
    warning: { main: '#8F6A1D', soft: '#F6EDD7' },
    error: { main: '#A8433A', soft: '#F7E8E5' },
    info: { main: '#31556E', soft: '#E4EDF3' },
    divider: 'rgba(60, 54, 36, 0.1)',
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
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 500 },
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
