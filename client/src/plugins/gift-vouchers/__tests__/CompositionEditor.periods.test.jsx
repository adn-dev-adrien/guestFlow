// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 8, 10-11 — the band choices show the figures of the period(s) the voucher is sold for: the server gives each band's own
// per period, a voucher sold for the weekend shows the weekend's, one sold for both shows both.
import React from 'react';
import { render, screen } from '@testing-library/react';
import CompositionEditor from '../CompositionEditor';
import { CATALOGUE } from './giftVoucherFixtures';

const withPeriods = CATALOGUE.map((element) => (element.kind === 'resource' ? {
  ...element,
  modes: element.modes.map((mode) => ({
    ...mode,
    byPeriod: {
      week: { rateCents: 5000, followingRateCents: 3000, followingText: 'puis 30 €/h', sellable: true },
      weekend: { rateCents: 7000, followingRateCents: 4000, followingText: 'puis 40 €/h', sellable: true },
    },
  })),
} : element));
const value = { resourceId: 1, band: 'day', minutes: 60, options: [] };
const show = (periods) => render(<CompositionEditor value={value} elements={withPeriods} onChange={() => {}} periods={periods} />);

test('a voucher sold for the weekend shows the weekend figures of the band', () => {
  show(['weekend']);
  expect(screen.getByText(/Extérieur · journée · 70,00.€.\/ h/)).toBeInTheDocument();
  expect(screen.getAllByText('puis 40 €/h').length).toBe(2);
  expect(screen.queryByText(/50,00/)).not.toBeInTheDocument();
});

test('a voucher sold for the week shows the week figures', () => {
  show(['week']);
  expect(screen.getByText(/Extérieur · journée · 50,00.€.\/ h/)).toBeInTheDocument();
  expect(screen.getAllByText('puis 30 €/h').length).toBe(2);
});

test('a voucher sold for both periods shows one line per period under the band', () => {
  show(['week', 'weekend']);
  expect(screen.getAllByText(/^Semaine : 50,00.€.\/ h puis 30 €\/h$/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/^Week-end : 70,00.€.\/ h puis 40 €\/h$/).length).toBeGreaterThan(0);
});
