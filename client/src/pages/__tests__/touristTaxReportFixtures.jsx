// Shared fixtures of the TouristTaxPage suites (specs/tourist-tax-report-v2.md): a report payload as
// GET /finance/tourist-tax/report sends it, built from extraction-like rows. Not a test file.
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import TouristTaxPage from '../TouristTaxPage';

/** A report row of ours, from the fields an extraction row carries (figures given, never derived). */
export function stayRow(row) {
  const added = Boolean(row.addedGuestsRow);
  const taxed = row.adults ?? 0;
  const exempt = added ? 0 : (row.children ?? 0);
  return {
    key: `${row.reservationId}${added ? '-added' : ''}`,
    propertyName: 'Gîte',
    platformLabel: 'Direct',
    remittedBy: 'us',
    addedGuestsRow: added,
    noGuestAdded: false,
    persons: taxed + exempt,
    taxedPersons: taxed,
    exemptPersons: exempt,
    taxedPersonNights: row.adultNights ?? taxed * (row.nightsCount ?? 0),
    exemptPersonNights: exempt * (row.nightsCount ?? 0),
    refundedTaxNights: 0,
    refundedTaxAmount: 0,
    touristTaxDeclaredAt: null,
    declarable: true,
    nightPricePerOccupantHt: null,
    accommodationAmount: 0,
    ...row,
  };
}

export const TOTALS = {
  staysCount: 1, rowsCount: 1, declaredRowsCount: 0, toDeclareRowsCount: 1, persons: 2, taxedPersons: 2, exemptPersons: 0,
  nights: 2, taxedPersonNights: 4, exemptPersonNights: 0, amount: 4.8, declaredAmount: 0, remainingAmount: 4.8,
  allDeclared: false, platformRemittedStaysCount: 0, platformRemittedAmount: 0,
};

export function reportOf(rows, over = {}) {
  return {
    window: { kind: 'month', from: '2026-06-01', to: '2026-06-30', toExclusive: '2026-07-01', label: 'juin 2026', month: '2026-06', coveredTo: '2026-06-30', coveredToExclusive: '2026-07-01', futureExcluded: false },
    filters: { propertyId: null, declaration: 'all' },
    today: '2026-07-05',
    currentMonth: '2026-07',
    properties: [{ id: 1, name: 'Gîte' }, { id: 2, name: 'Estiva' }],
    choices: {
      months: [{ value: '2026-07', label: 'juillet 2026' }, { value: '2026-06', label: 'juin 2026' }, { value: '2026-05', label: 'mai 2026' }],
      quarters: [{ value: '2026-Q3', label: 'T3 2026 (juil.–sept.)' }, { value: '2026-Q2', label: 'T2 2026 (avr.–juin)' }],
      years: [{ value: '2026', label: '2026' }],
      defaultMonth: '2026-06',
    },
    stays: rows.map(stayRow),
    nights: [],
    totals: TOTALS,
    columns: { percentageBase: rows.some((r) => r.nightPricePerOccupantHt != null) },
    ...over,
  };
}

export const renderTaxPage = () => render(
  <ThemeProvider theme={theme}><DialogProvider><MemoryRouter><TouristTaxPage /></MemoryRouter></DialogProvider></ThemeProvider>,
);

/** A phone (`max-width` queries match) or a desktop; `null` restores jsdom's default. */
export function setPhone(phone) {
  if (phone === null) { delete window.matchMedia; return; }
  window.matchMedia = (query) => ({
    matches: Boolean(phone) && query.includes('max-width'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}
