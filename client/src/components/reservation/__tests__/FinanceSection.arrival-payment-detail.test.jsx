import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';
import api from '../../../api';

// specs/arrival-payment-detail-and-adjustment.md §3.1-§3.2 — le paiement unique, détaillé, et son
// ajustement. La fiche ne décide rien : elle imprime les lignes que le serveur envoie et lui transmet
// le montant saisi. La réduction et le pourboire sont dérivés et bornés côté serveur.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    markPayment: vi.fn(),
    settleArrivalPayment: vi.fn().mockResolvedValue({}),
    adjustArrivalPayment: vi.fn().mockResolvedValue({}),
  },
}));

function renderFinance(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <DialogProvider>
      <ReservationFormProvider value={ctx}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  return ctx;
}

const COVERS = [
  { bucket: 'balance', label: 'solde', amount: 720.82 },
  { bucket: 'complement', label: 'complément', amount: 132 },
];

const DETAILED = {
  at: '2026-08-30',
  total: 852.82,
  bucketsTotal: 852.82,
  accommodation: 700,
  floor: 152.82,
  reduction: 0,
  tip: 0,
  cash: false,
  means: 'CB / Chèque',
  covers: COVERS,
  lines: [
    { kind: 'accommodation', label: 'Hébergement — 3 nuits', qty: 1, unitPrice: 700, amount: 700 },
    { kind: 'option', label: 'Linge de lit', qty: 2, unitPrice: 12, amount: 24 },
    { kind: 'option', label: 'Repas des trappeurs', qty: 2, unitPrice: 25, amount: 50 },
    { kind: 'option', label: 'Petit-déjeuner', qty: 2, unitPrice: 9, amount: 0, offered: 1, originalAmount: 18 },
    { kind: 'tax', label: 'Taxe de séjour', qty: 1, unitPrice: 78.82, amount: 78.82 },
  ],
};

const render7 = (payment) => renderFinance({
  editingReservationId: 7, reservationId: 7, form: { arrivalPayment: payment },
});

beforeEach(() => { vi.clearAllMocks(); });

// specs/arrival-payment-detail-and-adjustment.md rules 1 + 5 — le bloc imprime les lignes que le
// serveur envoie, dans son ordre, sans rien calculer.
test('the block lists the prestations the payment covered, then its total', () => {
  render7(DETAILED);
  expect(screen.getByText('Hébergement — 3 nuits')).toBeInTheDocument();
  // Quantité et prix unitaire sont dits dans le libellé, comme dans le récap du SAS.
  expect(screen.getByText(/Repas des trappeurs · 2 × 25,00/)).toBeInTheDocument();
  expect(screen.getByText('Taxe de séjour')).toBeInTheDocument();
  expect(screen.getAllByText('Total encaissé').length).toBeGreaterThan(0);
  // La légende par seau laisse la place au détail.
  expect(screen.queryByText(/solde 720,82 € · complément 132,00 €/)).toBeNull();
});

test('an offered line stays visible at 0 € with its original amount struck', () => {
  render7(DETAILED);
  const line = screen.getByText(/Petit-déjeuner · 2 × 9,00/).closest('div');
  expect(within(line).getByText('18,00 €')).toBeInTheDocument();
  expect(within(line).getByText(/0,00 €/)).toBeInTheDocument();
});

// specs/arrival-payment-detail-and-adjustment.md rule 8
test('without lines (a payment whose attribution was never captured) the bucket caption is kept', () => {
  render7({ ...DETAILED, lines: [] });
  expect(screen.getByText(/solde 720,82 € · complément 132,00 €/)).toBeInTheDocument();
});

// specs/arrival-payment-detail-and-adjustment.md rule 10
test('a réduction shows as its own line, and the total is what was handed over', () => {
  render7({ ...DETAILED, total: 800, reduction: 52.82 });
  expect(screen.getByText('Réduction accordée')).toBeInTheDocument();
  expect(screen.getByText('− 52,82 €')).toBeInTheDocument();
  expect(screen.getByText(/paiement unique de 800,00 €/)).toBeInTheDocument();
});

// specs/arrival-payment-detail-and-adjustment.md rule 12
test('a pourboire shows as its own line', () => {
  render7({ ...DETAILED, total: 900, tip: 47.18 });
  expect(screen.getByText('Pourboire')).toBeInTheDocument();
  expect(screen.getByText('+ 47,18 €')).toBeInTheDocument();
});

// specs/arrival-payment-detail-and-adjustment.md rule 9
test('the field posts the amount the operator typed', async () => {
  const user = userEvent.setup();
  render7(DETAILED);
  const field = screen.getByLabelText('Total encaissé');
  await user.clear(field);
  await user.type(field, '800');
  await user.tab();
  expect(api.adjustArrivalPayment).toHaveBeenCalledWith(7, 800);
});

// specs/arrival-payment-detail-and-adjustment.md rule 15
test('clearing the field restores the computed total', async () => {
  const user = userEvent.setup();
  render7({ ...DETAILED, total: 800, reduction: 52.82 });
  const field = screen.getByLabelText('Total encaissé');
  await user.clear(field);
  await user.tab();
  expect(api.adjustArrivalPayment).toHaveBeenCalledWith(7, null);
});

test('the helper says the computed total when nothing is adjusted', () => {
  render7(DETAILED);
  expect(screen.getByText('Calcul auto (852,82 €)')).toBeInTheDocument();
});

// specs/arrival-payment-detail-and-adjustment.md rule 11
test('at the floor, the helper names the accommodation as the limit', () => {
  // L'opérateur a demandé moins que l'hébergement ne le permet : le serveur a remonté au plancher, et
  // le champ doit dire pourquoi plutôt que de laisser croire que la saisie a été ignorée.
  render7({ ...DETAILED, total: 152.82, reduction: 700 });
  expect(screen.getByText(/Réduction maximale 700,00 €/)).toBeInTheDocument();
});

// specs/arrival-payment-detail-and-adjustment.md rule 4 — le bloc est une LECTURE des seaux, jamais
// un remplacement : les contrôles par échéance restent là, intacts, sous lui.
test('les contrôles par échéance restent affichés sous le bloc', () => {
  render7(DETAILED);
  expect(screen.getByRole('button', { name: /solde payé/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Annuler ce paiement' })).toBeInTheDocument();
});

// specs/arrival-payment-detail-and-adjustment.md rule 13 — pas de groupe, pas de bloc, pas de champ.
// Ajuster un séjour encaissé en deux échéances est une autre question, hors périmètre.
test('sans paiement unique, ni le bloc ni le champ n’existent', () => {
  renderFinance({ editingReservationId: 7, reservationId: 7, form: { arrivalPayment: null } });
  expect(screen.queryByText(/paiement unique de/)).toBeNull();
  expect(screen.queryByLabelText('Total encaissé')).toBeNull();
});
