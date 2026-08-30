/**
 * Shared fixtures for the ReservationSasDialog suites.
 *
 * The check-in / check-out wizard is covered by ONE FILE PER SUBJECT
 * (`ReservationSasDialog.<subject>.test.jsx`), mirroring the server, where every spec owns its own
 * `tests/sas-*.unit.test.js` — see CLAUDE.md §9. The reason is mechanical rather than aesthetic: when
 * every feature appends its cases to the end of a single suite, two branches conflict on the last
 * line of the file even though their tests are unrelated (that is exactly what happened between
 * `collect-stay-payment-at-check-in` and `sas-catering-card-option-switch` on 2026-08-30). It is the
 * same reasoning that gave `changelog.d/` its one-file-per-change layout.
 *
 * What belongs here: what more than one subject needs. A fixture used by a single suite stays in that
 * suite, next to the tests that read it.
 *
 * `vi.mock('../../../api')` is NOT here on purpose: the call is hoisted per test file by Vitest, so
 * each suite declares it (the mock still reaches the component rendered through `renderDialog`,
 * because both resolve the same module path).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';

import theme from '../../../theme';
import DialogProvider from '../../DialogProvider';
import ReservationSasDialog from '../ReservationSasDialog';

const BASE_RES = {
  id: 1, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Tente', platform: 'direct',
  startDate: '2026-07-10', endDate: '2026-07-12', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 1, teens: 0, children: 0, babies: 0, doubleBeds: 0, singleBeds: 0, babyBeds: 0,
  options: [], resources: [], complementAmount: 0, complementPaid: 0,
  cautionAmount: 500, cautionReceived: 0, cautionReturned: 0,
};

export function sasPayload(over = {}) {
  return {
    reservation: { ...BASE_RES, ...(over.reservation || {}) },
    portalCode: over.portalCode || '',
    cleaning: over.cleaning || { included: false, price: 80 },
    bathLinen: over.bathLinen || { available: false, unitPrice: 0, priceType: null, persons: 0, nights: 0, amount: 0, label: 'Linge de toilette' },
    linenItems: over.linenItems || [{ id: 1, label: 'Taie d\'oreiller', price: 5, category: 'bed' }],
    repairAmounts: over.repairAmounts || [],
    breakfast: over.breakfast, // undefined → breakfast page hidden
    arrivalComplement: over.arrivalComplement, // undefined → no recall at departure
    // specs/sas-breakfast-and-catering-upsell.md — sale steps; nothing on offer by default.
    sasSales: over.sasSales || { persons: 0, nights: 0, breakfast: { available: false }, catering: { available: false, options: [] } },
    // specs/collect-stay-payment-at-check-in.md — nothing owed on the stay by default (the ordinary
    // prepaid case), so the « Séjour à régler » step is absent from every pre-existing flow.
    stayPayment: over.stayPayment || { applicable: false },
  };
}

// A last-minute stay: no acompte, the whole pre-arrival total in the solde, nothing collected yet.
export const stayDue = (over = {}) => ({
  applicable: true,
  total: 480,
  deposit: { amount: 0, applicable: false, settled: false, due: 0, owned: false, collectible: 0 },
  balance: { amount: 480, applicable: true, settled: false, due: 480, owned: false, collectible: 480 },
  channel: 'direct',
  platformLabel: 'Direct',
  paid: false,
  paidCash: false,
  ...over,
});

// A 2-night stay (10 → 12 July) for 2 persons: 2 candidate mornings at 8 €/pers.
export const BREAKFAST_OFFER = {
  available: true, optionId: 6, title: 'Petit déjeuner', description: '', unitPrice: 8,
  priceType: 'per_person_per_night', perPerson: true, showsPlanningCard: true, persons: 2,
  multiplier: 4, defaultUnits: 4, sasOrigin: false, selectedUnits: 0, selectedOccurrences: [], selected: [],
  occurrences: [{ date: '2026-07-11', time: '09:00', slot: 0 }, { date: '2026-07-12', time: '09:00', slot: 0 }],
  mornings: [{ date: '2026-07-11', time: '09:00', slot: 0 }, { date: '2026-07-12', time: '09:00', slot: 0 }],
  // specs/card-option-served-persons.md — the party, the ceiling (property capacity) and the
  // per-person composition rule the wizard multiplies by the breakfasts actually sold.
  defaultPersons: 2, maxPersons: 5, selectedPersons: 2,
  compositionPerPerson: { coffee: 0, tea: 0, chocolate: 0, milk: 0, pastries: 1, cereals: 0, bread: 0.5 },
};
export const MEAL_OFFER = {
  optionId: 16, title: 'Le repas des trappeurs', description: 'Repas', unitPrice: 25,
  priceType: 'per_person_per_night', perPerson: true, showsPlanningCard: true, persons: 2,
  multiplier: 4, defaultUnits: 4, sasOrigin: false, selectedUnits: 0, selectedOccurrences: [],
  occurrences: [{ date: '2026-07-11', time: '19:30', slot: 0 }, { date: '2026-07-12', time: '19:30', slot: 0 }],
  defaultPersons: 2, maxPersons: 5, selectedPersons: 2,
};
export const BOARD_OFFER = {
  optionId: 27, title: 'Planche S', description: 'Apéro', unitPrice: 17, priceType: 'per_stay',
  perPerson: false, showsPlanningCard: false, persons: 2, multiplier: 1, defaultUnits: 1,
  sasOrigin: false, selectedUnits: 0, selectedOccurrences: [], occurrences: [],
  defaultPersons: 2, maxPersons: 5, selectedPersons: 2,
};
export const salesPayload = (over = {}) => ({
  persons: 2, nights: 2,
  breakfast: over.breakfast || { available: false },
  catering: over.catering || { available: false, options: [] },
});

export function renderDialog(props) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <ReservationSasDialog open reservationId={1} onClose={() => {}} onCommitted={() => {}} {...props} />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

export const clickBtn = (name) => fireEvent.click(screen.getByRole('button', { name }));
