// specs/ui-review-2026-10-19-operations.md rule 3 — the numbering counts questions, not pages.
import stepNumbering from '../sasStepNumbering';

const ARRIVAL = ['intro', 'portal', 'caution', 'options', 'linen', 'linenItems', 'cleaning', 'breakfastSale',
  'breakfastMornings', 'breakfast', 'cateringAsk', 'cateringItems', 'cautionReport', 'recap'];

test('rule 3 — the total counts the questions; opened pages carry the opener\'s number', () => {
  expect(stepNumbering(ARRIVAL, 'intro')).toEqual({ number: 1, total: 9 });
  expect(stepNumbering(ARRIVAL, 'linen')).toEqual({ number: 5, total: 9 });
  expect(stepNumbering(ARRIVAL, 'linenItems')).toEqual({ number: 5, total: 9 });
  expect(stepNumbering(ARRIVAL, 'breakfastMornings')).toEqual({ number: 7, total: 9 });
  expect(stepNumbering(ARRIVAL, 'breakfast')).toEqual({ number: 7, total: 9 });
  expect(stepNumbering(ARRIVAL, 'cautionReport')).toEqual({ number: 8, total: 9 });
  expect(stepNumbering(ARRIVAL, 'recap')).toEqual({ number: 9, total: 9 });
});

test('rule 3 — a booked breakfast is a question; accepting an upsell never changes the total', () => {
  const booked = ['intro', 'breakfast', 'breakfastSale', 'recap'];
  expect(stepNumbering(booked, 'breakfast')).toEqual({ number: 2, total: 4 });
  const declined = ['intro', 'cateringAsk', 'recap'];
  const accepted = ['intro', 'cateringAsk', 'cateringItems', 'recap'];
  expect(stepNumbering(declined, 'recap').total).toBe(stepNumbering(accepted, 'recap').total);
  expect(stepNumbering(['intro', 'recap'], 'nope')).toBeNull();
});
