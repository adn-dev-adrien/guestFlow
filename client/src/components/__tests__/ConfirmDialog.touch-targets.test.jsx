// specs/reservation-fiche-concurrency.md rule 5 + CLAUDE.md responsive rules — every action of the shared
// confirm dialog is a touch target of at least 44 px, with two or three actions.
import React from 'react';
import { render, screen } from '@testing-library/react';
import ConfirmDialog from '../ConfirmDialog';

const heightOf = (name) => parseFloat(getComputedStyle(screen.getByRole('button', { name })).minHeight);

test('rule 5: the two actions are at least 44 px tall', () => {
  render(<ConfirmDialog open title="T" message="M" confirmLabel="Valider" cancelLabel="Annuler" onClose={() => {}} onConfirm={() => {}} />);
  expect(heightOf('Valider')).toBeGreaterThanOrEqual(44);
  expect(heightOf('Annuler')).toBeGreaterThanOrEqual(44);
});

test('rule 5: the third action is at least 44 px tall too', () => {
  render(<ConfirmDialog open title="T" message="M" secondaryLabel="Enregistrer quand même" onSecondary={() => {}} onClose={() => {}} onConfirm={() => {}} />);
  expect(heightOf('Enregistrer quand même')).toBeGreaterThanOrEqual(44);
});
