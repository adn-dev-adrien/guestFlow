import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import ReconciliationLine from '../ReconciliationLine';
import { proposed, done, bankSide } from './reconciliationFixtures';

// specs/reconciliation-assisted-matching.md rules 15, 18, 19, 21 — a proposal over several credits, a group
// whose shares are typed, the « auto » badge and the stays a confirmed credit also covered.

const handlers = () => ({ onConfirm: vi.fn(), onDiscard: vi.fn(), onUndo: vi.fn(), onShares: vi.fn() });

test('rule 15 — a proposal over several credits lists each transfer and its reason', () => {
  const item = proposed();
  item.proposal = {
    ...item.proposal, reason: '2 virements du client',
    parts: [{ ...bankSide({ transactionId: 'a', dateLabel: '10/10', amountCents: 15000 }) }, { ...bankSide({ transactionId: 'b', dateLabel: '12/10', amountCents: 15000 }) }],
  };
  render(<ReconciliationLine item={item} {...handlers()} />);
  expect(screen.getByText('Proposé · 10/10')).toBeTruthy();
  expect(screen.getByText('Proposé · 12/10')).toBeTruthy();
  expect(screen.getByText(/2 virements du client/)).toBeTruthy();
});

test('rules 18–19 — a group whose shares are typed offers « Répartir et confirmer », and names the other stays', () => {
  const item = proposed();
  item.proposal = {
    ...item.proposal, needsShares: true, confidence: 'verifier', confidenceLabel: 'à vérifier',
    alsoCovers: [{ reservationId: 8, ledgerKey: 'balance', label: 'Versement Booking', clientName: 'Camille Lefevre' }],
  };
  const h = handlers();
  render(<ReconciliationLine item={item} {...h} />);
  expect(screen.getByText(/couvre aussi Camille Lefevre \(Versement Booking\)/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Répartir et confirmer' }));
  expect(h.onShares).toHaveBeenCalledWith(item);
  expect(h.onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Confirmer' })).toBeNull();
});

test('rule 21 — a line confirmed automatically carries the « auto » badge; a manual one does not', () => {
  const auto = done({ bank: [{ ...bankSide(), allocatedCents: 59658, auto: true, alsoCovers: [] }] });
  const { unmount } = render(<ReconciliationLine item={auto} {...handlers()} />);
  expect(screen.getByText('auto')).toBeTruthy();
  unmount();
  render(<ReconciliationLine item={done()} {...handlers()} />);
  expect(screen.queryByText('auto')).toBeNull();
});

test('rule 19 — a confirmed group says which other stays the credit covered', () => {
  const item = done({ bank: [{ ...bankSide(), allocatedCents: 40000, auto: false, alsoCovers: [{ reservationId: 8, ledgerKey: 'balance', label: 'Versement Booking', clientName: 'Camille Lefevre' }] }] });
  render(<ReconciliationLine item={item} {...handlers()} />);
  expect(screen.getByText(/couvre aussi Camille Lefevre/)).toBeTruthy();
});
