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
import api from '../../api';

vi.mock('../../api', () => ({ default: { getCancellationPreview: vi.fn() } }));

// The two figures are the cancellation's own (rule 60): the server answers them.
beforeEach(() => {
  api.getCancellationPreview.mockReset();
  api.getCancellationPreview.mockResolvedValue({ cancellationReason: 'unpaid_balance', retainedDepositAmount: 274, indemnityAmount: 274, writtenOffBalance: 640 });
});

const ROW = {
  reservationId: 12,
  clientName: 'Marie Dupont',
  clientEmail: 'marie@example.com',
  propertyName: 'Le Lodge',
  reservationNumber: '2026-09-004',
  startDate: '2026-09-18',
  endDate: '2026-09-25',
};

const renderDialog = (props = {}) => {
  const onConfirm = vi.fn();
  render(<ReservationCancelDialog open row={ROW} onClose={vi.fn()} onConfirm={onConfirm} {...props} />);
  return onConfirm;
};

test('rule 22 — le récapitulatif nomme le client, le séjour et le sort des deux montants', async () => {
  renderDialog();

  expect(screen.getByText(/Marie Dupont/)).toBeInTheDocument();
  expect(screen.getByText(/Du 18\/09\/2026 au 25\/09\/2026/)).toBeInTheDocument();
  expect(await screen.findByText('274,00 €')).toBeInTheDocument();
  expect(screen.getByText(/Conservé en indemnité/)).toBeInTheDocument();
  expect(screen.getByText(/Solde abandonné/)).toBeInTheDocument();
  expect(screen.getByText('640,00 €')).toBeInTheDocument();
  expect(screen.getByText(/dates seront remises à la vente/)).toBeInTheDocument();
});

test('rule 22 — rien de conservé : le dialogue le dit plutôt que d’annoncer une indemnité', async () => {
  api.getCancellationPreview.mockResolvedValue({ cancellationReason: 'unpaid_deposit', retainedDepositAmount: 0, indemnityAmount: 0, writtenOffBalance: 914 });
  renderDialog();
  expect(await screen.findByText(/Rien n’est requalifié en indemnité/)).toBeInTheDocument();
});

// La case « Prévenir le client » est cochée par défaut (rule 40 : l'avis d'annulation part quand elle
// l'est), et le motif saisi remonte tel quel — c'est lui qui sera relu dans l'historique.
test('rule 22 — confirmer remonte le motif et le choix de prévenir le client', async () => {
  const user = userEvent.setup();
  const onConfirm = renderDialog();

  await screen.findByText('274,00 €');
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
