import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';
import api from '../../../api';

// specs/single-payment-from-the-fiche.md — recording the single arrival payment WITHOUT re-opening
// the SAS. The fiche decides nothing about the money: it renders what the server says is collectible
// and posts a mode plus the date the operator chose.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { markPayment: vi.fn(), settleArrivalPayment: vi.fn().mockResolvedValue({}) },
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

const COLLECTIBLE = {
  collectible: {
    total: 852.82,
    buckets: [
      { bucket: 'balance', label: 'solde', amount: 720.82 },
      { bucket: 'complement', label: 'complément', amount: 132 },
    ],
    bookedAt: '2026-08-01',
  },
};

const GROUP = {
  at: '2026-08-30', total: 852.82, cash: false, means: 'CB / Chèque',
  covers: [
    { bucket: 'balance', label: 'solde', amount: 720.82 },
    { bucket: 'complement', label: 'complément', amount: 132 },
  ],
};

beforeEach(() => { vi.clearAllMocks(); });

test('two collectible buckets → the control announces the total and what it covers', () => {
  renderFinance({ editingReservationId: 7, reservationId: 7, form: { arrivalPayment: COLLECTIBLE } });
  expect(screen.getByText(/Encaisser en une fois : 852,82 €/)).toBeInTheDocument();
  expect(screen.getByText(/solde 720,82 € · complément 132,00 €/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Caisse interne' })).toBeInTheDocument();
});

test('nothing collectible → no control at all', () => {
  renderFinance({ editingReservationId: 7, reservationId: 7, form: { arrivalPayment: null } });
  expect(screen.queryByText(/Encaisser en une fois/)).toBeNull();
});

test('« CB / Chèque » posts the mode and the date shown in the field', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, reservationId: 7, form: { arrivalPayment: COLLECTIBLE } });

  // The operator backdates it: the guest paid at the door yesterday.
  const date = screen.getByLabelText('Encaissé le');
  await user.clear(date);
  await user.type(date, '2026-08-30');
  await user.click(screen.getByRole('button', { name: 'CB / Chèque' }));

  expect(api.settleArrivalPayment).toHaveBeenCalledWith(7, 'card', '2026-08-30');
});

test('« Caisse interne » posts the cash mode, and says it is off the books', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, reservationId: 7, form: { arrivalPayment: COLLECTIBLE } });

  expect(screen.getByText(/encaissé hors comptabilité/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Caisse interne' }));

  expect(api.settleArrivalPayment).toHaveBeenCalledWith(7, 'cash', expect.any(String));
});

// specs/single-payment-at-check-in.md rule 16
test('a group already recorded → the summary and its undo, and never the control', () => {
  renderFinance({ editingReservationId: 7, reservationId: 7, form: { arrivalPayment: GROUP } });
  expect(screen.getByText(/paiement unique de 852,82 €/)).toBeInTheDocument();
  expect(screen.getByText(/solde 720,82 € · complément 132,00 €/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Annuler ce paiement' })).toBeInTheDocument();
  expect(screen.queryByText(/Encaisser en une fois/)).toBeNull();
});

test('« Annuler ce paiement » posts the undo', async () => {
  const user = userEvent.setup();
  renderFinance({ editingReservationId: 7, reservationId: 7, form: { arrivalPayment: GROUP } });
  await user.click(screen.getByRole('button', { name: 'Annuler ce paiement' }));
  expect(api.settleArrivalPayment).toHaveBeenCalledWith(7, 'undo', expect.any(String));
});

test('a refused date surfaces the server reason instead of failing silently', async () => {
  const user = userEvent.setup();
  api.settleArrivalPayment.mockRejectedValueOnce(
    new Error('Un encaissement ne peut pas être daté dans le futur.'),
  );
  renderFinance({ editingReservationId: 7, reservationId: 7, form: { arrivalPayment: COLLECTIBLE } });

  await user.click(screen.getByRole('button', { name: 'CB / Chèque' }));

  expect(await screen.findByText(/daté dans le futur/)).toBeInTheDocument();
});

// specs/single-payment-from-the-fiche.md rule 1 — le contrôle vit AU-DESSUS des échéances, dans le
// bloc où la ligne « Encaissé à l'arrivée » se rend déjà. La place n'est pas décorative : c'est la
// première chose que l'opérateur lit quand le client règle tout à la porte, avant de descendre dans
// les échéances qu'il n'aura pas à cocher une par une.
test('le contrôle se rend au-dessus des échéances du séjour', () => {
  renderFinance({
    editingReservationId: 7,
    reservationId: 7,
    form: { arrivalPayment: COLLECTIBLE, balanceAmount: 720.82, complementAmount: 132 },
  });

  const control = screen.getByText(/Encaisser en une fois : 852,82 €/);
  const bucketButton = screen.getByRole('button', { name: 'Marquer solde payé' });
  // eslint-disable-next-line no-bitwise
  const controlComesFirst = control.compareDocumentPosition(bucketButton)
    & Node.DOCUMENT_POSITION_FOLLOWING;
  expect(controlComesFirst).toBeTruthy();
});

// specs/single-payment-from-the-fiche.md rule 12 — il ne REMPLACE pas les boutons par échéance :
// l'opérateur qui a vraiment encaissé le solde mardi et le complément jeudi continue d'enregistrer
// deux paiements, ce qui est la vérité.
test('les boutons par échéance restent offerts à côté du contrôle', () => {
  renderFinance({
    editingReservationId: 7,
    reservationId: 7,
    pricingQuote: { complementAmount: 132 },
    form: { arrivalPayment: COLLECTIBLE, balanceAmount: 720.82 },
  });

  expect(screen.getByText(/Encaisser en une fois/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marquer solde payé' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marquer complément payé' })).toBeInTheDocument();
});
