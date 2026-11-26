// specs/guest-app/guest-app.md rule 71 and the reduced-motion rule (end review R3-8) — with « reduce motion » asked, the orders list folds without a
// height animation (its Collapse runs with a 0 ms timeout), like its chevron; otherwise it keeps MUI's own duration.
import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SasArrivalOrdersStep from '../SasArrivalOrdersStep';

const timeouts = [];
vi.mock('../guestAppApi', () => ({ default: { amendOrder: vi.fn() } }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, Collapse: ({ in: shown, timeout, children }) => { timeouts.push(timeout); return shown ? children : null; } };
});

const DATA = { ordersAtArrival: { orders: [], summaryLabel: '1 commande · 12 € à percevoir', toCollect: 12, toCollectLabel: '12 €', paid: 0, paidLabel: null, changed: false } };
const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; timeouts.length = 0; });
const motion = (reduce) => {
  window.matchMedia = (query) => ({
    matches: reduce && /prefers-reduced-motion: reduce/.test(query), media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  });
};

it('rule 71 — reduce motion: the fold runs with no animation', () => {
  motion(true);
  render(<SasArrivalOrdersStep data={DATA} />);
  expect(timeouts.at(-1)).toBe(0);
});

it('rule 71 — otherwise the fold keeps its automatic duration', () => {
  motion(false);
  render(<SasArrivalOrdersStep data={DATA} />);
  expect(timeouts.at(-1)).toBe('auto');
});
