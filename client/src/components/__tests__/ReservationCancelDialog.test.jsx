// specs/payment-schedule-and-cancellation.md §3.5 rule 22 — ce que le dialogue de confirmation dit
// avant qu'un séjour ne soit annulé.
//
// Pourquoi ce fichier existe : c'est le dernier écran avant un geste irréversible qui touche à
// l'argent — l'acompte encaissé est conservé, le solde est abandonné, les dates repartent à la vente
// — et rien n'en vérifiait le contenu. Un récapitulatif qui tait l'un des trois transformerait une
// décision en surprise.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import ReservationCancelDialog from '../ReservationCancelDialog';

const ROW = {
  clientName: 'Marie Dupont',
  clientEmail: 'marie@example.com',
  propertyName: 'Le Lodge',
  reservationNumber: '2026-09-004',
  startDate: '2026-09-18',
  endDate: '2026-09-25',
  retainedDepositAmount: 274,
  balanceDue: 640,
};

const renderDialog = (props = {}) => {
  const onConfirm = vi.fn();
  render(<ReservationCancelDialog open row={ROW} onClose={vi.fn()} onConfirm={onConfirm} {...props} />);
  return onConfirm;
};

test('rule 22 — le récapitulatif nomme le client, le séjour et le sort des deux montants', () => {
  renderDialog();

  expect(screen.getByText(/Marie Dupont/)).toBeInTheDocument();
  expect(screen.getByText(/Du 18\/09\/2026 au 25\/09\/2026/)).toBeInTheDocument();
  expect(screen.getByText(/Acompte conservé/)).toBeInTheDocument();
  expect(screen.getByText('274,00 €')).toBeInTheDocument();
  expect(screen.getByText(/Solde abandonné/)).toBeInTheDocument();
  expect(screen.getByText('640,00 €')).toBeInTheDocument();
  expect(screen.getByText(/dates seront remises à la vente/)).toBeInTheDocument();
});

test('rule 22 — sans acompte encaissé, le dialogue le dit plutôt que d’annoncer une indemnité', () => {
  renderDialog({ row: { ...ROW, retainedDepositAmount: 0 } });
  expect(screen.getByText(/Aucun acompte n’a été encaissé/)).toBeInTheDocument();
});

// La case « Prévenir le client » est cochée par défaut (rule 40 : l'avis d'annulation part quand elle
// l'est), et le motif saisi remonte tel quel — c'est lui qui sera relu dans l'historique.
test('rule 22 — confirmer remonte le motif et le choix de prévenir le client', async () => {
  const user = userEvent.setup();
  const onConfirm = renderDialog();

  await user.type(screen.getByLabelText('Motif'), 'Solde jamais réglé');
  await user.click(screen.getByRole('button', { name: 'Annuler le séjour' }));

  expect(onConfirm).toHaveBeenCalledWith({ reason: 'Solde jamais réglé', notifyClient: true });
});

test('rule 22 — sans adresse email, prévenir le client n’est pas proposé', () => {
  renderDialog({ row: { ...ROW, clientEmail: null } });
  const box = screen.getByRole('checkbox');
  expect(box).toBeDisabled();
  expect(box).not.toBeChecked();
  expect(screen.getByText(/aucune adresse enregistrée/)).toBeInTheDocument();
});
