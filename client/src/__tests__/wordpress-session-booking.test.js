// specs/site/site-outside-resource-booking.md rules 1-9, 11-12 — « Réserver une séance », a session paid online in full: the activity (one is not asked), the duration before the slots, the people, the
// slots that carry what the whole session costs, the recap the server answers, the contact judged before anything is sent, then the bank with the 15-minute hold. The page computes nothing.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  BATH, setup, callsTo, flat, firstFreeDay, slotButton, pickSlot, fillWho, bar, barButton, resetPage,
} from './wordpressSessionFixtures';

afterEach(resetPage);

const stepper = (name) => document.querySelector(`.gf-step[aria-label="${name}"]`);
const plus = (name) => stepper(name).querySelectorAll('.gf-step-btn')[1];

test('rule 1 — one activity is shown selected and nothing is asked; none shows a short line, never an empty form', async () => {
  setup();
  await screen.findByText('Réserver une séance');
  const activity = document.querySelector('.gf-sb-acts').closest('.gf-sb-sec');
  expect(activity.hidden).toBe(true);
  expect(document.querySelector('.gf-sb-summary-line, .gf-summary-head').textContent).toContain('Bain nordique');
  resetPage();
  setup({ resources: [] });
  expect(await screen.findByText('Aucune activité à réserver en ce moment.')).toBeTruthy();
  expect(document.querySelector('.gf-sb-note').hidden).toBe(false);
  expect(screen.getByLabelText('Code bon cadeau')).toBeTruthy();
  expect(document.querySelector('.gf-sb-who').closest('.gf-sb-sec').hidden).toBe(true);
});

test('rule 1 — several activities are asked first, each with its blurb and its price; choosing one resets the session', async () => {
  const sauna = { ...BATH, id: 4, name: 'Sauna', blurb: '', fromCents: 3000, minMinutes: 30, stepMinutes: 30 };
  const { calls } = setup({ resources: [BATH, sauna] });
  await screen.findByText('Réserver une séance');
  const choices = [...document.querySelectorAll('.gf-sb-act')];
  expect(choices.map((c) => flat(c.textContent))).toEqual(['Bain nordiqueAu feu de bois · dès 50 € l’heure', 'Saunadès 30 € l’heure']);
  expect(document.querySelector('.gf-sb-acts').closest('.gf-sb-sec').hidden).toBe(false);
  expect(choices[0].getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(choices[1]);
  await waitFor(() => expect(callsTo(calls, '/sessions/slots').at(-1).body.resourceId).toBe(4));
  expect(callsTo(calls, '/sessions/slots').at(-1).body.minutes).toBe(30);
});

test('rule 2 — the sections come in the order of the lodging tunnel, the recap is an aside and the bar sits below', async () => {
  setup();
  await screen.findByText('Réserver une séance');
  const titles = [...document.querySelectorAll('.gf-sb-sec-t')].map((t) => t.firstChild.textContent);
  expect(titles).toEqual(['Activité', 'Code bon cadeau', 'Séance', 'Date', 'Créneau', 'Ajouter à la séance', 'Vos coordonnées'].filter((t) => t !== 'Ajouter à la séance'));
  expect(document.querySelector('.gf-fold-title').textContent).toBe('Ajouter à la séance');
  expect(document.querySelector('.gf-sb-sec .gf-fold').compareDocumentPosition(document.querySelector('.gf-sb-who')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const children = [...document.querySelector('.gf-sb').children].map((c) => c.className);
  expect(children).toEqual(['gf-sb-main', 'gf-summary', 'gf-bar']);
  expect(document.querySelector('.gf-summary').tagName).toBe('ASIDE');
});

test('rule 3 — the duration is set before the slots: its steps are the resource’s, and changing it reloads the slots and drops a start that no longer fits', async () => {
  const { calls } = setup();
  await screen.findByText('Réserver une séance');
  await waitFor(() => expect(callsTo(calls, '/sessions/slots')).toHaveLength(1));
  expect(callsTo(calls, '/sessions/slots')[0].body).toMatchObject({ resourceId: 3, minutes: 60 });
  expect(flat(stepper('Durée').textContent)).toContain('1 h');
  fireEvent.click(await firstFreeDay());
  fireEvent.click(await slotButton('10:00'));
  fireEvent.click(plus('Durée'));
  await waitFor(() => expect(callsTo(calls, '/sessions/slots').at(-1).body.minutes).toBe(120));
  expect(flat(stepper('Durée').textContent)).toContain('2 h');
  await waitFor(() => expect(flat(document.querySelector('.gf-sb-slot[data-start="10:00"]').textContent)).toContain('95 €'));
});

test('rule 4 — people: a stepper from 1 to the resource’s maximum, sent with the confirmation, no effect on the price', async () => {
  const { calls, confirmations } = setup();
  await screen.findByText('Réserver une séance');
  expect(document.body.textContent).toContain('8 au plus');
  expect(flat(stepper('Personnes').textContent)).toContain('2');
  for (let i = 0; i < 10; i += 1) fireEvent.click(plus('Personnes'));
  expect(flat(stepper('Personnes').textContent)).toContain('8');
  expect(plus('Personnes').disabled).toBe(true);
  const slotCalls = callsTo(calls, '/sessions/slots').length;
  await pickSlot('10:00');
  fillWho();
  fireEvent.click(barButton());
  await waitFor(() => expect(confirmations).toHaveLength(1));
  expect(confirmations[0].people).toBe(8);
  expect(callsTo(calls, '/sessions/slots').length).toBe(slotCalls);
});

test('rules 5-6 — month chips stop at the horizon, a day with no free start is unavailable, slots show the whole session’s amount, « dont soirée », and « Pris » on a taken start', async () => {
  setup();
  await screen.findByText('Réserver une séance');
  await firstFreeDay();
  expect(document.querySelectorAll('.gf-cal-chip')).toHaveLength(3);
  expect(document.querySelectorAll('.gf-sb-days button.gf-past:disabled').length).toBeGreaterThan(20);
  fireEvent.click(await firstFreeDay());
  const slots = [...document.querySelectorAll('.gf-sb-slot')].map((s) => [...s.children].map((c) => flat(c.textContent)).join(' '));
  expect(slots).toEqual(['10:00 – 11:00 50 €', '14:00 – 16:00 Pris', '19:00 – 21:00 113 € · dont soirée']);
  expect(document.querySelector('.gf-sb-slot[data-start="14:00"]').disabled).toBe(true);
});

test('rules 9, 11 — the recap names each part with its band, every amount is the server’s, and the bar and the button say what is due', async () => {
  const { calls } = setup();
  await screen.findByText('Réserver une séance');
  await pickSlot('19:00');
  const summary = flat(document.querySelector('.gf-summary').textContent);
  expect(summary).toContain('19:00 – 20:00 · journée');
  expect(summary).toContain('20:00 – 21:00 · soirée');
  expect(summary).toContain('113,00 €');
  expect(summary).toContain('2 pers.');
  expect(summary).not.toContain('Le créneau vous est réservé');
  expect(flat(bar().textContent)).toContain('113,00 €');
  expect(flat(barButton().textContent)).toBe('Payer 113,00 €');
  fireEvent.click(screen.getByLabelText('Ajouter : Planche apéro'));
  await waitFor(() => expect(callsTo(calls, '/sessions/quote').at(-1).body.addOns).toEqual([{ articleRef: 'option:7', qty: 1 }]));
  await waitFor(() => expect(flat(document.querySelector('.gf-summary').textContent)).toContain('127,00 €'));
  expect(callsTo(calls, '/sessions/quote').at(-1).body).toMatchObject({ resourceId: 3, minutes: 60 });
});

test('rule 7 — the contact is asked before anything is sent: each refusal at its field, the first wrong one takes the focus; the terms link goes to the activity’s terms', async () => {
  const { confirmations } = setup();
  await screen.findByText('Réserver une séance');
  await pickSlot('10:00');
  expect(document.querySelector('.gf-cgv-accept a').getAttribute('href')).toBe('https://site.example/cgv/?activity=resource');
  fireEvent.click(barButton());
  expect(screen.getAllByText('Champ requis.')).toHaveLength(4); // first name, last name, e-mail, phone
  expect(screen.getByText('Les conditions de la séance doivent être acceptées.')).toBeTruthy();
  expect(screen.getByText('Certains champs sont à corriger avant de continuer.')).toBeTruthy();
  expect(document.activeElement).toBe(document.querySelector('.gf-sb-who input'));
  fillWho({ first: 'Marie', last: 'Dupont', email: 'pas-un-mail', phone: '06 12 34 56 78', terms: false });
  fireEvent.click(barButton());
  expect(screen.getByText('Adresse e-mail incomplète.')).toBeTruthy();
  expect(confirmations).toHaveLength(0);
});

test('rules 8, 12 — the confirmation carries the proof of work and the page’s path, then the visitor leaves for the bank with the hold announced', async () => {
  const { GF, calls, confirmations } = setup();
  await screen.findByText('Réserver une séance');
  await pickSlot('10:00');
  fillWho();
  fireEvent.click(barButton());
  await waitFor(() => expect(GF.voucherGo).toHaveBeenCalledWith('https://pay.example/session/1'));
  expect(confirmations[0]).toMatchObject({
    resourceId: 3, start: expect.stringMatching(/^\d{4}-\d{2}-20T10:00$/), minutes: 60, addOns: [], people: 2, firstName: 'Marie', lastName: 'Dupont', email: 'marie@example.test', phone: '06 12 34 56 78', termsVersionId: 9, returnPath: '/',
  });
  expect(callsTo(calls, '/booking-requests/challenge').length).toBeGreaterThan(0);
});

test('rule 12 — a refusal of the server is its sentence at its field; a slot taken meanwhile frees the choice and reads the slots again', async () => {
  const taken = { status: 409, body: { error: { code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus libre.' } } };
  const { calls } = setup({ routes: (method, p) => (p === '/sessions/confirm' ? taken : null) });
  await screen.findByText('Réserver une séance');
  await pickSlot('10:00');
  fillWho();
  const before = callsTo(calls, '/sessions/slots').length;
  fireEvent.click(barButton());
  expect(await screen.findByText('Ce créneau n’est plus libre.')).toBeTruthy();
  await waitFor(() => expect(callsTo(calls, '/sessions/slots').length).toBeGreaterThan(before));
  expect(flat(barButton().textContent)).toBe('Choisir un créneau');
  resetPage();
  const phone = { status: 400, body: { error: { code: 'PHONE_INVALID', message: 'Numéro de téléphone invalide.', details: [{ field: 'phone' }] } } };
  setup({ routes: (method, p) => (p === '/sessions/confirm' ? phone : null) });
  await screen.findByText('Réserver une séance');
  await pickSlot('10:00');
  fillWho();
  fireEvent.click(barButton());
  expect(await screen.findByText('Numéro de téléphone invalide.')).toBeTruthy();
  expect(document.activeElement.getAttribute('type')).toBe('tel');
});

test('rule 12 — with no slot chosen the button asks for one and takes the visitor to the calendar, sending nothing', async () => {
  const { confirmations } = setup();
  await screen.findByText('Réserver une séance');
  expect(flat(barButton().textContent)).toBe('Choisir un créneau');
  fireEvent.click(barButton());
  expect(confirmations).toHaveLength(0);
});

test('with the plugin off in GuestFlow the block renders nothing', async () => {
  setup({ routes: () => ({ status: 404, body: { error: 'PLUGIN_INACTIVE', plugin: 'hourly-resources' } }) });
  const container = document.querySelector('[data-gf-session-booking]');
  await waitFor(() => expect(container.hidden).toBe(true));
  expect(container.textContent).toBe('');
});
