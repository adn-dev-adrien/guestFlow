import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import BulkConfirmDialog from '../BulkConfirmDialog';

// specs/reconciliation-assisted-matching.md rules 12–13 — « Tout confirmer » states what it writes from the
// server's summary; the « à vérifier » checkbox only switches between two server-computed sets.

const BULK = {
  proposalIds: ['a', 'b'], count: 2, totalCents: 75050, amounts: { a: 30000, b: 45050 },
  toVerify: { proposalIds: ['c'], count: 1, totalCents: 12500, amounts: { c: 12500 } },
};
const renderDialog = (props = {}) => render(<BulkConfirmDialog open onClose={vi.fn()} bulk={BULK} onConfirm={vi.fn()} {...props} />);

test('rule 12 — count and total come from the summary, with the sentence about what is written', () => {
  renderDialog();
  expect(screen.getByText(/2 rapprochements · 750,50 €/)).toBeTruthy();
  expect(screen.getByText('Les fiches seront marquées reçues à la date du virement.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirmer 2' })).toBeTruthy();
});

test('rule 12 — « à vérifier » is excluded by default and counted on a checkbox', () => {
  renderDialog();
  expect(screen.getByLabelText('Inclure aussi les 1 à vérifier (125,00 €)').checked).toBe(false);
});

test('rule 12 — ticking the checkbox adds the second set to the count and the total', () => {
  renderDialog();
  fireEvent.click(screen.getByLabelText(/Inclure aussi/));
  expect(screen.getByText(/3 rapprochements · 875,50 €/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirmer 3' })).toBeTruthy();
});

test('rule 13 — confirming sends the ids shown and their amounts', () => {
  const onConfirm = vi.fn();
  renderDialog({ onConfirm });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer 2' }));
  expect(onConfirm).toHaveBeenCalledWith({ proposalIds: ['a', 'b'], amounts: { a: 30000, b: 45050 } });
  fireEvent.click(screen.getByLabelText(/Inclure aussi/));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer 3' }));
  expect(onConfirm).toHaveBeenLastCalledWith({ proposalIds: ['a', 'b', 'c'], amounts: { a: 30000, b: 45050, c: 12500 } });
});

test('rule 12 — nothing to confirm: the button is disabled and no checkbox is offered', () => {
  renderDialog({ bulk: { ...BULK, proposalIds: [], count: 0, totalCents: 0, amounts: {}, toVerify: { proposalIds: [], count: 0, totalCents: 0, amounts: {} } } });
  expect(screen.getByRole('button', { name: 'Confirmer 0' }).disabled).toBe(true);
  expect(screen.queryByLabelText(/Inclure aussi/)).toBeNull();
});
