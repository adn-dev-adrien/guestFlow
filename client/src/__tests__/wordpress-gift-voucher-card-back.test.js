// specs/gift-vouchers/gift-voucher-campaigns.md rule 66 — the purchase block draws the card the buyer will receive, front and back, and nothing of the back is written by the page:
// GuestFlow sends the dimensions, the words, the lines, the validity and the QR code, the page adds what the buyer typed. The grey ticket under « Payer » is gone. The card
// turns by itself on a wide block when the buyer types, not on a narrow one (a link turns it there); « Agrandir » opens a dialog that Escape closes; the page after payment
// shows the same card, back first, with the real code and no « Aperçu » pill.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js', 'assets/voucher-card.js'];
const VIEW = 'blocks/gift-voucher/view.js';
const SVG = '<svg viewBox="0 0 3 3"><path d="M0 0h1v1H0z"/></svg>';

const LAYOUT = {
  trimMm: { width: 105, height: 148 },
  safeMm: 5,
  legalStripMm: 5,
  qrMm: 23,
  qrFramePadMm: 2.5,
  logoMm: 12,
  footerLineMm: 4,
  discMm: 4.6,
  stepGapMm: 2,
  codeBoxMm: 16,
  afterQrMm: 3,
  afterStepsMm: 3,
  afterCodeMm: 2,
  lineHeight: { sans: 1.326, serif: 1.371 },
  pt: { title: 17, step: 8.5, code: 15, legal: 7 },
  lines: {
    logoName: 2, title: 2, subtitle: 2, step: 1, link: 1, includes: 3, message: 2,
  },
};
const TEXTS = {
  title: 'BON CADEAU',
  lodgingTitle: 'Un séjour offert',
  subtitle: 'offert par {sender} à {recipient}',
  subtitleSender: 'offert par {sender}',
  subtitleRecipient: 'offert à {recipient}',
  scan: 'Scannez le QR code',
  steps: ['Scannez le QR code avec votre téléphone', 'Choisissez votre créneau en ligne', 'Savourez votre parenthèse en Ardèche'],
  codeLabel: 'Code du bon',
  includes: 'Votre bon comprend : {lines}',
  bullet: '•',
  recipient: 'Pour {name}',
  sender: 'de la part de {name}',
  codePlaceholder: 'XXXX-XXXX-XXXX-XXXX',
  validUntil: 'Valable jusqu’au {date}',
  legal: 'Ne pas jeter sur la voie publique.',
};
const BACK = {
  layout: LAYOUT,
  texts: TEXTS,
  logoUrl: '/public/v1/gift-vouchers/logo?v=abc123def4567890',
  companyName: 'Domaine Solio',
  identity: 'Domaine Solio · Saint-Cirq-Lapopie · Lot',
  website: 'site.example',
  link: 'site.example/bon-cadeau/utiliser',
  previewQrSvg: SVG,
};
const VISUAL = { versionId: 5, width: 720, height: 1015 };
const LODGING = {
  slug: 'sejour',
  kind: 'lodging',
  title: 'Bon cadeau',
  validityMonths: 18,
  minAmountCents: 2000,
  maxAmountCents: 200000,
  ideas: [],
  termsVersionId: 4,
  visual: VISUAL,
  back: { lineTemplate: 'Un séjour dans nos logements, d’une valeur de {amount}', validUntil: '15/05/2028', title: 'Un séjour offert' },
};
const BATH = {
  slug: 'bain-jour',
  kind: 'resource',
  title: 'Un bain nordique',
  validityMonths: 12,
  band: { key: 'day', label: 'journée', from: '10:00', to: '19:00' },
  contents: [{ kind: 'session', label: 'Bain nordique', detail: '2 h en journée', qty: 1 }],
  addOns: [{
    articleRef: 'option:7', label: 'Boisson', maxQty: 20, unitLabel: 'l’unité', linear: true, prices: Array.from({ length: 20 }, (_, i) => ({ qty: i + 1, cents: (i + 1) * 777 })),
  }],
  extraTime: { maxMinutes: 120, stepMinutes: 60, prices: [{ minutes: 60, cents: 4321 }, { minutes: 120, cents: 8642 }] },
  totalCents: 10900,
  termsVersionId: 9,
  visual: VISUAL,
  back: {
    lines: ['Bain nordique : 2 h en journée', 'Planche apéro'],
    extraTime: { 60: 'Temps supplémentaire : 1 h', 120: 'Temps supplémentaire : 2 h' },
    addOns: { 'option:7': { 1: 'Boisson', 2: '2 × Boisson' } },
    validUntil: '15/11/2027',
    titles: { week: 'Un bain nordique · semaine', weekend: 'Un bain nordique · week-end' },
  },
  periods: [{ period: 'week', priceCents: 10900, label: 'semaine' }],
};
const offerWith = (campaigns, back = BACK) => ({
  available: true, brand: 'Domaine Solio', termsVersionId: 4, minAmountCents: 2000, maxAmountCents: 200000, validityMonths: 18, ideas: [], campaigns, ...(back ? { back } : {}),
});
const priced = () => ({ lines: [], totalCents: 10900, extrasCents: 0, vat: [] });

function setup({ campaigns = [BATH], back = BACK, hash = '#campagne=bain-jour', width = 1000, padding = 0 } = {}) {
  window.location.hash = hash;
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const host = document.querySelector('[data-gf-gift-voucher]');
  Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
  host.style.padding = `0 ${padding}px`;
  const routes = (method, p) => {
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: offerWith(campaigns, back) } };
    if (p === '/gift-vouchers/offer/price') return { status: 200, body: { data: priced() } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  const loaded = loadBlock(VIEW, { routes, assets: ASSETS });
  return { host, ...loaded };
}

const card = () => document.querySelector('.gf-vcard');
const face = () => card().getAttribute('data-face');
const type = (label, value) => fireEvent.input(screen.getByLabelText(label), { target: { value } });
const texts = (selector) => [...document.querySelectorAll(selector)].map((n) => n.textContent);

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; window.location.hash = ''; });

test('rule 66: the grey ticket and its « Aperçu du bon » heading are gone; a card with an « Aperçu » pill heads the form', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  expect(document.querySelector('.gf-gv-ticket')).toBeNull();
  expect(document.querySelector('.gf-gv-preview')).toBeNull();
  expect(screen.queryByText('Aperçu du bon')).toBeNull();
  expect(card()).toBeTruthy();
  expect(document.querySelector('.gf-v-pill').textContent).toBe('Aperçu');
  expect(document.querySelector('.gf-gv-lead').classList.contains('has-card')).toBe(true);
});

test('rule 66: the back is drawn from the dimensions and words GuestFlow sends', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  const verso = document.querySelector('.gf-card-flip .gf-verso');
  expect(verso.style.getPropertyValue('--m-qr')).toBe('23');
  expect(verso.style.getPropertyValue('--m-legal-strip')).toBe('5');
  expect(verso.style.getPropertyValue('--p-title')).toBe('17');
  expect(verso.style.getPropertyValue('--l-includes')).toBe('3');
  expect(verso.querySelector('.gf-v-kicker').textContent).toBe('BON CADEAU');
  expect(verso.querySelector('.gf-v-title').textContent).toBe('Un bain nordique · semaine');
  expect([...verso.querySelectorAll('.gf-v-step-text')].map((n) => n.textContent)).toEqual(TEXTS.steps);
  expect(verso.querySelector('.gf-v-codebox .gf-v-code-label').textContent).toBe('Code du bon');
  expect(verso.querySelector('.gf-v-scan').textContent).toBe(TEXTS.scan);
  expect(verso.querySelector('.gf-v-link').textContent).toBe('site.example/bon-cadeau/utiliser');
  expect(verso.querySelector('.gf-v-identity').textContent).toBe('Domaine Solio · Saint-Cirq-Lapopie · Lot');
  expect(verso.querySelector('.gf-v-legal').textContent).toBe(TEXTS.legal);
  expect(verso.querySelector('.gf-v-logo img').getAttribute('src')).toBe('/wp-json/guestflow/v1/gift-vouchers/logo?v=abc123def4567890');
  expect(verso.querySelector('.gf-v-qr svg')).toBeTruthy();
});

test('rule 66: before payment the code is grey, and the validity is the server\'s', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  const code = document.querySelector('.gf-card-flip .gf-v-code');
  expect(code.textContent).toBe('XXXX-XXXX-XXXX-XXXX');
  expect(code.classList.contains('is-wait')).toBe(true);
  expect(document.querySelector('.gf-card-flip .gf-v-valid').textContent).toBe('Valable jusqu’au 15/11/2027');
});

test('rule 66: on a wide block the card turns to its back as the buyer types in Pour, De la part de and Un mot, and the back shows what was typed', async () => {
  setup({ width: 1000 });
  await screen.findByText('Le bon comprend');
  expect(face()).toBe('front');
  type(/^Prénom/, 'Marie');
  expect(face()).toBe('back');
  type(/^De la part de/, 'Paul');
  type(/^Un mot/, 'Joyeux anniversaire');
  expect(texts('.gf-card-flip .gf-v-subtitle')).toEqual(['offert par Paul à Marie']);
  expect(texts('.gf-card-flip .gf-v-message')).toEqual(['Joyeux anniversaire']);
  expect(texts('.gf-card-flip .gf-v-includes')).toEqual(['Votre bon comprend : Bain nordique : 2 h en journée · Planche apéro']);
});

test('rule 66: the recipient\'s last name turns the card too, and the back prints the first name only, as the PDF does', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  type(/^Nom/, 'Durand');
  expect(face()).toBe('back');
  expect(document.querySelector('.gf-card-flip .gf-v-subtitle').hidden).toBe(true);
  type(/^Prénom/, 'Marie');
  expect(texts('.gf-card-flip .gf-v-subtitle')).toEqual(['offert à Marie']);
  expect(document.querySelector('.gf-card-flip').textContent).not.toContain('Durand');
});

test('rule 66: each of the other fields turns the card by itself, and the control still turns it back', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  ['Un mot', 'De la part de', 'Nom'].forEach((label) => {
    fireEvent.click(screen.getByRole('button', { name: 'Recto' }));
    expect(face()).toBe('front');
    type(new RegExp(`^${label}`), 'x');
    expect(face()).toBe('back');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Recto' }));
  expect(face()).toBe('front');
  expect(screen.getByRole('button', { name: 'Recto' }).getAttribute('aria-pressed')).toBe('true');
});

test('rule 66: on a narrow block the card does not turn by itself; « Voir le verso du bon » turns it', async () => {
  setup({ width: 420 });
  await screen.findByText('Le bon comprend');
  type(/^Prénom/, 'Marie');
  type(/^Un mot/, 'Bravo');
  expect(face()).toBe('front');
  expect(texts('.gf-card-flip .gf-v-subtitle')).toEqual(['offert à Marie']);
  fireEvent.click(screen.getByRole('button', { name: 'Voir le verso du bon' }));
  expect(face()).toBe('back');
});

test('rule 66: choosing extra time or an option adds the line GuestFlow wrote for it, after the campaign\'s, and turns the card', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  fireEvent.click(screen.getByText('Ajouter au bon'));
  fireEvent.click(screen.getAllByRole('button', { name: /^Ajouter/ }).filter((b) => b.closest('.gf-step'))[0]);
  await waitFor(() => expect(texts('.gf-card-flip .gf-v-includes')[0]).toMatch(/Planche apéro · (Temps supplémentaire : 1 h|Boisson)$/));
  expect(face()).toBe('back');
  expect(texts('.gf-card-flip .gf-v-includes')[0]).toMatch(/^Votre bon comprend : Bain nordique : 2 h en journée · Planche apéro · /);
});

test('rule 66: the page composes no line of its own — no duration or count formatting in the card code', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.resolve(__dirname, '../../../integrations/wordpress/guestflow-booking');
  const view = fs.readFileSync(path.join(dir, 'blocks/gift-voucher/view.js'), 'utf8');
  const card = fs.readFileSync(path.join(dir, 'assets/voucher-card.js'), 'utf8');
  const cardLines = view.slice(view.indexOf('function cardLines'), view.indexOf('function sync()'));
  expect(cardLines).not.toMatch(/voucherDuration|gvHourShort|gvMinShort|× /);
  expect(card).not.toMatch(/voucherDuration|gvHourShort|gvMinShort/);
});

test('rule 66: a lodging voucher fills the server\'s template with the amount typed, and shows a placeholder before one', async () => {
  setup({ campaigns: [LODGING], hash: '#campagne=sejour' });
  await screen.findByLabelText(/Montant/);
  expect(texts('.gf-card-flip .gf-v-includes')).toEqual(['Votre bon comprend : Un séjour dans nos logements, d’une valeur de … €']);
  expect(texts('.gf-card-flip .gf-v-title')).toEqual(['Un séjour offert']);
  fireEvent.input(screen.getByLabelText(/Montant/), { target: { value: '150' } });
  expect(texts('.gf-card-flip .gf-v-includes')).toEqual(['Votre bon comprend : Un séjour dans nos logements, d’une valeur de 150,00 €']);
  expect(document.querySelector('.gf-card-flip .gf-v-valid').textContent).toBe('Valable jusqu’au 15/05/2028');
});

test('rule 66: a text too long is left to the back\'s own line limits, never cut by the page', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  const long = 'Un très long message '.repeat(10).trim();
  type(/^Un mot/, long);
  expect(texts('.gf-card-flip .gf-v-message')).toEqual([long]);
  expect(document.querySelector('.gf-card-flip').querySelector('.gf-verso').style.getPropertyValue('--l-message')).toBe('2');
});

test('rule 66: « Agrandir » opens the card in a dialog; a click turns it, Escape closes it and the focus returns to the button', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  const button = screen.getByRole('button', { name: 'Agrandir' });
  button.focus();
  fireEvent.click(button);
  const dialog = screen.getByRole('dialog');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement.textContent).toBe('Fermer');
  fireEvent.click(dialog.querySelector('.gf-card-flip'));
  expect(face()).toBe('back');
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(button);
});

test('rule 66: « Fermer » closes the dialog too, and the dialog follows what the buyer typed', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  type(/^Prénom/, 'Marie');
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir' }));
  expect(texts('.gf-card-zoom .gf-v-subtitle')).toEqual(['offert à Marie']);
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('rule 66: choosing another campaign draws a new card on its front', async () => {
  setup({ campaigns: [LODGING, BATH], hash: '' });
  await screen.findByText('Séjours');
  fireEvent.click(document.querySelector('.gf-gv-offer[data-slug="bain-jour"]'));
  await screen.findByText('Le bon comprend');
  type(/^Prénom/, 'Marie');
  expect(face()).toBe('back');
  fireEvent.click(document.querySelector('.gf-gv-switch-opt[data-slug="sejour"]'));
  await screen.findByLabelText(/Montant/);
  expect(face()).toBe('front');
});

test('rule 66: a QR code that is not a plain SVG is never written into the page', async () => {
  setup({ back: { ...BACK, previewQrSvg: '<svg><script>alert(1)</script></svg>' } });
  await screen.findByText('Le bon comprend');
  expect(document.querySelector('.gf-card-flip .gf-v-qr').innerHTML).toBe('');
  expect(document.querySelector('script')).toBeNull();
});

test('rule 66: an offer with no back (the company has no website) draws the front alone, with no control', async () => {
  setup({ back: null });
  await screen.findByText('Le bon comprend');
  expect(card()).toBeTruthy();
  expect(document.querySelector('.gf-verso')).toBeNull();
  expect(document.querySelector('.gf-card-bar')).toBeNull();
  expect(document.querySelector('.gf-gv-peek')).toBeNull();
  type(/^Prénom/, 'Marie');
  expect(face()).toBe('front');
});

test('rule 66: the card turns with a transition and cross-fades under reduced motion; the zoom and the print sheet are in the stylesheet', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const css = fs.readFileSync(path.resolve(__dirname, '../../../integrations/wordpress/guestflow-booking/assets/style.css'), 'utf8');
  expect(css).toMatch(/\.gf-card-inner \{[^}]*transition: transform \.6s cubic-bezier\(\.2, \.8, \.2, 1\)/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.gf-card-inner \{ transition: none; transform: none !important; \}/);
  expect(css).toMatch(/@container gf-gv \(min-width: 900px\) \{ \.gf-gv-lead\.has-card \{ grid-template-columns: 400px minmax\(0, 1fr\); \} \}/);
  expect(css).toMatch(/position: sticky; top: var\(--gf-sticky-top, 96px\)/);
  expect(css).toMatch(/body\.gf-gv-printing-sheet > :not\(\.gf-card-sheet\) \{ display: none !important; \}/);
  expect(css).toMatch(/\.gf-card-sheet \.gf-card-face\.is-sheet \{[^}]*width: 105mm; height: 148mm/);
});

test('rule 66: the wide / narrow switch measures the block\'s content box, like the stylesheet\'s container query', async () => {
  // 640 px wide with 20 px of padding each side is 600 px of content: wide. 639 px is 599: narrow.
  setup({ width: 640, padding: 20 });
  await screen.findByText('Le bon comprend');
  type(/^Prénom/, 'Marie');
  expect(face()).toBe('back');
  document.body.innerHTML = '';
  setup({ width: 639, padding: 20 });
  await screen.findByText('Le bon comprend');
  type(/^Prénom/, 'Marie');
  expect(face()).toBe('front');
});

test('rule 66: in the zoom, Tab and Shift+Tab cycle between the card (it turns) and « Fermer »', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir' }));
  const flip = screen.getByRole('dialog').querySelector('.gf-card-flip');
  const close = screen.getByRole('button', { name: 'Fermer' });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: 'Tab' });
  expect(document.activeElement).toBe(flip);
  fireEvent.keyDown(flip, { key: 'Enter' });
  expect(face()).toBe('back');
  fireEvent.keyDown(flip, { key: 'Tab' });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(flip);
  fireEvent.keyDown(flip, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(close);
});

test('rule 66: the page\'s amount format is GuestFlow\'s formatEuros, on several amounts', async () => {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const rules = createRequire(import.meta.url)(path.resolve(__dirname, '../../../server/src/plugins/gift-vouchers/voucherRules.js'));
  const { GF } = setup();
  await screen.findByText('Le bon comprend');
  [0, 5, 100, 2050, 15000, 100000, 123456, 200000, 12345678].forEach((cents) => {
    expect(GF.cardEuros(cents)).toBe(rules.formatEuros(cents));
  });
  expect(GF.cardEuros(100000)).toBe('1 000,00 €');
  expect(GF.cardEuros(2050)).toBe('20,50 €');
});

test('rule 66: nothing can drift — every custom property the card code derives from the layout is read by the stylesheet, and every one the stylesheet reads is produced', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  // voucherPdf.js needs pdfkit, which jsdom cannot load: the layout constant is read out of its source and evaluated alone.
  const source = fs.readFileSync(path.resolve(__dirname, '../../../server/src/plugins/gift-vouchers/voucherPdf.js'), 'utf8');
  const BACK_LAYOUT = new Function(`return ${source.slice(source.indexOf('const BACK_LAYOUT = ') + 20, source.indexOf('\n});', source.indexOf('const BACK_LAYOUT = ')) + 3)};`)(); // eslint-disable-line no-new-func
  const BACK_TEXTS = TEXTS;
  const css = fs.readFileSync(path.resolve(__dirname, '../../../integrations/wordpress/guestflow-booking/assets/style.css'), 'utf8');
  setup({ back: { ...BACK, layout: JSON.parse(JSON.stringify(BACK_LAYOUT)), texts: BACK_TEXTS } });
  await screen.findByText('Le bon comprend');
  const verso = document.querySelector('.gf-card-flip .gf-verso');
  const produced = [...verso.style].filter((n) => /^--(m|p|l|lh)-/.test(n));
  const read = new Set([...css.matchAll(/var\((--(?:m|p|l|lh)-[a-z0-9-]+)/g)].map((m) => m[1]));
  expect(produced.length).toBeGreaterThan(40);
  expect(produced.filter((n) => !read.has(n))).toEqual([]);
  expect([...read].filter((n) => !produced.includes(n))).toEqual([]);
});

test('rule 66: a template is filled once, with the value taken literally', async () => {
  setup();
  await screen.findByText('Le bon comprend');
  type(/^Prénom/, 'Marie $& {name}');
  expect(texts('.gf-card-flip .gf-v-subtitle')).toEqual(['offert à Marie $& {name}']);
});

// ── The page after payment ────────────────────────────────────────────────────────────────
function paid({ withBack = true, withFront = true } = {}) {
  window.location.hash = '';
  window.history.pushState({}, '', '/?gf_voucher=12&gf_token=tok');
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const voucher = {
    number: 'BC-2026-0001',
    kind: 'resource',
    title: 'Un bain nordique',
    contentLines: ['Bain nordique : 2 h en journée'],
    brand: 'Domaine Solio',
    amountCents: 10900,
    balanceCents: 10900,
    expiresOn: '2027-11-15', // date-literal-ok: a server field the card prints as given, never compared with today
    recipientName: 'Marie',
    senderName: 'Paul',
    message: 'Bravo',
    code: '7KQ4M9TX2WHBR6PE',
    ...(withBack ? {
      back: {
        lines: ['Bain nordique : 2 h en journée'], validUntil: '15/11/2027', link: 'site.example/bon-cadeau/utiliser', qrSvg: '<svg viewBox="0 0 5 5"><path d="M0 0h2v2H0z"/></svg>', front: withFront,
      },
    } : {}),
  };
  const routes = (method, p) => {
    if (p === '/gift-vouchers/orders/12') return { status: 200, body: { data: { state: 'active', voucher } } };
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: offerWith([BATH]) } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  return loadBlock(VIEW, { routes, assets: ASSETS });
}

test('rule 66: after payment the same card shows its back first, with the real code and QR code and no « Aperçu » pill', async () => {
  const { calls } = paid();
  await screen.findByText('Le bon est prêt');
  await waitFor(() => expect(card()).toBeTruthy());
  expect(face()).toBe('back');
  expect(document.querySelector('.gf-card-flip .gf-v-pill')).toBeNull();
  const code = document.querySelector('.gf-card-flip .gf-v-code');
  expect(code.textContent.replace(/\W/g, '')).toBe('7KQ4M9TX2WHBR6PE');
  expect(code.classList.contains('is-wait')).toBe(false);
  expect(document.querySelector('.gf-card-flip .gf-v-qr svg path').getAttribute('d')).toBe('M0 0h2v2H0z');
  expect(texts('.gf-card-flip .gf-v-subtitle')).toEqual(['offert par Paul à Marie']);
  expect(document.querySelector('.gf-card-flip .gf-v-valid').textContent).toBe('Valable jusqu’au 15/11/2027');
  expect(calls.some((c) => c.path === '/gift-vouchers/offer')).toBe(true);
});

test('rule 66: « Imprimer » lays a sheet with both faces on <body> and sets the page for that print only, then takes both away', async () => {
  paid();
  await screen.findByText('Le bon est prêt');
  expect(document.querySelector('.gf-card-sheet')).toBeNull();
  window.print = vi.fn(() => {
    const sheet = document.querySelector('body > .gf-card-sheet');
    expect(sheet.querySelectorAll('.gf-card-face.is-sheet')).toHaveLength(2);
    expect(sheet.querySelector('.gf-v-code').textContent.replace(/\W/g, '')).toBe('7KQ4M9TX2WHBR6PE');
    expect(document.body.classList.contains('gf-gv-printing-sheet')).toBe(true);
    expect(document.head.textContent).toContain('@page { size: 210mm 148mm; margin: 0; }');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Imprimer' }));
  expect(window.print).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('afterprint'));
  expect(document.querySelector('.gf-card-sheet')).toBeNull();
  expect(document.body.classList.contains('gf-gv-printing-sheet')).toBe(false);
  expect(document.head.textContent).not.toContain('@page');
});

test('rule 66: after payment the front is the voucher\'s frozen one, read by order id and token; with none the plain front carries the company name', async () => {
  paid();
  await screen.findByText('Le bon est prêt');
  expect(document.querySelector('.gf-card-flip .gf-card-front-img').getAttribute('src')).toBe('/wp-json/guestflow/v1/gift-vouchers/orders/12/front?token=tok');
  document.body.innerHTML = '';
  paid({ withFront: false });
  await screen.findByText('Le bon est prêt');
  expect(document.querySelector('.gf-card-flip .gf-card-front-img')).toBeNull();
  expect(document.querySelector('.gf-card-flip .gf-card-front.is-plain').textContent).toBe('Domaine Solio');
});

test('rule 66: with no back to draw the code still stands on the page after payment', async () => {
  paid({ withBack: false });
  await screen.findByText('Le bon est prêt');
  expect(document.querySelector('.gf-vcard')).toBeNull();
  expect(document.querySelector('.gf-gv-codebox .gf-gv-code').textContent.replace(/\W/g, '')).toBe('7KQ4M9TX2WHBR6PE');
});
