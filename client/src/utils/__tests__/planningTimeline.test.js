// specs/dashboard-planning-scroll.md rules 14, 15 — empty days fold into runs of « Rien de prévu », today
// is never folded, a run never crosses today, a plugin card makes a day non-empty, windows merge in order.
import { buildTimeline } from '../planningTimeline';
import { daysPayload, stay } from '../../pages/__tests__/planningDaysFixtures';

const TODAY = '2026-10-28';
const windowOf = (from, to, cardsByDate = {}, contrib = {}) => ({
  ...daysPayload({ from, to }, { today: TODAY, cardsByDate }), contrib,
});
const kinds = (items) => items.map((i) => (i.kind === 'fold' ? `fold:${i.label}` : `day:${i.day.date}`));

test('rule 15 — consecutive empty days merge into one run labelled from the days\' short labels', () => {
  const { items } = buildTimeline([windowOf('2026-10-29', '2026-11-04', { '2026-11-04': { arrivals: [stay(1)] } })]);
  expect(kinds(items)).toEqual(['fold:du jeu. 29 oct. au mar. 3 nov.', 'day:2026-11-04']);
});

test('rule 15 — a run inside one month says the month once; a single empty day reads as one date', () => {
  const cards = { '2026-11-03': { arrivals: [stay(1)] }, '2026-11-05': { arrivals: [stay(2)] } };
  const { items } = buildTimeline([windowOf('2026-11-01', '2026-11-06', cards)]);
  expect(kinds(items)).toEqual(['fold:du dim. 1 au lun. 2 nov.', 'day:2026-11-03', 'fold:mer. 4 nov.', 'day:2026-11-05', 'fold:ven. 6 nov.']);
});

test('rule 15 — today is never folded, and a run never crosses it', () => {
  const { items } = buildTimeline([windowOf('2026-10-26', '2026-10-30')]);
  expect(kinds(items)).toEqual(['fold:du lun. 26 au mar. 27 oct.', 'day:2026-10-28', 'fold:du jeu. 29 au ven. 30 oct.']);
  expect(items[1].day.isToday).toBe(true);
});

test('rule 15 — a day that only a plugin card fills is not empty; an empty plugin answer does not count', () => {
  const contrib = { 'linen:laundry': { '2026-11-02': { label: 'x' }, '2026-11-03': [] } };
  const { items } = buildTimeline([windowOf('2026-11-01', '2026-11-04', {}, contrib)]);
  expect(kinds(items)).toEqual(['fold:dim. 1 nov.', 'day:2026-11-02', 'fold:du mar. 3 au mer. 4 nov.']);
  expect(items[1].plugin).toEqual({ 'linen:laundry': { label: 'x' } });
});

test('rule 15 — breakfast and option cards count as cards, and so does a departure', () => {
  const cards = {
    '2026-11-01': { breakfast: { items: [{ reservationId: 1 }], totalPersons: 2 } },
    '2026-11-02': { optionCards: { items: [{ reservationId: 1 }] } },
    '2026-11-03': { departures: [stay(1)] },
    '2026-11-04': { breakfast: { items: [], totalPersons: 0 } },
  };
  const { items } = buildTimeline([windowOf('2026-11-01', '2026-11-04', cards)]);
  expect(kinds(items)).toEqual(['day:2026-11-01', 'day:2026-11-02', 'day:2026-11-03', 'fold:mer. 4 nov.']);
});

test('rule 14 — a run is keyed by its last day and joins across windows, so prepending keeps the key', () => {
  const before = buildTimeline([windowOf('2026-11-01', '2026-11-07', { '2026-11-07': { arrivals: [stay(1)] } }), windowOf('2026-11-08', '2026-11-14')]).items;
  const withEarlier = buildTimeline([windowOf('2026-10-29', '2026-10-31'), ...[
    windowOf('2026-11-01', '2026-11-07', { '2026-11-07': { arrivals: [stay(1)] } }), windowOf('2026-11-08', '2026-11-14')]]).items;
  // The empty run before the stay keeps its key (the last empty day) whether or not an earlier window is drawn.
  expect(before.find((i) => i.kind === 'fold').key).toBe('fold-2026-11-06');
  expect(withEarlier.find((i) => i.kind === 'fold').key).toBe('fold-2026-11-06');
  expect(withEarlier.find((i) => i.kind === 'fold').from).toBe('2026-10-29');
  // A run reaching the end of the loaded windows spans both.
  expect(before[before.length - 1]).toMatchObject({ kind: 'fold', from: '2026-11-08', to: '2026-11-14' });
});
