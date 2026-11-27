// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md K10 (CLAUDE.md §5.6) — GuestFlow and the connector update in either order. The offer keeps sending the back of 4.7.0 under `layout` and
// `texts`, key for key, so a connector before 1.27.0 still draws a back; the redrawn back travels under `design`. A connector 1.27.0 facing a GuestFlow older than itself (no `design`) draws from
// the stylesheet's own defaults and its own words, never a literal « {lines} ».
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { screen } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

const requireHere = createRequire(import.meta.url);
const { LEGACY_BACK_LAYOUT, LEGACY_BACK_TEXTS } = requireHere('../../../server/src/plugins/gift-vouchers/legacyBack');

const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js', 'assets/voucher-card.js'];
const VIEW = 'blocks/gift-voucher/view.js';
const css = fs.readFileSync(path.resolve(__dirname, '../../../integrations/wordpress/guestflow-booking/assets/style.css'), 'utf8');

// Every custom property the stylesheet of connector 1.26.1 (origin/master) reads for the back, frozen.
const OLD_STYLESHEET_VARIABLES = [
  '--l-item-text', '--l-link', '--l-logo-name', '--l-message', '--l-parties', '--l-scan', '--m-after-items', '--m-after-message', '--m-after-qr', '--m-footer-line', '--m-legal-strip', '--m-logo',
  '--m-qr', '--m-qr-gap', '--m-safe', '--m-trim', '--p-code', '--p-code-gap', '--p-code-label', '--p-code-label-gap', '--p-code-spacing', '--p-footer', '--p-heading', '--p-heading-gap',
  '--p-includes', '--p-includes-gap', '--p-item', '--p-item-gap', '--p-legal', '--p-link', '--p-logo-gap', '--p-logo-name', '--p-message', '--p-message-gap', '--p-parties', '--p-parties-gap',
  '--p-rule-gap', '--p-rule-half', '--p-rule-stroke', '--p-scan', '--p-scan-gap', '--p-title', '--p-title-gap', '--p-title-spacing', '--p-valid',
];
// The words connector 1.26.1 reads from `texts`.
const OLD_TEXT_KEYS = ['title', 'howTo', 'scan', 'includes', 'bullet', 'recipient', 'sender', 'codeLabel', 'codePlaceholder', 'validUntil', 'legal'];

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
// What connector 1.26.1's `drawBack` turned a layout into (its own mapping, frozen).
function oldVariablesOf(layout) {
  const set = new Set(['--m-trim', '--lh-sans', '--lh-serif']);
  Object.keys(layout).forEach((key) => { if (/Mm$/.test(key) && typeof layout[key] === 'number') set.add(`--m-${kebab(key.replace(/Mm$/, ''))}`); });
  Object.keys(layout.pt || {}).forEach((key) => set.add(`--p-${kebab(key)}`));
  Object.keys(layout.lines || {}).filter((key) => key !== 'items').forEach((key) => set.add(`--l-${kebab(key)}`));
  return set;
}

test('K10 — the legacy layout sets every variable connector 1.26.1’s stylesheet reads, and the legacy texts carry every key it reads', () => {
  const set = oldVariablesOf(LEGACY_BACK_LAYOUT);
  expect(OLD_STYLESHEET_VARIABLES.filter((name) => !set.has(name))).toEqual([]);
  expect(OLD_TEXT_KEYS.filter((key) => !(key in LEGACY_BACK_TEXTS))).toEqual([]);
  expect(LEGACY_BACK_TEXTS.includes).toBe('Votre bon comprend :');
  expect(LEGACY_BACK_TEXTS.scan).toBe('Scannez pour réserver votre cadeau ou suivez ce lien :');
});

test('K10 — every variable of the 1.27.0 stylesheet has a fallback, so a back is drawn from the stylesheet alone when GuestFlow is older', () => {
  const bare = [...css.matchAll(/var\((--(?:m|p|l|lh)-[a-z0-9-]+)\)/g)].map((m) => m[1]);
  expect(bare).toEqual([]);
});

const BATH = {
  slug: 'bain-jour',
  kind: 'resource',
  title: 'Un bain nordique',
  validityMonths: 12,
  band: { key: 'day', label: 'journée', from: '10:00', to: '19:00' },
  contents: [{ kind: 'session', label: 'Bain nordique', detail: '1 h en journée', qty: 1 }],
  addOns: [],
  extraTime: null,
  totalCents: 5000,
  termsVersionId: 9,
  visual: { versionId: 5, width: 720, height: 1015 },
  back: { lines: ['Bain nordique : 1 h en journée · semaine'], validUntil: '15 novembre 2027', titles: { week: 'Un bain nordique · semaine' } },
  periods: [{ period: 'week', priceCents: 5000, label: 'semaine' }],
};
const OLD_GUESTFLOW_BACK = {
  layout: LEGACY_BACK_LAYOUT,
  texts: LEGACY_BACK_TEXTS,
  logoUrl: null,
  companyName: 'Domaine Solio',
  identity: 'Domaine Solio · Saint-Cirq-Lapopie',
  website: 'site.example',
  link: 'site.example/bon-cadeau/utiliser',
  previewQrSvg: '<svg viewBox="0 0 3 3"><path d="M0 0h1v1H0z"/></svg>',
};

test('K10 — connector 1.27.0 facing a GuestFlow that sends no `design` still draws a back: its words, its steps, its validity, no literal « {lines} »', async () => {
  window.location.hash = '#campagne=bain-jour';
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const routes = (method, p) => {
    if (p === '/gift-vouchers/offer') {
      return {
        status: 200,
        body: {
          data: {
            available: true, brand: 'Domaine Solio', termsVersionId: 4, minAmountCents: 2000, maxAmountCents: 200000, validityMonths: 18, ideas: [], campaigns: [BATH], back: OLD_GUESTFLOW_BACK,
          },
        },
      };
    }
    if (p === '/gift-vouchers/offer/price') return { status: 200, body: { data: { lines: [], totalCents: 5000, extrasCents: 0, vat: [] } } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  loadBlock(VIEW, { routes, assets: ASSETS });
  await screen.findByText('Le bon comprend');
  const verso = document.querySelector('.gf-card-flip .gf-verso');
  const text = verso.textContent;
  expect(text).not.toMatch(/\{[a-z]+\}/);
  expect(text).toMatch(/Votre bon comprend — Bain nordique : 1 h en journée · semaine/);
  expect(text).toMatch(/Valable jusqu’au 15 novembre 2027/);
  expect(verso.querySelectorAll('.gf-v-step').length).toBe(3);
  expect([...verso.style].filter((n) => n.startsWith('--m-') || n.startsWith('--p-'))).toEqual([]);
});
