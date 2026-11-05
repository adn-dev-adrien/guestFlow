// specs/reservations-backend-mvc.md rule 15 (audit R22, 2026-11-04) — the party is whole and ≥ 0: the fiche says so
// as it is typed, under the field; only the server refuses.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import GuestsBedsSection from '../GuestsBedsSection';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

const HINT = 'Un nombre entier, 0 ou plus.';

function renderParty(party) {
  const base = makeMockContext();
  render(
    <ReservationFormProvider value={{ ...base, form: { ...base.form, adults: 2, children: 0, teens: 0, babies: 0, ...party } }}>
      <GuestsBedsSection />
    </ReservationFormProvider>,
  );
}

test.each([
  ['Adultes', 'adults', -3],
  ['Adultes', 'adults', 1.5],
  ['Enfants', 'children', -1],
  ['Ados', 'teens', 0.5],
  ['Bébés', 'babies', -1],
])('rule 15 — %s at %s = %s shows the hint in place of its helper, in error', (label, field, value) => {
  renderParty({ [field]: value });
  expect(screen.getByText(HINT)).toBeTruthy();
  expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true');
});

test('rule 15 — whole numbers keep their helpers, and adults 0 is not refused', () => {
  renderParty({ adults: 0, children: 1, teens: 2, babies: 0 });
  expect(screen.queryByText(HINT)).toBeNull();
  expect(screen.getByText('18 ans et plus')).toBeTruthy();
  expect(screen.getByLabelText('Adultes').getAttribute('aria-invalid')).toBe('false');
});
