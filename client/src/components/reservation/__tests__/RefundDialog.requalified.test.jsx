import React from 'react';
import { render, screen } from '@testing-library/react';
import RefundDialog from '../RefundDialog';
import { vi } from 'vitest';

// specs/reservation-refunds.md rule 46 — l'argent qu'une annulation a requalifié en indemnité n'a jamais été
// rendu : la ligne l'annonce « requalifié », pas « déjà remboursé ».

const LINES = [
  { key: 'opt:1', label: 'Dîner', bucket: 'options', quantity: 2, unitPrice: 110, billedTtc: 220, refundedTtc: 0, requalifiedTtc: 146.67, refundableTtc: 73.33, vatRate: 10 },
  { key: 'opt:2', label: 'Panier', bucket: 'options', quantity: 1, unitPrice: 110, billedTtc: 110, refundedTtc: 20, requalifiedTtc: 53.33, refundableTtc: 36.67, vatRate: 10 },
  { key: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, billedTtc: 660, refundedTtc: 0, requalifiedTtc: 0, refundableTtc: 660, vatRate: 10 },
];

function renderDialog() {
  render(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={668} onSubmit={vi.fn()} />);
}

test('une ligne requalifiée par l’annulation le dit, sans « déjà remboursé »', () => {
  renderDialog();
  expect(screen.getByText('Facturé 220,00 € · requalifié 146,67 €')).toBeInTheDocument();
});

test('une ligne en partie rendue puis requalifiée distingue les deux montants', () => {
  renderDialog();
  expect(screen.getByText('Facturé 110,00 € · déjà remboursé 20,00 € · requalifié 53,33 €')).toBeInTheDocument();
});

test('une ligne sans requalification garde son libellé', () => {
  renderDialog();
  expect(screen.getByText('Facturé 660,00 €')).toBeInTheDocument();
});
