import { describe, test, expect } from 'vitest';

import {
  hydrateSelectedOptions,
  hydrateCustomOptions,
  hydrateSelectedResources,
  hydrateOfferedOptionIds,
  frozenUnitPrices,
} from '../bookingFormHydration';

// specs/devis-extras-parity-and-price-lock.md §3 rule 12 + §4.2.
// The devis branch of ReservationPage used to map a strict subset of what the reservation branch
// mapped, so re-opening a quote lost its scheduled mornings, its booked hours, its Complément routing
// and its custom-option ids — which the next save then dropped for good. One mapper now serves both.

const STAY = { startDate: '2027-03-08', endDate: '2027-03-11', checkInTime: '16:00', checkOutTime: '10:00' };
const CATALOGUE = [
  { id: 6, title: 'Petit déjeuner', showsPlanningCard: 1 },
  { id: 7, title: 'Ménage', showsPlanningCard: 0 },
];
// Stand-in for `buildCardGridFromStored` — the real one is exercised by cardOccurrences.test.js.
const buildCardGrid = (option, startDate, endDate, stored) => (stored || []).map((o) => ({ ...o, checked: true }));

describe('hydrateSelectedOptions', () => {
  test('rebuilds the occurrence grid of a planning-card option', () => {
    const [line] = hydrateSelectedOptions(
      [{ optionId: 6, quantity: 3, totalPrice: 48, cardOccurrences: [{ date: '2027-03-09', time: '08:30' }] }],
      STAY, CATALOGUE, buildCardGrid,
    );

    expect(line.cardOccurrences).toEqual([{ date: '2027-03-09', time: '08:30', checked: true }]);
  });

  test('leaves a plain option without a grid', () => {
    const [line] = hydrateSelectedOptions([{ optionId: 7, quantity: 1, totalPrice: 80 }], STAY, CATALOGUE, buildCardGrid);

    expect(line.cardOccurrences).toBeUndefined();
    expect(line.totalPrice).toBe(80);
  });

  test('carries the Complément routing and its captured contributions', () => {
    const [line] = hydrateSelectedOptions(
      [{ optionId: 7, quantity: 1, inComplement: 1, acompteContribTtc: 12, soldeContribTtc: 8 }],
      STAY, CATALOGUE, buildCardGrid,
    );

    expect(line.inComplement).toBe(true);
    expect(line.acompteContribTtc).toBe(12);
    expect(line.soldeContribTtc).toBe(8);
  });

  test('skips the custom lines — they have their own mapper', () => {
    const lines = hydrateSelectedOptions(
      [{ optionId: 7, quantity: 1 }, { isCustom: true, title: 'Panier' }],
      STAY, CATALOGUE, buildCardGrid,
    );

    expect(lines).toHaveLength(1);
  });
});

describe('hydrateCustomOptions', () => {
  test('keeps the stored id so a re-save updates the line instead of re-creating it', () => {
    const [line] = hydrateCustomOptions([{ isCustom: true, customOptionId: 42, title: 'Panier gourmand', originalTotalPrice: 25 }]);

    expect(line.customOptionId).toBe(42);
    expect(line.customKey).toBe('42');
    expect(line.description).toBe('Panier gourmand');
    expect(line.amount).toBe(25);
  });

  test('falls back to a positional key when the payload has no id', () => {
    const [line] = hydrateCustomOptions([{ isCustom: true, description: 'Extra', totalPrice: 10 }]);

    expect(line.customKey).toBe('custom_1');
    expect(line.amount).toBe(10);
  });
});

describe('hydrateSelectedResources', () => {
  test('restores the hourly sessions', () => {
    const sessions = [{ date: '2027-03-09', start: '18:00', end: '20:00' }];
    const [line] = hydrateSelectedResources([{ resourceId: 2, quantity: 1, unitPrice: 30, totalPrice: 60, sessions }]);

    expect(line.sessions).toEqual(sessions);
    expect(line.totalPrice).toBe(60);
  });

  test('parses sessions that ride the payload as JSON text', () => {
    const [line] = hydrateSelectedResources([{ resourceId: 2, sessions: '[{"date":"2027-03-09","start":"18:00","end":"20:00"}]' }]);

    expect(line.sessions).toHaveLength(1);
  });

  test('a resource without sessions gets an empty list, never undefined', () => {
    const [line] = hydrateSelectedResources([{ resourceId: 3, quantity: 2 }]);

    expect(line.sessions).toEqual([]);
  });
});

test('hydrateOfferedOptionIds keeps only the offered catalogue lines', () => {
  const offered = hydrateOfferedOptionIds([
    { optionId: 6, offered: 1 },
    { optionId: 7, offered: 0 },
    { isCustom: true, offered: 1 },
  ]);

  expect([...offered]).toEqual([6]);
});

describe('frozenUnitPrices', () => {
  test('reads the stored unit price when there is one', () => {
    expect(frozenUnitPrices([{ optionId: 6, unitPrice: 8, quantity: 3, totalPrice: 48 }], 'optionId')).toEqual({ 6: 8 });
  });

  test('falls back to total ÷ quantity on a legacy line', () => {
    expect(frozenUnitPrices([{ resourceId: 2, quantity: 2, totalPrice: 60 }], 'resourceId')).toEqual({ 2: 30 });
  });

  test('never divides by zero', () => {
    expect(frozenUnitPrices([{ optionId: 9, quantity: 0, totalPrice: 20 }], 'optionId')).toEqual({ 9: 20 });
  });
});
