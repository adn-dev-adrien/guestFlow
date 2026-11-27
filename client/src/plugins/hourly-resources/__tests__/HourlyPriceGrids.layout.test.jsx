// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 1 and the validated mock — « Heure offerte par logement » sits right under the « Clients logés » grid, « Clients logés »
// and « Prix pour les extérieurs » are headings of the same level with « Semaine » / « Week-end » below the second, the week-end line does not name a Friday evening a resource without
// evening switch has none of, and on a phone every price field has its own caption (its row, its refusal sentence the full width).
import React from 'react';
import { render, screen } from '@testing-library/react';

import HourlyPriceGrids from '../HourlyPriceGrids';

const DRAFT = {
  priceType: 'per_hour', price: '50', showsPlanningCard: true, hourlyEveningStart: '20:00', sellableExternally: true,
  hourlyEveningRate: '60', hourlyNextDayRate: '40', hourlyNextEveningRate: '50',
  hourlyExternalDayRate: '50', hourlyExternalNextDayRate: '45', hourlyExternalEveningRate: '70', hourlyExternalNextEveningRate: '65',
  hourlyExternalWeekendDayRate: '70', hourlyExternalWeekendNextDayRate: '60', hourlyExternalWeekendEveningRate: '90', hourlyExternalWeekendNextEveningRate: '80',
};
const show = (draft = DRAFT, lodgingLines = <div data-testid="lodging">Heure offerte par logement</div>) => render(<HourlyPriceGrids draft={draft} onChange={() => {}} lodgingLines={lodgingLines} />);

test('the offered hour per lodging is drawn between the guests\' grid and the outside grid', () => {
  show();
  const lodging = screen.getByTestId('lodging');
  const guests = screen.getByRole('heading', { name: 'Clients logés' });
  const outside = screen.getByRole('heading', { name: 'Prix pour les extérieurs' });
  expect(guests.compareDocumentPosition(lodging) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(lodging.compareDocumentPosition(outside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('« Clients logés » and « Prix pour les extérieurs » are headings of the same level; « Semaine » and « Week-end » are the groups below the second', () => {
  show();
  const levels = ['Clients logés', 'Prix pour les extérieurs'].map((name) => screen.getByRole('heading', { name }).tagName);
  expect(new Set(levels).size).toBe(1);
  expect(screen.getByRole('group', { name: 'Extérieurs · Semaine' })).toHaveTextContent('Semaine');
  expect(screen.getByRole('group', { name: 'Extérieurs · Week-end' })).toHaveTextContent('Week-end');
});

test('the week-end line names the Friday evening only when the resource has an evening switch', () => {
  const { unmount } = show();
  expect(screen.getByText('Week-end : du vendredi 20:00 au dimanche soir, et les jours fériés.')).toBeInTheDocument();
  unmount();
  show({ ...DRAFT, hourlyEveningStart: '' });
  expect(screen.getByText('Week-end : le samedi, le dimanche et les jours fériés.')).toBeInTheDocument();
  expect(screen.queryByText(/vendredi/)).not.toBeInTheDocument();
});

test('every price field carries its own column caption (shown on a phone, where the fields stack one per row)', () => {
  show({ ...DRAFT, sellableExternally: false, hourlyEveningStart: '' });
  expect(screen.getAllByText('1re heure')).toHaveLength(2);
  expect(screen.getAllByText('Heures suivantes')).toHaveLength(2);
});
