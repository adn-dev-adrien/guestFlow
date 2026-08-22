import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';
import { vi } from 'vitest';

import api from '../../../api';

// specs/adjustable-complement-amounts.md §3.1/§3.6 (montant ajusté + ventilation) et
// specs/defer-arrival-complement-to-checkout.md §3.3 (bascule depuis la fiche).

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

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

const FUTURE = { startDate: '2099-06-01', endDate: '2099-06-05' };

beforeEach(() => { vi.clearAllMocks(); });

test('le champ « Montant ajusté » affiche le calcul auto tant qu\'il est vide', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 93.6, complementAmountAuto: 93.6 },
    form: { ...FUTURE },
  });
  expect(screen.getByLabelText(/Montant ajusté/i)).toHaveValue('');
  expect(screen.getByText(/Calcul auto \(93,60 €\)/)).toBeInTheDocument();
});

test('saisir un montant remonte l\'ajustement au formulaire', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 93.6, complementAmountAuto: 93.6 },
    form: { ...FUTURE, complementAdjustment: { floor: 9.6, tax: 9.6, accommodation: 0, allocation: null } },
  });
  const field = screen.getByLabelText(/Montant ajusté/i);
  await user.type(field, '85');
  await user.tab();
  expect(ctx.updateForm).toHaveBeenCalledWith({ complementAmountOverride: 85 });
});

test('règle 33 — une valeur sous le plancher est ramenée au plancher', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 93.6, complementAmountAuto: 93.6 },
    form: { ...FUTURE, complementAdjustment: { floor: 9.6, tax: 9.6, accommodation: 0, allocation: null } },
  });
  await user.type(screen.getByLabelText(/Montant ajusté/i), '2');
  await user.tab();
  expect(ctx.updateForm).toHaveBeenCalledWith({ complementAmountOverride: 9.6 });
});

test('§3.6 — la ventilation comptable est affichée quand un ajustement est posé', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 85, complementAmountAuto: 93.6 },
    form: {
      ...FUTURE,
      complementAmountOverride: 85,
      complementAdjustment: {
        floor: 9.6, tax: 9.6, accommodation: 0,
        allocation: [
          { label: 'Prestations', amount: 21.54 },
          { label: 'Activités', amount: 53.86 },
          { label: 'Taxe de séjour', amount: 9.6, locked: true },
        ],
      },
    },
  });
  expect(screen.getByText('Ventilation comptable')).toBeInTheDocument();
  expect(screen.getByText(/Prestations : 21,54 €/)).toBeInTheDocument();
  expect(screen.getByText(/Taxe de séjour : 9,60 € \(inchangé\)/)).toBeInTheDocument();
  expect(screen.getByText(/Montant figé/)).toBeInTheDocument();
});

test('règle 9 — une carte ajustée à 0 € reste affichée', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 0, complementAmountAuto: 24 },
    form: { ...FUTURE, complementAmountOverride: 0 },
  });
  expect(screen.getByText("Complément d'arrivée")).toBeInTheDocument();
});

test('§3.3 — l\'interrupteur « Percevoir en fin de séjour » pose le marqueur et recharge', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24 },
    form: { ...FUTURE },
  });
  await user.click(screen.getByRole('switch', { name: /Percevoir en fin de séjour/i }));
  expect(ctx.updateForm).toHaveBeenCalledWith({ complementDeferredToCheckout: true });
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledWith(7, { complementDeferredToCheckout: true }));
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

test('§3.3 règle 15 — séjour commencé : l\'interrupteur est coché et figé', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24 },
    form: { startDate: '2020-01-01', endDate: '2020-01-05' },
  });
  const toggle = screen.getByRole('switch', { name: /Percevoir en fin de séjour/i });
  expect(toggle).toBeChecked();
  expect(toggle).toBeDisabled();
});

test('§6.5 — les deux compléments sont rendus dans la même grille, chacun sur une demi-largeur', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24 },
    form: { ...FUTURE, endOfStayComplementAmount: 40, endOfStayComplementAmountAuto: 40 },
  });
  const arrival = screen.getByText("Complément d'arrivée").closest('.MuiGrid-root');
  const endOfStay = screen.getByText('Complément de fin de séjour').closest('.MuiGrid-root');
  expect(arrival).not.toBe(endOfStay);
  expect(arrival.parentElement).toBe(endOfStay.parentElement);
});
