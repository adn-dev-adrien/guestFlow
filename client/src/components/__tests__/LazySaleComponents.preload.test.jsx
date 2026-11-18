// specs/plugins-phase-1-sdk.md rule 54 (reading 2026-11-18, loop t20 UI20-1) — the sale blocks' code can be started before any of them renders:
// `preloadSaleComponents()` fetches the four once for the session, and a block whose code is there renders on its first paint, never
// suspended — so a dialog that waited for `useSaleComponentsReady(open)` shows them with its own content, nothing landing under it later.
import React from 'react';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const { imported } = vi.hoisted(() => ({ imported: { stay: 0, suggested: 0, link: 0, dialog: 0 } }));
const stub = (name, key) => {
  imported[key] += 1;
  return { __esModule: true, default: (props) => <div data-testid={name}>{props.label}</div> };
};
vi.mock('../StaySalesSection', () => stub('stay-sales', 'stay'));
vi.mock('../SuggestedArticlesStep', () => stub('suggested', 'suggested'));
vi.mock('../SalePaymentLink', () => stub('payment-link', 'link'));
vi.mock('../StandaloneSaleDialog', () => stub('sale-dialog', 'dialog'));

import * as Lazy from '../LazySaleComponents';

// The order matters: the module keeps its loaded code for the whole file, as it does for the whole session.
test('an inactive consumer starts nothing; an active one starts the four imports and answers ready once they are there', async () => {
  const { result, rerender } = renderHook(({ active }) => Lazy.useSaleComponentsReady(active), { initialProps: { active: false } });
  expect(result.current).toBe(false);
  expect(imported).toEqual({ stay: 0, suggested: 0, link: 0, dialog: 0 });
  rerender({ active: true });
  await waitFor(() => expect(result.current).toBe(true));
  expect(imported).toEqual({ stay: 1, suggested: 1, link: 1, dialog: 1 });
  expect(Lazy.saleComponentsLoaded()).toBe(true);
});

test('preloading again imports nothing more, and a later consumer is ready on its first render', async () => {
  await Lazy.preloadSaleComponents();
  await Lazy.preloadSaleComponents();
  expect(imported).toEqual({ stay: 1, suggested: 1, link: 1, dialog: 1 });
  const seen = [];
  renderHook(() => { const ready = Lazy.useSaleComponentsReady(true); seen.push(ready); return ready; });
  expect(seen[0]).toBe(true);
});

test.each([
  ['LazyStaySalesSection', 'stay-sales'],
  ['LazySuggestedArticlesStep', 'suggested'],
  ['LazySalePaymentLink', 'payment-link'],
])('%s, once preloaded, is in the first paint with its props (no suspension)', (name, testId) => {
  const Component = Lazy[name];
  render(<Component label="Ligne 1" />);
  expect(screen.getByTestId(testId)).toHaveTextContent('Ligne 1');
});

test('« Vente hors séjour », once preloaded, opens on the click\'s own paint', () => {
  const { rerender } = render(<Lazy.LazyStandaloneSaleDialog open={false} label="Client 42" onClose={() => {}} onSold={() => {}} />);
  expect(screen.queryByTestId('sale-dialog')).toBeNull();
  rerender(<Lazy.LazyStandaloneSaleDialog open label="Client 42" onClose={() => {}} onSold={() => {}} />);
  expect(screen.getByTestId('sale-dialog')).toHaveTextContent('Client 42');
});
