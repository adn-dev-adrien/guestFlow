/**
 * specs/welcome-pack-auto-options.md §3.4 — the form side of the pack: it adds exactly what the
 * server grants, takes back exactly what it added, and never touches a line the operator owns.
 */

import { applyWelcomePack, releaseWelcomePackLine, isWelcomePackLine } from '../welcomePackApply';

const BREAKFAST = {
  id: 6, title: 'Petit déjeuner', priceType: 'per_person_per_night', autoOptionType: 'breakfast',
  showsPlanningCard: 1, cardRepeat: 'once_per_day', planningCardTimes: ['09:00'],
};
const JUICE = { id: 21, title: 'Jus de pomme 1L', priceType: 'per_stay', showsPlanningCard: 0, cardRepeat: 'once' };

const STAY = { startDate: '2026-08-14', endDate: '2026-08-17', checkInTime: '15:00', checkOutTime: '10:00' };
const CTX = { options: [BREAKFAST, JUICE], ...STAY };

const JUICE_LINE = { optionId: 21, title: 'Jus de pomme 1L', mode: 'quantity', quantity: 1, freeUnits: 1 };
const BREAKFAST_LINE = {
  optionId: 6, title: 'Petit déjeuner', mode: 'occurrence', freeUnits: 2,
  occurrence: { date: '2026-08-15', time: '09:00' },
};

const find = (list, optionId) => list.find((e) => Number(e.optionId) === optionId);
const checkedDates = (entry) => entry.cardOccurrences.filter((o) => o.checked).map((o) => o.date);

test('grants the per-stay line at its free quantity and tags it', () => {
  const next = applyWelcomePack([], [JUICE_LINE], CTX);
  expect(next).toHaveLength(1);
  expect(find(next, 21)).toMatchObject({ optionId: 21, quantity: 1 });
  expect(isWelcomePackLine(find(next, 21))).toBe(true);
});

test('grants the card line with the first morning checked and every other day off', () => {
  const next = applyWelcomePack([], [BREAKFAST_LINE], CTX);
  const entry = find(next, 6);
  expect(checkedDates(entry)).toEqual(['2026-08-15']);
  // The other candidate mornings are present in the grid, unchecked — the operator can tick them.
  expect(entry.cardOccurrences.length).toBeGreaterThan(1);
  expect(isWelcomePackLine(entry)).toBe(true);
});

test('removes only the tagged lines when the grant disappears (platform switched)', () => {
  const applied = applyWelcomePack(
    [{ optionId: 16, quantity: 1 }],
    [JUICE_LINE, BREAKFAST_LINE],
    CTX,
  );
  expect(applied).toHaveLength(3);
  const removed = applyWelcomePack(applied, [], CTX);
  expect(removed.map((e) => e.optionId)).toEqual([16]);
});

test('an option the operator already picked is left alone — no duplicate, no tag', () => {
  const manual = [{ optionId: 21, quantity: 3 }];
  const next = applyWelcomePack(manual, [JUICE_LINE], CTX);
  expect(next).toBe(manual);
  expect(applyWelcomePack(next, [], CTX)).toBe(next);
});

test('a released line survives a platform switch (rule 11)', () => {
  const applied = applyWelcomePack([], [JUICE_LINE], CTX);
  const released = releaseWelcomePackLine(applied, 21);
  expect(isWelcomePackLine(find(released, 21))).toBe(false);
  expect(applyWelcomePack(released, [], CTX)).toBe(released);
});

test('an option the operator turned off is not put back (rule 11)', () => {
  // Unticking deletes the line AND its tag, so the refusal has to live outside the line.
  const excluded = new Set([21]);
  expect(applyWelcomePack([], [JUICE_LINE], { ...CTX, excludedOptionIds: excluded })).toEqual([]);
  // The rest of the pack is unaffected.
  const next = applyWelcomePack([], [JUICE_LINE, BREAKFAST_LINE], { ...CTX, excludedOptionIds: excluded });
  expect(next.map((e) => e.optionId)).toEqual([6]);
});

test('rebuilds a tagged card line when the granted morning moved (stay dates changed)', () => {
  const applied = applyWelcomePack([], [BREAKFAST_LINE], CTX);
  const laterStay = { ...CTX, startDate: '2026-08-20', endDate: '2026-08-23' };
  const moved = applyWelcomePack(applied, [{ ...BREAKFAST_LINE, occurrence: { date: '2026-08-21', time: '09:00' } }], laterStay);
  expect(checkedDates(find(moved, 6))).toEqual(['2026-08-21']);
});

test('undoes the grid reconcile that pre-checks new mornings on a tagged line', () => {
  const applied = applyWelcomePack([], [BREAKFAST_LINE], CTX);
  // Simulate the date-change reconcile ticking every candidate day.
  const widened = applied.map((e) => ({ ...e, cardOccurrences: e.cardOccurrences.map((o) => ({ ...o, checked: true })) }));
  const next = applyWelcomePack(widened, [BREAKFAST_LINE], CTX);
  expect(checkedDates(find(next, 6))).toEqual(['2026-08-15']);
});

test('returns the same reference when nothing changed', () => {
  const applied = applyWelcomePack([], [JUICE_LINE, BREAKFAST_LINE], CTX);
  expect(applyWelcomePack(applied, [JUICE_LINE, BREAKFAST_LINE], CTX)).toBe(applied);
  const empty = [];
  expect(applyWelcomePack(empty, [], CTX)).toBe(empty);
});

test('a granted card option missing from the catalogue is skipped, not half-applied', () => {
  const next = applyWelcomePack([], [BREAKFAST_LINE], { ...CTX, options: [JUICE] });
  expect(next).toEqual([]);
});
