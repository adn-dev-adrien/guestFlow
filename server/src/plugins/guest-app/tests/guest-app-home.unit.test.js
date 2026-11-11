// specs/guest-app.md rules 5, 10, 11 — the server-written lines of the home. Pure, far-future dates.
const test = require('node:test');
const assert = require('node:assert/strict');

const sdk = require('../../sdk');
const { chooseHighlight, openingLine, statusLine, timeLabel, welcomeLine } = require('../homeHighlight');

const { computeWindow } = sdk.coreModule('stayWindow');

const stay = (over = {}) => ({ startDate: '2099-07-06', endDate: '2099-07-09', checkInTime: '16:00', checkOutTime: '10:00', ...over });
const line = (now, over, lang) => {
  const s = stay(over);
  return statusLine(s, computeWindow(s), new Date(now), lang);
};

test('rule 10: the status line follows the stay', () => {
  assert.equal(line('2099-07-06T15:00:00+02:00'), 'Arrivée aujourd’hui à partir de 16 h');
  assert.equal(line('2099-07-07T12:00:00+02:00'), 'Jour 2 sur 4');
  assert.equal(line('2099-07-08T12:00:00+02:00'), 'Départ demain avant 10 h');
  assert.equal(line('2099-07-09T09:00:00+02:00'), 'Départ aujourd’hui avant 10 h');
});

test('rule 6 with rule 10: a pre-arrival guest reads the days left', () => {
  assert.equal(line('2099-07-05T12:00:00+02:00'), 'Arrivée demain à partir de 16 h');
  assert.equal(line('2099-07-01T12:00:00+02:00'), 'Arrivée dans 5 jours');
});

test('rule 10: a one-night stay reads its arrival on the first day', () => {
  assert.equal(line('2099-07-06T15:00:00+02:00', { endDate: '2099-07-07' }), 'Arrivée aujourd’hui à partir de 16 h');
});

test('rule 10: the calendar is Paris, not UTC, late in the evening', () => {
  assert.equal(line('2099-07-07T22:30:00Z'), 'Départ demain avant 10 h');
});

test('rule 10: times carry their minutes, and English reads as English', () => {
  assert.equal(line('2099-07-06T15:00:00+02:00', { checkInTime: '16:30' }), 'Arrivée aujourd’hui à partir de 16 h 30');
  assert.equal(line('2099-07-06T15:00:00+02:00', { checkInTime: '16:30' }, 'en'), 'Arriving today from 4:30 pm');
  assert.equal(line('2099-07-07T12:00:00+02:00', {}, 'en'), 'Day 2 of 4');
  assert.equal(timeLabel(new Date('2099-07-06T00:00:00+02:00'), 'en'), '12 am');
});

test('rule 5: a guest who scanned too early is told, in the words of the spec', () => {
  const w = computeWindow(stay());
  assert.equal(openingLine({ opensAt: w.start, checkInAt: w.checkIn }), 'Votre séjour commence aujourd’hui à 16 h — le portail et la boutique s’ouvriront à 13 h.');
  assert.equal(welcomeLine('La Granja'), 'Bienvenue à La Granja');
  assert.equal(welcomeLine('La Granja', 'en'), 'Welcome to La Granja');
});

const ALL = ['gate', 'wifi', 'shop', 'bath', 'soliomap', 'booklet', 'orders'];
const pick = (now, over = {}) => chooseHighlight({ stay: stay(), now: new Date(now), shown: ALL, ...over });

test('rule 11: arrival day → the gate', () => {
  assert.equal(pick('2099-07-06T15:00:00+02:00').text, 'Le portail est actif');
});

test('rule 11: eve of departure → the booklet page Départ', () => {
  const found = pick('2099-07-08T12:00:00+02:00');
  assert.equal(found.text, 'Départ demain : les consignes');
  assert.equal(found.module, 'booklet');
  assert.equal(found.page, 'depart');
});

test('rule 11: a free bath slot today, mid-stay — « ce soir » from 18 h, « aujourd’hui » before, with the first bookable hour', () => {
  const evening = pick('2099-07-07T12:00:00+02:00', { bathFirstSlot: '20:00' });
  assert.deepEqual([evening.key, evening.text, evening.detail], ['bath', 'Un bain nordique ce soir ?', 'Premier créneau libre à 20 h']);
  const afternoon = pick('2099-07-07T12:00:00+02:00', { bathFirstSlot: '14:30' });
  assert.deepEqual([afternoon.text, afternoon.detail], ['Un bain nordique aujourd’hui ?', 'Premier créneau libre à 14 h 30']);
  const english = pick('2099-07-07T12:00:00+02:00', { bathFirstSlot: '20:00', lang: 'en' });
  assert.deepEqual([english.text, english.detail], ['A nordic bath tonight?', 'First free slot at 8 pm']);
});

test('rule 11: an order delivered in the last hour comes first, and there is only one card', () => {
  const found = pick('2099-07-06T15:00:00+02:00', { orderReady: true, bathFirstSlot: '20:00' });
  assert.equal(found.key, 'order');
  assert.equal(Array.isArray(found), false);
});

test('rule 11: the departure instructions beat the bath on the eve of departure', () => {
  assert.equal(pick('2099-07-08T12:00:00+02:00', { bathFirstSlot: '20:00' }).key, 'departure');
});

test('rule 11: nothing to say → no card', () => {
  assert.equal(pick('2099-07-07T12:00:00+02:00'), null);
});

test('rule 11: a highlight is only chosen among the shown modules', () => {
  const shown = ALL.filter((key) => key !== 'gate');
  assert.equal(pick('2099-07-06T15:00:00+02:00', { shown }), null);
  assert.equal(pick('2099-07-07T12:00:00+02:00', { bathFirstSlot: '20:00', shown: ['wifi'] }), null);
  assert.equal(pick('2099-07-08T12:00:00+02:00', { shown: ['wifi'] }), null);
  assert.equal(pick('2099-07-07T12:00:00+02:00', { orderReady: true, shown: ['wifi'] }), null);
});

test('rule 11: English', () => {
  assert.equal(pick('2099-07-06T15:00:00+02:00', { lang: 'en' }).text, 'The gate is active');
});
