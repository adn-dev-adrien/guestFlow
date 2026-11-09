/**
 * The Domaine Solio tokens of the guest app — the single source (specs/guest-app.md §6.1, §6.3).
 *
 * `TOKENS.day` / `TOKENS.night` are written once here and reach the screens two ways: as CSS custom
 * properties on the `.app` root (`cssVars(mode)`, what `styles/app.css` reads) and as the MUI theme
 * (`muiTheme(mode)`, what the few MUI primitives — the modal layer of the sheets — read). Nothing else in
 * the app spells a colour.
 *
 * Recorded accessibility adjustment (§6.1): the filled button uses `action` `#9A6318` (5.0:1 with white),
 * not the site's `#B87B2A` (3.6:1); the bright ocre stays for non-text accents.
 */
import { createTheme } from '@mui/material/styles';

export const FONTS = Object.freeze({
  display: "'Marcellus', Georgia, serif",
  body: "'Karla', Helvetica, Arial, sans-serif",
});

export const TOKENS = Object.freeze({
  day: Object.freeze({
    paper: '#F5F0E6',
    card: '#FDFAF3',
    ink: '#22271F',
    inkSoft: '#5C6153',
    sapin: '#2E3B2A',
    lichen: '#5A6B48',
    ocre: '#B87B2A',
    ocreInk: '#8A5816',
    action: '#9A6318',
    onAction: '#FFFFFF',
    line: '#DCD4C2',
    chip: '#EDE5D4',
    ctl: '#857D6B',
    ok: '#2F6A43',
    okSoft: '#E6EFE7',
    warn: '#6F5112',
    warnSoft: '#F6EDD7',
    bad: '#A8433A',
    badSoft: '#F7E8E5',
    bar: 'rgba(253,250,243,.96)',
    count: 'rgba(255,255,255,.2)',
    sel: 'rgba(184,123,42,.3)',
    ring: 'rgba(184,123,42,.3)',
    float: '0 12px 32px rgba(22,28,22,.22)',
  }),
  night: Object.freeze({
    paper: '#161C16',
    card: '#1F261E',
    ink: '#EFE8D6',
    inkSoft: '#A9AE9C',
    sapin: '#EFE8D6',
    lichen: '#9DB087',
    ocre: '#E8C286',
    ocreInk: '#E8C286',
    action: '#E8C286',
    onAction: '#161C16',
    line: '#2E362C',
    chip: '#273026',
    ctl: '#727C6C',
    ok: '#8FCB9F',
    okSoft: '#1E3324',
    warn: '#E8C286',
    warnSoft: '#3A2F17',
    bad: '#F0A39B',
    badSoft: '#3A1F1C',
    bar: 'rgba(31,38,30,.96)',
    count: 'rgba(22,28,22,.16)',
    sel: 'rgba(232,194,134,.3)',
    ring: 'rgba(232,194,134,.35)',
    float: '0 12px 32px rgba(0,0,0,.55)',
  }),
});

/** The site's hero gradient, over every photo carrying text (§6.1 `scrim`). */
export const SCRIM = 'linear-gradient(to top,rgba(10,14,10,.78) 0%,rgba(10,14,10,.26) 48%,rgba(10,14,10,.12) 100%)';

/** The PWA's theme colour (rule 52: fir green). */
export const THEME_COLOR = '#2E3B2A';

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `{ '--paper': '#F5F0E6', … }` — the custom properties `styles/app.css` reads, for one register. */
export function cssVars(mode = 'day') {
  const tokens = TOKENS[mode] || TOKENS.day;
  return Object.fromEntries([
    ...Object.entries(tokens).map(([key, value]) => [`--${kebab(key)}`, value]),
    ['--scrim', SCRIM],
    ['--display', FONTS.display],
    ['--body', FONTS.body],
  ]);
}

/** The MUI theme of one register: same tokens, square-cut shapes (§6.3). */
export function muiTheme(mode = 'day') {
  const t = TOKENS[mode] || TOKENS.day;
  return createTheme({
    palette: {
      mode: mode === 'night' ? 'dark' : 'light',
      primary: { main: t.action, contrastText: t.onAction },
      secondary: { main: t.sapin },
      success: { main: t.ok },
      warning: { main: t.warn },
      error: { main: t.bad },
      background: { default: t.paper, paper: t.card },
      text: { primary: t.ink, secondary: t.inkSoft },
      divider: t.line,
    },
    shape: { borderRadius: 4 },
    typography: { fontFamily: FONTS.body },
    transitions: { easing: { easeOut: 'cubic-bezier(.22,1,.36,1)', sharp: 'cubic-bezier(.32,.72,0,1)' } },
  });
}
