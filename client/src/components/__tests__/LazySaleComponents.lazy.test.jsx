// specs/inte-performance.md rule 4 (loop t19 A19-1) — the SDK hands the four sale blocks out lazily: its exports are the
// lazy wrappers, each renders the real component with its props once its code arrived, and « Vente hors séjour » is not
// even fetched while it has never been opened (then it stays mounted after closing, so the closing transition can
// play). The bundle budget step of CI is the weight proof.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const { loaded } = vi.hoisted(() => ({ loaded: vi.fn() }));
const stub = (name) => ({ __esModule: true, default: (props) => <div data-testid={name} data-open={String(Boolean(props.open))}>{props.label}</div> });
vi.mock('../StaySalesSection', () => stub('stay-sales'));
vi.mock('../SuggestedArticlesStep', () => stub('suggested'));
vi.mock('../SalePaymentLink', () => stub('payment-link'));
vi.mock('../StandaloneSaleDialog', () => { loaded(); return stub('sale-dialog'); });

import * as Lazy from '../LazySaleComponents';
import * as sdk from '../../plugins/sdk';

test('the SDK exports are the lazy wrappers', () => {
  expect(sdk.StaySalesSection).toBe(Lazy.LazyStaySalesSection);
  expect(sdk.SuggestedArticlesStep).toBe(Lazy.LazySuggestedArticlesStep);
  expect(sdk.SalePaymentLink).toBe(Lazy.LazySalePaymentLink);
  expect(sdk.StandaloneSaleDialog).toBe(Lazy.LazyStandaloneSaleDialog);
});

test.each([
  ['LazyStaySalesSection', 'stay-sales'],
  ['LazySuggestedArticlesStep', 'suggested'],
  ['LazySalePaymentLink', 'payment-link'],
])('%s renders the real component with its props', async (name, testId) => {
  const Component = Lazy[name];
  render(<Component label="Ligne 1" />);
  expect(await screen.findByTestId(testId)).toHaveTextContent('Ligne 1');
});

test('« Vente hors séjour » never opened: nothing rendered, its code not loaded', () => {
  render(<Lazy.LazyStandaloneSaleDialog open={false} onClose={() => {}} onSold={() => {}} />);
  expect(screen.queryByTestId('sale-dialog')).toBeNull();
  expect(loaded).not.toHaveBeenCalled();
});

test('« Vente hors séjour » opened: the real dialog with its props, still mounted once closed', async () => {
  const { rerender } = render(<Lazy.LazyStandaloneSaleDialog open={false} label="Client 42" onClose={() => {}} onSold={() => {}} />);
  rerender(<Lazy.LazyStandaloneSaleDialog open label="Client 42" onClose={() => {}} onSold={() => {}} />);
  const dialog = await screen.findByTestId('sale-dialog');
  expect(dialog).toHaveTextContent('Client 42');
  expect(dialog).toHaveAttribute('data-open', 'true');
  rerender(<Lazy.LazyStandaloneSaleDialog open={false} label="Client 42" onClose={() => {}} onSold={() => {}} />);
  expect(screen.getByTestId('sale-dialog')).toHaveAttribute('data-open', 'false');
});
