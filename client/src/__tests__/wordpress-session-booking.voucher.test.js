// specs/site/site-outside-resource-booking.md rules 10, 14-15, 18 — the gift voucher code of « Réserver une séance »: the fragment `#bon=` fills the field and applies it, a resource voucher switches the
// page to the redemption calls (the voucher settles what it covers, each slot says what is left, the recap says « Inclus »), an unknown code, a stay voucher and another activity’s voucher each have
// their sentence, and « Retirer » gives the page back to the online payment in full.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  BATH, setup, callsTo, flat, firstFreeDay, slotButton, pickSlot, fillWho, barButton, validCode, resetPage,
} from './wordpressSessionFixtures';

afterEach(resetPage);

const VOUCHER = {
  kind: 'resource',
  title: 'Une heure de bain nordique en journée',
  number: 'BC-2026-0042',
  resource: {
    id: 3, name: 'Bain nordique', band: 'day', minutes: 60, stepMinutes: 60, maxMinutes: 720, maxPeople: 8,
  },
  contents: [{ kind: 'session', label: 'Bain nordique', detail: '1 h en journée', qty: 1 }],
  recipientName: 'Julien',
  senderName: 'Claire',
  message: '',
  expiresOn: '2099-01-01', // date-literal-ok: a payload the mocked server answers; the screen only shows it
  usedOn: null,
  addOns: [{
    articleRef: 'option:9', label: 'Peignoir', maxQty: 2, unitLabel: 'l’unité', linear: true, prices: [{ qty: 1, cents: 600 }, { qty: 2, cents: 1200 }],
  }],
  extraTime: { stepMinutes: 60, prices: [{ minutes: 60, cents: 4500 }] },
  horizonUntil: BATH.horizonUntil,
  termsVersionId: 9,
};

const day = (from) => `${from.slice(0, 8)}20`;

// The redemption's slots: what each start leaves to pay above the voucher, the evening marked.
function useSlots(body) {
  const extra = body.extraMinutes > 0;
  return {
    status: 200,
    body: {
      data: {
        horizonUntil: VOUCHER.horizonUntil,
        days: [{
          date: day(body.from),
          slots: [
            { start: '10:00', end: extra ? '12:00' : '11:00', tag: 'in', supplementCents: 0, dueCents: extra ? 4500 : 0, evening: false },
            { start: '19:00', end: extra ? '21:00' : '20:00', tag: 'in', supplementCents: 0, dueCents: extra ? 6300 : 0, evening: extra },
            ...(extra ? [] : [{ start: '20:00', end: '21:00', tag: 'supplement', supplementCents: 2000, dueCents: 2000, evening: true }]),
          ],
        }],
      },
    },
  };
}

function useQuote(body) {
  const evening = body.start.endsWith('T20:00') && !body.extraMinutes;
  const lateExtra = body.extraMinutes ? [{ label: 'Temps supplémentaire · 1 h', detail: null, qty: 1, cents: body.start.endsWith('T19:00') ? 6300 : 4500 }] : [];
  const supplement = evening ? { label: 'Supplément soirée', cents: 2000 } : null;
  const due = (supplement ? 2000 : 0) + lateExtra.reduce((s, e) => s + e.cents, 0);
  return {
    status: 200,
    body: {
      data: {
        date: body.start.slice(0, 10),
        start: body.start.slice(11),
        end: '11:00',
        included: [{ label: 'Bain nordique · 1 h', detail: null, qty: 1, valueCents: 5000, vatRate: 10 }],
        supplement,
        extras: lateExtra,
        extrasCents: lateExtra.reduce((s, e) => s + e.cents, 0),
        dueCents: due,
        totalCents: 5000 + due,
        vat: [{ rate: 10, cents: 3 }],
      },
    },
  };
}

function voucherSetup(over = {}) {
  const confirmations = [];
  const harness = setup({
    ...over,
    routes: (method, p, body) => {
      if (over.routes) { const own = over.routes(method, p, body); if (own) return own; }
      if (p === '/gift-vouchers/use') return { status: 200, body: { data: over.voucher || VOUCHER } };
      if (p === '/gift-vouchers/use/slots') return useSlots(body);
      if (p === '/gift-vouchers/use/quote') return useQuote(body);
      if (p === '/gift-vouchers/use/confirm') {
        confirmations.push(body);
        return over.confirm ? over.confirm(body) : { status: 200, body: { data: { booked: true, date: body.start.slice(0, 10), start: body.start.slice(11), end: '11:00' } } };
      }
      return null;
    },
  });
  return { ...harness, voucherConfirmations: confirmations };
}

const applyTyped = (code) => {
  fireEvent.change(screen.getByLabelText('Code bon cadeau'), { target: { value: code } });
  fireEvent.click(screen.getByText('Appliquer'));
};

test('rule 18 — the fragment fills the code field and applies it; the code travels in a POST body only', async () => {
  const code = validCode().replace(/(.{4})(?=.)/g, '$1-');
  window.location.hash = `#bon=${code}`;
  const { calls } = voucherSetup();
  await waitFor(() => expect(flat(document.querySelector('.gf-sb-msg').textContent)).toContain('Bon n° BC-2026-0042 · Une heure de bain nordique en journée, offert par Claire à Julien'));
  const opening = callsTo(calls, '/gift-vouchers/use');
  expect(opening).toHaveLength(1);
  expect(opening[0].method).toBe('POST');
  expect(opening[0].body.code).toBe(code.replace(/-/g, ''));
  expect(calls.some((c) => c.path.includes(code.slice(0, 4)) || c.path.includes(code.slice(-4)))).toBe(false);
  expect(screen.getByText('Retirer')).toBeTruthy();
});

test('rule 15 — the code is pre-checked before a request is spent: empty, too short, mistyped', async () => {
  const { calls } = voucherSetup();
  await screen.findByLabelText('Code bon cadeau');
  fireEvent.click(screen.getByText('Appliquer'));
  expect(screen.getByText('Saisissez le code imprimé au dos du bon.')).toBeTruthy();
  applyTyped('7K2Q HD9M');
  expect(screen.getByText(/Ce code n’est pas reconnu\. Vérifiez les caractères au dos du bon \(0 et O, 1 et I\)\./)).toBeTruthy();
  const code = validCode();
  applyTyped(code.slice(0, 15) + (code[15] === '0' ? '1' : '0'));
  expect(screen.getByText(/Ce code n’est pas reconnu/)).toBeTruthy();
  expect(callsTo(calls, '/gift-vouchers/use')).toHaveLength(0);
});

test('rule 15 — a code GuestFlow does not know says so; any other refusal is the server’s sentence', async () => {
  voucherSetup({ routes: (method, p) => (p === '/gift-vouchers/use' ? { status: 404, body: { error: { code: 'VOUCHER_UNKNOWN', message: 'Code inconnu. Encore 4 essais.' } } } : null) });
  await screen.findByLabelText('Code bon cadeau');
  applyTyped(validCode());
  expect(await screen.findByText(/Ce code n’est pas reconnu\. Vérifiez les caractères/)).toBeTruthy();
  resetPage();
  voucherSetup({ routes: (method, p) => (p === '/gift-vouchers/use' ? { status: 409, body: { error: { code: 'VOUCHER_EXPIRED', message: 'Ce bon a expiré le 15/11/2027.' } } } : null) });
  await screen.findByLabelText('Code bon cadeau');
  applyTyped(validCode());
  expect(await screen.findByText('Ce bon a expiré le 15/11/2027.')).toBeTruthy();
  expect(document.querySelector('.gf-sb-code').hidden).toBe(false);
});

test('rule 15 — a stay voucher says it settles a stay and links to the lodging page with the code in the fragment', async () => {
  const code = validCode();
  voucherSetup({ voucher: { kind: 'lodging' }, config: { bookingPageUrl: 'https://site.example/reserver/' } });
  await screen.findByLabelText('Code bon cadeau');
  applyTyped(code);
  const link = await screen.findByText('Réserver un hébergement');
  expect(link.getAttribute('href')).toBe(`https://site.example/reserver/#bon=${code}`);
  expect(screen.getByText(/Ce bon se règle sur un séjour/)).toBeTruthy();
});

test('rule 15 — a voucher for another activity selects it', async () => {
  const sauna = { ...BATH, id: 4, name: 'Sauna' };
  const { calls } = voucherSetup({ resources: [BATH, sauna], voucher: { ...VOUCHER, resource: { ...VOUCHER.resource, id: 4, name: 'Sauna' } } });
  await screen.findByLabelText('Code bon cadeau');
  applyTyped(validCode());
  await waitFor(() => expect(document.querySelector('.gf-sb-act[data-resource="4"]').getAttribute('aria-pressed')).toBe('true'));
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use/slots').length).toBeGreaterThan(0));
});

test('rule 14 — a voucher does not depend on its activity being sold online: with none on offer the code field stays, and the voucher brings its activity, its limits and its terms', async () => {
  const bare = { ...VOUCHER, resource: { ...VOUCHER.resource, id: 55, name: 'Bain privé', stepMinutes: 30, maxMinutes: 240, maxPeople: 4 }, termsVersionId: 12 };
  const { calls, voucherConfirmations } = voucherSetup({ resources: [], voucher: bare });
  expect(await screen.findByText('Aucune activité à réserver en ce moment.')).toBeTruthy();
  expect(screen.getByLabelText('Code bon cadeau')).toBeTruthy();
  expect(document.querySelector('.gf-sb-who').closest('.gf-sb-sec').hidden).toBe(true);
  expect(document.querySelector('.gf-summary').hidden).toBe(true);
  expect(callsTo(calls, '/sessions/slots')).toHaveLength(0);
  applyTyped(validCode());
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use/slots').length).toBeGreaterThan(0));
  expect(screen.getByText('Aucune activité à réserver en ce moment.').hidden).toBe(true);
  expect(document.querySelector('.gf-summary').hidden).toBe(false);
  expect(document.querySelector('.gf-summary-head').textContent).toBe('Bain privé');
  const durationPlus = document.querySelector('.gf-step[aria-label="Durée"] .gf-step-btn:last-child');
  fireEvent.click(durationPlus);
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use/slots').at(-1).body.extraMinutes).toBe(30));
  expect(document.body.textContent).toContain('4 au plus');
  await pickSlot('10:00');
  fillWho();
  fireEvent.click(barButton());
  await waitFor(() => expect(voucherConfirmations).toHaveLength(1));
  expect(voucherConfirmations[0].termsVersionId).toBe(12);
});

test('rule 14 — removing a voucher whose activity is not sold online gives back the empty page, code field included', async () => {
  const bare = { ...VOUCHER, resource: { ...VOUCHER.resource, id: 55, name: 'Bain privé' } };
  voucherSetup({ resources: [], voucher: bare });
  await screen.findByText('Aucune activité à réserver en ce moment.');
  applyTyped(validCode());
  await waitFor(() => expect(document.querySelector('.gf-summary').hidden).toBe(false));
  fireEvent.click(screen.getByText('Retirer'));
  await waitFor(() => expect(document.querySelector('.gf-summary').hidden).toBe(true));
  expect(screen.getByText('Aucune activité à réserver en ce moment.').hidden).toBe(false);
});

test('rule 14 — the fragment of a QR code is handled with an empty list too', async () => {
  window.location.hash = `#bon=${validCode()}`;
  const { calls } = voucherSetup({ resources: [] });
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use')).toHaveLength(1));
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use/slots').length).toBeGreaterThan(0));
  expect(document.querySelector('.gf-sb-msg').textContent).toContain('Bon n° BC-2026-0042');
});

test('rules 10, 14 — with a voucher the page asks the redemption: the covered time is the duration’s minimum, each slot says what is left, the recap says « Inclus » and nothing due books at once', async () => {
  window.location.hash = `#bon=${validCode()}`;
  const { calls, voucherConfirmations } = voucherSetup();
  await waitFor(() => expect(document.querySelector('.gf-sb-msg').textContent).toContain('Bon n° BC-2026-0042'));
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use/slots').length).toBeGreaterThan(0));
  expect(callsTo(calls, '/gift-vouchers/use/slots').at(-1).body).toMatchObject({ extraMinutes: 0 });
  expect(callsTo(calls, '/gift-vouchers/use/slots').at(-1).body.code).toBeTruthy();
  expect(document.body.textContent).toContain('1 h comprise dans le bon');
  const minus = document.querySelector('.gf-step[aria-label="Durée"] .gf-step-btn');
  expect(minus.disabled).toBe(true);
  fireEvent.click(await firstFreeDay());
  const tags = Object.fromEntries([...(await waitFor(() => { const l = document.querySelectorAll('.gf-sb-slot'); if (!l.length) throw new Error('x'); return l; }))].map((s) => [s.dataset.start, flat(s.lastChild.textContent)]));
  expect(tags).toEqual({ '10:00': 'Inclus dans le bon', '19:00': 'Inclus dans le bon', '20:00': '+ 20 € · soirée' });
  fireEvent.click(await slotButton('10:00'));
  await waitFor(() => expect(document.querySelector('.gf-summary').textContent).toContain('Rien à payer'));
  expect(flat(document.querySelector('.gf-summary').textContent)).toContain('Inclus');
  expect(flat(barButton().textContent)).toBe('Confirmer la réservation');
  fillWho();
  fireEvent.click(barButton());
  expect(await screen.findByText('Séance réservée')).toBeTruthy();
  expect(voucherConfirmations[0]).toMatchObject({
    start: expect.stringMatching(/^\d{4}-\d{2}-20T10:00$/), extraMinutes: 0, addOns: [], firstName: 'Marie', lastName: 'Dupont', people: 2, email: 'marie@example.test', phone: '06 12 34 56 78', termsVersionId: 9, returnPath: '/?gf_use=paid',
  });
  expect(voucherConfirmations[0].code).toBeTruthy();
  expect(callsTo(calls, '/sessions/confirm')).toHaveLength(0);
});

test('rule 10 — a longer session adds the hours beyond the voucher at their own band: the chip says « + 63 € · soirée », the recap lists the extra time, the button asks for the rest', async () => {
  window.location.hash = `#bon=${validCode()}`;
  const { calls } = voucherSetup();
  await waitFor(() => expect(document.querySelector('.gf-sb-msg').textContent).toContain('Bon n° BC-2026-0042'));
  fireEvent.click(document.querySelector('.gf-step[aria-label="Durée"] .gf-step-btn:last-child'));
  await waitFor(() => expect(callsTo(calls, '/gift-vouchers/use/slots').at(-1).body.extraMinutes).toBe(60));
  fireEvent.click(await firstFreeDay());
  await waitFor(() => expect(document.querySelector('.gf-sb-slot[data-start="19:00"]')).toBeTruthy());
  expect(flat(document.querySelector('.gf-sb-slot[data-start="19:00"]').lastChild.textContent)).toBe('+ 63 € · soirée');
  expect(flat(document.querySelector('.gf-sb-slot[data-start="10:00"]').lastChild.textContent)).toBe('+ 45 €');
  fireEvent.click(await slotButton('19:00'));
  await waitFor(() => expect(flat(document.querySelector('.gf-summary').textContent)).toContain('Temps supplémentaire · 1 h'));
  expect(callsTo(calls, '/gift-vouchers/use/quote').at(-1).body.extraMinutes).toBe(60);
  expect(flat(barButton().textContent)).toBe('Payer 63,00 €');
});

test('rule 14 — a remainder due sends the visitor to the bank, the redemption’s way back being its own', async () => {
  window.location.hash = `#bon=${validCode()}`;
  const { GF, voucherConfirmations } = voucherSetup({
    confirm: () => ({ status: 200, body: { data: { payUrl: 'https://pay.example/use/1', heldUntil: '2026-11-18T10:15:00.000Z', dueCents: 2000 } } }), // date-literal-ok: a payload the mocked server answers; the screen only shows it
  });
  await waitFor(() => expect(document.querySelector('.gf-sb-msg').textContent).toContain('Bon n° BC-2026-0042'));
  await pickSlot('20:00');
  expect(flat(barButton().textContent)).toBe('Payer 20,00 €');
  fillWho();
  fireEvent.click(barButton());
  await waitFor(() => expect(GF.voucherGo).toHaveBeenCalledWith('https://pay.example/use/1'));
  expect(voucherConfirmations[0].returnPath).toBe('/?gf_use=paid');
});

test('rule 15 — « Retirer » gives the page back to the online payment in full: the field returns, the slots are read from the sessions again', async () => {
  window.location.hash = `#bon=${validCode()}`;
  const { calls } = voucherSetup();
  await waitFor(() => expect(document.querySelector('.gf-sb-msg').textContent).toContain('Bon n° BC-2026-0042'));
  expect(document.querySelector('.gf-sb-code').hidden).toBe(true);
  fireEvent.click(screen.getByText('Retirer'));
  expect(document.querySelector('.gf-sb-code').hidden).toBe(false);
  await waitFor(() => expect(callsTo(calls, '/sessions/slots').length).toBeGreaterThan(0));
  fireEvent.click(await firstFreeDay());
  expect(flat((await slotButton('19:00')).textContent)).toContain('113 € · dont soirée');
  expect(document.body.textContent).not.toContain('comprise dans le bon');
});

test('rule 15 — the add-ons offered with a voucher are the voucher’s, not the activity’s', async () => {
  window.location.hash = `#bon=${validCode()}`;
  voucherSetup();
  await waitFor(() => expect(document.querySelector('.gf-sb-msg').textContent).toContain('Bon n° BC-2026-0042'));
  expect(screen.getByLabelText('Ajouter : Peignoir')).toBeTruthy();
  expect(screen.queryByLabelText('Ajouter : Planche apéro')).toBeNull();
});

test('rule 15 — with the gift voucher plugin off in GuestFlow the code field is not offered, and the rest of the page works', async () => {
  const { calls } = voucherSetup({ routes: (method, p) => (p === '/gift-vouchers/offer' ? { status: 404, body: { error: 'PLUGIN_INACTIVE', plugin: 'gift-vouchers' } } : null) });
  await screen.findByText('Réserver une séance');
  await waitFor(() => expect(document.querySelector('.gf-sb-code').closest('.gf-sb-sec').hidden).toBe(true));
  expect(callsTo(calls, '/sessions/slots').length).toBeGreaterThan(0);
});
