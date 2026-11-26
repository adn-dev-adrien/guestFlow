// specs/guest-app/guest-app-bath-home-scheduling.md rules 1-5, 10 — the pure parts of the home's bath card: what the stay owns, the card's state
// and words, the sessions to come, and the « à la suite » candidates.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cardState, cardView, consecutiveBlocks, ownedOf, upcomingSessions,
} = require('../bathPlan');

const priceLabel = (n) => `${n} €`;
const sessionLabel = (s) => `${s.date} ${s.start}-${s.end}`;
const rates = { day: 30, evening: 50 };
const view = (over) => cardView({
  resource: { id: 2, name: 'Bain nordique' }, upcoming: [], bookable: true, rates, priceLabel, sessionLabel, ...over,
});

test('rule 1 — owned = the held hours, then the offered minutes, in minutes', () => {
  assert.deepEqual(ownedOf({ freeMinutesLeft: 60, heldHours: 2 }), { offeredMinutes: 60, heldMinutes: 120, totalMinutes: 180 });
  assert.deepEqual(ownedOf({ freeMinutesLeft: 0, heldHours: 0 }), { offeredMinutes: 0, heldMinutes: 0, totalMinutes: 0 });
  assert.equal(ownedOf({ freeMinutesLeft: -5, heldHours: 0.5 }).totalMinutes, 30, 'never negative, half hours kept');
});

test('rule 2 — the sessions to come of the resource only, ended ones dropped, in time order', () => {
  const lines = [
    // date-literal-ok: a pure function; `now` is passed in, nothing compares with today.
    { resourceId: 2, sessions: [{ date: '2026-11-16', start: '20:00', end: '21:00' }, { date: '2026-11-15', start: '09:00', end: '10:00' }] },
    // date-literal-ok: a pure function; `now` is passed in, nothing compares with today.
    { resourceId: 2, sessions: [{ date: '2026-11-15', start: '18:00', end: '19:00' }] },
    // date-literal-ok: a pure function; `now` is passed in, nothing compares with today.
    { resourceId: 9, sessions: [{ date: '2026-11-15', start: '18:00', end: '19:00' }] },
  ];
  // date-literal-ok: a pure function; `now` is passed in, nothing compares with today.
  assert.deepEqual(upcomingSessions(lines, 2, '2026-11-15T12:00').map((s) => `${s.date} ${s.start}`), ['2026-11-15 18:00', '2026-11-16 20:00']);
});

test('rules 4-5 — the state: to schedule while hours are owned, then scheduled, then the offer while a slot is free, else no card', () => {
  assert.equal(cardState({ ownedMinutes: 60, upcoming: [], bookable: false }), 'toSchedule');
  assert.equal(cardState({ ownedMinutes: 0, upcoming: [{}], bookable: false }), 'scheduled');
  assert.equal(cardState({ ownedMinutes: 0, upcoming: [], bookable: true }), 'offer');
  assert.equal(cardState({ ownedMinutes: 0, upcoming: [], bookable: false }), null);
});

test('rule 5 — the words of each state', () => {
  const one = view({ owned: ownedOf({ freeMinutesLeft: 60, heldHours: 0 }) });
  assert.deepEqual([one.title, one.detail, one.actions.map((a) => a.key)], ['1 h offerte à programmer', 'En journée, ou en soirée avec 20 € de supplément', ['schedule']]);
  const three = view({ owned: ownedOf({ freeMinutesLeft: 60, heldHours: 2 }) });
  assert.deepEqual([three.title, three.detail], ['3 h à programmer', '1 h offerte, 2 h comprises dans le séjour · À la suite ou réparties sur le séjour']);
  const held = view({ owned: ownedOf({ freeMinutesLeft: 0, heldHours: 1 }) });
  assert.equal(held.title, '1 h à programmer', 'an hour held by the stay is not called offered');
  // date-literal-ok: a pure function; `now` is passed in, nothing compares with today.
  const scheduled = view({ owned: ownedOf({}), upcoming: [{ date: '2026-11-15', start: '18:00', end: '19:00' }] });
  // date-literal-ok: a pure function; `now` is passed in, nothing compares with today.
  assert.deepEqual([scheduled.title, scheduled.upcoming[0].label, scheduled.actions.map((a) => a.label)], ['Vos séances', '2026-11-15 18:00-19:00', ['Ajouter une heure', 'Changer une séance']]);
  const offer = view({ owned: ownedOf({}) });
  assert.deepEqual([offer.title, offer.detail, offer.actions[0].label], ['Un bain nordique pendant le séjour ?', '30 € l’heure · 50 € en soirée', 'Réserver']);
  assert.equal(view({ owned: ownedOf({}), rates: { day: 30, evening: 0 } }).detail, '30 € l’heure', 'no evening band, no evening price');
  assert.equal(view({ owned: ownedOf({ freeMinutesLeft: 60 }), lang: 'en' }).title, '1 h free, to schedule');
  assert.equal(view({ owned: ownedOf({}), bookable: false }), null);
});

test('rule 6 — the offer with a slot still free today takes the former highlight\'s words: « aujourd’hui » before 18 h, « ce soir » from it', () => {
  const tonight = view({ owned: ownedOf({}), firstSlotToday: '20:00' });
  assert.deepEqual([tonight.title, tonight.detail], ['Un bain nordique ce soir ?', 'Premier créneau libre à 20 h · 30 € l’heure · 50 € en soirée']);
  const afternoon = view({ owned: ownedOf({}), firstSlotToday: '14:30' });
  assert.deepEqual([afternoon.title, afternoon.detail.split(' · ')[0]], ['Un bain nordique aujourd’hui ?', 'Premier créneau libre à 14 h 30']);
  const english = view({ owned: ownedOf({}), firstSlotToday: '20:00', lang: 'en' });
  assert.deepEqual([english.title, english.detail.split(' · ')[0]], ['A nordic bath tonight?', 'First free slot at 8 pm']);
  assert.equal(view({ owned: ownedOf({ freeMinutesLeft: 60 }), firstSlotToday: '20:00' }).title, '1 h offerte à programmer', 'owned hours come first');
});

test('rule 10 — « à la suite »: starts of N chained slots, a gap breaks the chain, the evening minutes counted', () => {
  const day = (date, starts) => ({ date, slots: starts.map((h) => ({ start: `${h}:00`, end: `${h + 1}:00`, band: h >= 20 ? 'evening' : 'day' })) });
  // date-literal-ok: a pure function; `now` is passed in, nothing compares with today.
  const out = consecutiveBlocks([day('2026-11-15', [17, 18, 20, 21]), day('2026-11-16', [11])], 2);
  // date-literal-ok: a pure function; `now` is passed in, nothing compares with today.
  assert.deepEqual(out, [{ date: '2026-11-15', starts: [{ start: '17:00', end: '19:00', eveningMinutes: 0 }, { start: '20:00', end: '22:00', eveningMinutes: 120 }] }]);
  // date-literal-ok: a pure function; `now` is passed in, nothing compares with today.
  assert.deepEqual(consecutiveBlocks([day('2026-11-15', [17, 18, 20, 21])], 3), [], 'no three hours in a row: no day');
});
