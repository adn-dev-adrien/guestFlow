// specs/gift-voucher-campaigns.md rules 22-32, 40 — « Utiliser un bon cadeau »: the code comes from the fragment (`#bon=`) or a field and
// only ever travels in a POST body; a stay voucher goes to the booking engine; a bath voucher lists what it includes, then months up to the
// server's horizon, slots tagged by the server, the server's recap, and the confirmation (booked, or the bank with the 15-minute hold).
// Every refusal is the server's sentence. The page computes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

// The plugin's own code module, read as Node does (it exports itself under `module`): a code with a good check character.
const VC = (() => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../integrations/wordpress/guestflow-booking/assets/voucher-code.js');
  const holder = { exports: {} };
  new Function('module', 'window', fs.readFileSync(file, 'utf8'))(holder); // eslint-disable-line no-new-func
  return holder.exports;
})();

const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js'];
const VIEW = 'blocks/gift-voucher-use/view.js';

function validCode() {
  const base = '7K2QHD9M4TXB3NP';
  return [...VC.ALPHABET].map((c) => base + c).find((c) => VC.hasValidCheck(c));
}

const monthsAhead = (n) => {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 28);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-28`;
};

const VOUCHER = {
  kind: 'resource',
  title: 'Un bain nordique',
  number: 'BC-0001',
  resource: { id: 3, name: 'Bain nordique', band: 'day', minutes: 120 },
  contents: [
    { kind: 'session', label: 'Bain nordique', detail: '2 h en journée · de 10:00 à 19:00', qty: 1 },
    { kind: 'option', label: 'Planche apéro', detail: null, qty: 1 },
  ],
  recipientName: 'Léa',
  senderName: 'Paul',
  message: 'Joyeux anniversaire',
  expiresOn: '2027-11-15',
  usedOn: null,
  addOns: [{ articleRef: 'option:7', label: 'Boisson', maxQty: 20 }],
  extraTime: { stepMinutes: 60 },
  horizonUntil: monthsAhead(2),
  termsVersionId: 9,
};

// The server's quote for a slot: a slot in the evening has a supplement due, the others nothing.
function quoted(body) {
  const evening = body.start.endsWith('T17:00');
  const drinks = ((body.addOns || []).find((a) => a.articleRef === 'option:7') || {}).qty || 0;
  const extras = [];
  if (body.extraMinutes) extras.push({ label: 'Temps supplémentaire · 1 h', detail: null, qty: 1, cents: 4321 });
  if (drinks) extras.push({ label: 'Boisson', detail: null, qty: drinks, cents: drinks * 777 });
  const supplement = evening ? { label: 'Supplément soirée', cents: 1500 } : null;
  const due = (supplement ? 1500 : 0) + extras.reduce((sum, e) => sum + e.cents, 0);
  return {
    date: body.start.slice(0, 10),
    start: body.start.slice(11),
    end: evening ? '19:00' : '12:00',
    included: [{ label: 'Bain nordique · 2 h', detail: null, qty: 1, valueCents: 9500, vatRate: 20 }, { label: 'Planche apéro', detail: null, qty: 1, valueCents: 1400, vatRate: 10 }],
    supplement,
    extras,
    dueCents: due,
    totalCents: 10900 + due,
    vat: [{ rate: 20, cents: 2 }],
  };
}

function setup(over = {}) {
  document.body.innerHTML = '<div data-gf-gift-voucher-use></div>';
  const confirmations = [];
  const routes = (method, p, body) => {
    if (over.routes) { const own = over.routes(method, p, body); if (own) return own; }
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: { available: true, campaigns: [] } } };
    if (p === '/gift-vouchers/use') return { status: 200, body: { data: over.voucher || VOUCHER } };
    if (p === '/gift-vouchers/use/slots') {
      const day = `${body.from.slice(0, 8)}20`;
      return {
        status: 200,
        body: { data: { horizonUntil: VOUCHER.horizonUntil, days: [{ date: day, slots: [
          { start: '10:00', end: '12:00', tag: 'in', supplementCents: 0 },
          { start: '17:00', end: '19:00', tag: 'supplement', supplementCents: 1500 },
        ] }] } },
      };
    }
    if (p === '/gift-vouchers/use/quote') return { status: 200, body: { data: quoted(body) } };
    if (p === '/gift-vouchers/use/confirm') {
      confirmations.push(body);
      return over.confirm ? over.confirm(body) : { status: 200, body: { data: { booked: true, date: body.start.slice(0, 10), start: body.start.slice(11), end: '12:00' } } };
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  const loaded = loadBlock(VIEW, { routes, assets: ASSETS, config: over.config || {} });
  loaded.GF.voucherGo = vi.fn();
  return { ...loaded, confirmations };
}

const flat = (text) => text.replace(/\s/g, ' ');
const callsTo = (calls, path) => calls.filter((c) => c.path === path);
const openFragment = (code) => { window.location.hash = `#bon=${code}`; };

async function openOnASlot(code, { slot = '10:00' } = {}) {
  openFragment(code);
  const harness = setup();
  await screen.findByText('Votre bon comprend');
  const day = await waitFor(() => {
    const found = document.querySelector('.gf-use-days button.gf-free');
    if (!found) throw new Error('no free day yet');
    return found;
  });
  fireEvent.click(day);
  fireEvent.click(await waitFor(() => {
    const found = document.querySelector(`.gf-use-slot[data-start="${slot}"]`);
    if (!found) throw new Error('no slot yet');
    return found;
  }));
  await waitFor(() => expect(document.querySelector('.gf-use-recap').textContent).toContain('Reste à payer'));
  return harness;
}

function fillWho({ email = 'lea@example.test', phone = '06 12 34 56 78', terms = true } = {}) {
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: email } });
  fireEvent.change(document.querySelector('input[type="tel"]'), { target: { value: phone } });
  if (terms) fireEvent.click(document.querySelector('.gf-cgv-accept input'));
}

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; window.location.hash = ''; window.history.replaceState(null, '', '/'); });

test('rule 23: the code of the QR fragment opens the voucher at once, and travels in a POST body only', async () => {
  const code = '7K2Q-HD9M-4TXB-3NPC';
  openFragment(code);
  const { calls } = setup();
  await screen.findByText('Votre bon comprend');
  const opening = callsTo(calls, '/gift-vouchers/use');
  expect(opening).toHaveLength(1);
  expect(opening[0].method).toBe('POST');
  expect(opening[0].body.code).toBe(code.replace(/-/g, ''));
  expect(calls.some((c) => c.path.includes('7K2Q') || c.path.includes('3NPC'))).toBe(false);
  expect(callsTo(calls, '/gift-vouchers/offer')).toHaveLength(0);
});

test('rule 24: « Votre bon comprend » comes first — the contents, the names, the validity — before any choice', async () => {
  openFragment(validCode());
  setup();
  const heading = await screen.findByText('Votre bon comprend');
  const root = document.querySelector('.gf-gv-use');
  expect(screen.getByText('Pour Léa, de la part de Paul')).toBeTruthy();
  expect(screen.getByText('Joyeux anniversaire')).toBeTruthy();
  expect(screen.getByText(/Bain nordique/)).toBeTruthy();
  expect(root.textContent).toMatch(/Valable jusqu.au 15 novembre 2027/);
  const order = [heading, document.querySelector('.gf-cal-box')];
  expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('rule 23: with no fragment the « Code du bon » field pre-checks the code before spending a request', async () => {
  const { calls } = setup();
  const input = await screen.findByLabelText('Code du bon');
  fireEvent.change(input, { target: { value: '7K2Q HD9M' } });
  fireEvent.click(screen.getByText('Continuer'));
  expect(screen.getByText('Le code compte 16 caractères.')).toBeTruthy();
  const code = validCode();
  const mistyped = code.slice(0, 15) + (code[15] === '0' ? '1' : '0');
  fireEvent.change(input, { target: { value: mistyped } });
  fireEvent.click(screen.getByText('Continuer'));
  expect(screen.getByText('Code mal recopié : vérifier chaque caractère.')).toBeTruthy();
  expect(callsTo(calls, '/gift-vouchers/use')).toHaveLength(0);
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByText('Continuer'));
  await screen.findByText('Votre bon comprend');
  expect(callsTo(calls, '/gift-vouchers/use')[0].body.code).toBe(code);
});

test('rule 23: a stay voucher sends the visitor to the booking engine with the code in the fragment', async () => {
  const code = validCode();
  openFragment(code);
  const { GF } = setup({ voucher: { kind: 'lodging' }, config: { bookingPageUrl: 'https://site.example/reserver/' } });
  await waitFor(() => expect(GF.voucherGo).toHaveBeenCalledWith(`https://site.example/reserver/#bon=${code}`));
});

test('rules 25-26: month chips stop at the horizon, slots carry the server’s tag, the recap is the server’s', async () => {
  const { calls } = await openOnASlot(validCode(), { slot: '17:00' });
  expect(document.querySelectorAll('.gf-cal-chip')).toHaveLength(3);
  const tags = [...document.querySelectorAll('.gf-use-slot')].map((s) => flat(s.textContent));
  expect(tags[0]).toMatch(/10:00 – 12:00\s*Inclus/);
  expect(tags[1]).toMatch(/17:00 – 19:00\s*\+ 15 € soirée/);
  const quote = callsTo(calls, '/gift-vouchers/use/quote').at(-1).body;
  expect(quote.start).toMatch(/^\d{4}-\d{2}-20T17:00$/);
  const recap = flat(document.querySelector('.gf-use-recap').textContent);
  expect(recap).toContain('Supplément soirée');
  expect(recap).toContain('15,00 €');
  expect(flat(document.querySelector('.gf-use-bar').textContent)).toContain('15,00 €');
  expect(flat(document.querySelector('.gf-use-go').textContent)).toBe('Payer 15,00 €');
  const asked = callsTo(calls, '/gift-vouchers/use/slots').at(-1).body;
  expect(asked.from).toMatch(/-01$/);
  expect(asked.code).toBeTruthy();
});

test('rule 27: extra time and add-ons go to the server, and the recap follows the server’s answer', async () => {
  const { calls } = await openOnASlot(validCode());
  fireEvent.click(screen.getByLabelText('Ajouter : Boisson'));
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use/quote').at(-1).body.addOns).toEqual([{ articleRef: 'option:7', qty: 1 }]));
  await waitFor(() => expect(flat(document.querySelector('.gf-use-recap').textContent)).toContain('7,77 €'));
  fireEvent.click(screen.getByLabelText('Ajouter : Temps supplémentaire'));
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use/slots').at(-1).body.extraMinutes).toBe(60));
  expect(document.querySelector('.gf-use-go').disabled).toBe(true);
  expect(document.querySelector('.gf-use-recap').textContent).toBe('');
});

test('rules 28-29: nothing due → the confirmation books at once, with the terms version of the activity', async () => {
  const { confirmations } = await openOnASlot(validCode());
  expect(document.querySelector('.gf-use-go').textContent).toBe('Confirmer la réservation');
  expect(document.querySelector('.gf-cgv-accept a').getAttribute('href')).toBe('https://site.example/cgv/?activity=resource');
  fillWho();
  fireEvent.click(document.querySelector('.gf-use-go'));
  expect(await screen.findByText('Séance réservée !')).toBeTruthy();
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0]).toMatchObject({
    start: expect.stringMatching(/^\d{4}-\d{2}-20T10:00$/), extraMinutes: 0, addOns: [], email: 'lea@example.test', phone: '06 12 34 56 78', termsVersionId: 9, returnPath: '/?gf_use=paid',
  });
});

test('rule 29: a remainder due → the visitor leaves for the bank with the 15-minute hold announced', async () => {
  const { GF } = await openOnASlot(validCode(), { slot: '17:00' });
  GF.voucherGo = vi.fn();
  fillWho();
  const payUrl = 'https://pay.example/use/1';
  const original = window.GFBooking.api;
  window.GFBooking.api = (method, p, body) => (p === '/gift-vouchers/use/confirm'
    ? Promise.resolve({ status: 200, body: { data: { payUrl, heldUntil: '2026-11-18T10:15:00.000Z', dueCents: 1500 } } })
    : original(method, p, body));
  fireEvent.click(document.querySelector('.gf-use-go'));
  await waitFor(() => expect(GF.voucherGo).toHaveBeenCalledWith(payUrl));
  expect(document.querySelector('.gf-use-recap').textContent).toContain('15 minutes');
});

test('rule 28: e-mail, phone and the terms are asked before anything is sent', async () => {
  const { confirmations } = await openOnASlot(validCode());
  fireEvent.click(document.querySelector('.gf-use-go'));
  expect(screen.getAllByText('Champ requis.')).toHaveLength(2); // the e-mail and the phone
  expect(screen.getByText('Les conditions de vente doivent être acceptées.')).toBeTruthy();
  fillWho({ email: 'pas-un-mail', phone: '', terms: false });
  fireEvent.click(document.querySelector('.gf-use-go'));
  expect(screen.getByText('Adresse e-mail incomplète.')).toBeTruthy();
  expect(confirmations).toHaveLength(0);
});

test('rule 32: every refusal is the server’s sentence — the code, the slot, the terms', async () => {
  openFragment(validCode());
  setup({ routes: (method, p) => (p === '/gift-vouchers/use'
    ? { status: 404, body: { error: { code: 'VOUCHER_UNKNOWN', message: 'Code inconnu. Encore 4 essais.' } } } : null) });
  expect(await screen.findByText('Code inconnu. Encore 4 essais.')).toBeTruthy();
  expect(screen.getByLabelText('Code du bon')).toBeTruthy();
});

test('rule 32: a slot taken meanwhile is the server’s sentence, and the slots are read again', async () => {
  const taken = { status: 409, body: { error: { code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus libre.' } } };
  openFragment(validCode());
  const { calls } = setup({ confirm: () => taken });
  await screen.findByText('Votre bon comprend');
  fireEvent.click(await waitFor(() => { const d = document.querySelector('.gf-use-days button.gf-free'); if (!d) throw new Error('x'); return d; }));
  fireEvent.click(await waitFor(() => { const s = document.querySelector('.gf-use-slot[data-start="10:00"]'); if (!s) throw new Error('x'); return s; }));
  await waitFor(() => expect(document.querySelector('.gf-use-go').disabled).toBe(false));
  fillWho();
  const before = callsTo(calls, '/gift-vouchers/use/slots').length;
  fireEvent.click(document.querySelector('.gf-use-go'));
  expect(await screen.findByText('Ce créneau n’est plus libre.')).toBeTruthy();
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use/slots').length).toBeGreaterThan(before));
});

test('rule 32: a voucher already used says its date and offers no slot', async () => {
  openFragment(validCode());
  setup({ voucher: { ...VOUCHER, usedOn: '2026-11-02' } });
  expect(await screen.findByText('Ce bon a déjà été utilisé le 2 novembre 2026.')).toBeTruthy();
  expect(document.querySelector('.gf-cal-box')).toBeNull();
});

test('back from the bank: « Paiement reçu » and nothing else is asked', async () => {
  window.history.replaceState(null, '', '/?gf_use=paid');
  const { calls } = setup();
  expect(await screen.findByText('Paiement reçu : la confirmation arrive par mail dès que la banque l’a validé.')).toBeTruthy();
  expect(calls).toHaveLength(0);
});

describe('rule 40: with the gift voucher plugin off in GuestFlow the block renders nothing', () => {
  const off = { status: 404, body: { error: 'PLUGIN_INACTIVE', plugin: 'gift-vouchers' } };

  test('when the page is opened bare', async () => {
    setup({ routes: () => off });
    const container = document.querySelector('[data-gf-gift-voucher-use]');
    await waitFor(() => expect(container.hidden).toBe(true));
    expect(container.textContent).toBe('');
  });

  test('when the page is opened by a QR code', async () => {
    openFragment(validCode());
    setup({ routes: () => off });
    const container = document.querySelector('[data-gf-gift-voucher-use]');
    await waitFor(() => expect(container.hidden).toBe(true));
    expect(container.textContent).toBe('');
  });
});
