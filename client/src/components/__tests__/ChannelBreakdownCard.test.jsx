/**
 * ChannelBreakdownCard — « Canaux de réservation » on the Finance page.
 * specs/site-traffic-analytics.md rules 21-23: the card renders the server payload as is.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import ChannelBreakdownCard from '../ChannelBreakdownCard';

const BREAKDOWN = {
  site: {
    rows: [
      { key: 'site:social', group: 'site', label: 'Réseaux sociaux', reservations: 2, nights: 5, revenue: 980, revenueHt: 890.91, requests: 6, converted: 2, conversionRate: 33.3 },
      { key: 'site:search', group: 'site', label: 'Recherche', reservations: 0, nights: 0, revenue: 0, revenueHt: 0, requests: 1, converted: 0, conversionRate: 0 },
    ],
    subtotal: { reservations: 2, nights: 5, revenue: 980, revenueHt: 890.91, requests: 7, converted: 2, conversionRate: 28.6 },
  },
  others: [
    { key: 'platform:airbnb', group: 'platform', label: 'Airbnb', reservations: 6, nights: 17, revenue: 3120, revenueHt: 2836.36 },
    { key: 'direct', group: 'direct', label: 'Direct (saisie)', reservations: 1, nights: 4, revenue: 700, revenueHt: 636.36 },
  ],
  total: { reservations: 9, nights: 26, revenue: 4800, revenueHt: 4363.63 },
};

test('the table groups the website rows under their own header, with the server subtotal and total', () => {
  render(<ChannelBreakdownCard breakdown={BREAKDOWN} caption="Période du 01/09 au 30/09" />);
  const table = screen.getByRole('table');
  expect(within(table).getByText('Site internet')).toBeInTheDocument();
  const social = within(table).getByText('Réseaux sociaux').closest('tr');
  expect(social).toHaveTextContent('33,3 %');
  expect(within(table).getByText('Sous-total site').closest('tr')).toHaveTextContent('28,6 %');
  // A platform has no website requests: its request and conversion cells read « — ».
  expect(within(table).getByText('Airbnb').closest('tr')).toHaveTextContent('—');
  expect(within(table).getByText('Total').closest('tr')).toHaveTextContent(/4\s?800/);
});

test('the phone cards prefix the website rows with « Site · »', () => {
  render(<ChannelBreakdownCard breakdown={BREAKDOWN} caption="" />);
  expect(screen.getByText('Site · Réseaux sociaux')).toBeInTheDocument();
  expect(screen.getByText(/6 demandes · 33,3 % convertis/)).toBeInTheDocument();
});

test('an empty window shows the empty state', () => {
  render(<ChannelBreakdownCard breakdown={{ site: { rows: [], subtotal: {} }, others: [], total: {} }} caption="" />);
  expect(screen.getByText('Aucune réservation sur la période.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});
