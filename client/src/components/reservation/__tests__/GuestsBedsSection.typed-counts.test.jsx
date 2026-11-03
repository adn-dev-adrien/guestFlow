// specs/non-card-option-served-persons.md rule 21 — the operator is told at once, where the party changes.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import GuestsBedsSection from '../GuestsBedsSection';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

function renderSection(pricingQuote) {
  render(
    <ReservationFormProvider value={makeMockContext({ pricingQuote })}>
      <GuestsBedsSection />
    </ReservationFormProvider>,
  );
}

test('rule 21 — the alert names each flagged option once', () => {
  renderSection({
    typedCountAlerts: [
      { optionId: 1, title: 'Serviettes', kind: 'persons' },
      { optionId: 2, title: 'Panier', kind: 'persons' },
      { optionId: 2, title: 'Panier', kind: 'nights' },
    ],
  });
  expect(screen.getByRole('alert').textContent).toContain('Valeur saisie à vérifier : Serviettes, Panier');
});

test('rule 21 — nothing flagged, no alert', () => {
  renderSection({ typedCountAlerts: [] });
  expect(screen.queryByText(/Valeur saisie à vérifier/)).toBeNull();
});
