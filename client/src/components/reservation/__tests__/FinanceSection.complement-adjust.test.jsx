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

// specs/adjustable-complement-amounts.md rule 1
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

test('§3.3 — « Percevoir en fin de séjour » pose le marqueur et recharge', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24 },
    form: { ...FUTURE },
  });
  await user.click(screen.getByRole('button', { name: /^Percevoir en fin de séjour$/i }));
  expect(ctx.updateForm).toHaveBeenCalledWith({ complementDeferredToCheckout: true });
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledWith(7, { complementDeferredToCheckout: true }));
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

test('§3.3 règle 15 — le séjour commencé ne verrouille plus le report', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24 },
    form: { startDate: '2020-01-01', endDate: '2020-01-05' },
  });
  expect(screen.getByRole('button', { name: /^Percevoir en fin de séjour$/i })).toBeEnabled();
});

test('§3.3 règle 15 — un complément encaissé reste reportable, après confirmation', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24 },
    form: { ...FUTURE, complementPaid: true, complementPaidDate: '2099-06-01' },
  });
  await user.click(screen.getByRole('button', { name: /^Percevoir en fin de séjour$/i }));
  expect(await screen.findByText(/Il est marqué encaissé/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Confirmer$|^Oui$/i }));
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledWith(7, {
    complementDeferredToCheckout: true, complementPaid: false, complementPaidCash: false,
  }));
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

// specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rule 3 — une prestation vendue sur un
// complément d'arrivée encaissé part au complément de fin de séjour, et la carte doit le montrer
// AVANT l'enregistrement : sinon l'opérateur voit son option disparaître de l'écran.
test('la carte de fin de séjour rend le devis live, pas seulement le montant stocké', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: {
      complementAmount: 24, complementAmountAuto: 24,
      endOfStayComplementTotal: 30, endOfStayComplementAutoTotal: 30,
      midStayExtrasLines: [{ label: 'Petit déjeuner', qty: 3, unitPrice: 10, amount: 30, source: 'midStayExtra', key: 'opt:6' }],
    },
    form: { ...FUTURE, complementPaid: true, endOfStayComplementAmount: 0, endOfStayComplementAmountAuto: 0 },
  });
  expect(screen.getByText('Complément de fin de séjour')).toBeInTheDocument();
  expect(screen.getByText(/Petit déjeuner : 30,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Calcul auto \(30,00 €\)/)).toBeInTheDocument();
});

// Le bouton « Complément payé » de la carte d'arrivée n'écrivait en base que sur une réservation
// VERROUILLÉE : ailleurs il n'y avait que le formulaire, et le serveur — qui décide de la fusion des
// cartes — continuait de croire le complément encaissé. Dé-marquer puis reporter ne fusionnait rien.
test('dé-marquer l\'encaissement part immédiatement au serveur', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24 },
    form: { ...FUTURE, complementPaid: true, complementPaidDate: '2099-06-01' },
  });
  await user.click(screen.getByRole('button', { name: /^Complément payé$/i }));
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledWith(7, { complementPaid: false, complementPaidDate: null }));
  expect(ctx.updateForm).toHaveBeenCalledWith({ complementPaid: false, complementPaidDate: '' });
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

// §3.2 rule 7bis — la carte fusionnée suit le devis LIVE : le bloc stocké date du dernier
// enregistrement et gardait les anciennes lignes pendant que le résumé suivait déjà le moteur.
test('la carte fusionnée préfère le bloc live du devis au bloc stocké', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: {
      complementAmount: 128.05, complementAmountAuto: 128.05,
      endOfStayComplementTotal: 30, endOfStayComplementAutoTotal: 30,
      checkoutComplement: {
        deferred: true, amount: 158.05, arrivalAmount: 128.05, endOfStayAmount: 30,
        paid: false, paidCash: false, paidDate: null,
        lines: [
          { label: 'Le repas des trappeurs', amount: 75, origin: 'arrival' },
          { label: 'Bain nordique', amount: 30, origin: 'endOfStay' },
        ],
      },
    },
    form: {
      ...FUTURE,
      complementDeferredToCheckout: true,
      // Bloc stocké périmé : l'ancien total et l'ancien repas à 100 €.
      checkoutComplement: {
        deferred: true, amount: 183.05, arrivalAmount: 153.05, endOfStayAmount: 30,
        paid: false, paidCash: false, paidDate: null,
        lines: [{ label: 'Le repas des trappeurs', amount: 100, origin: 'arrival' }],
      },
    },
  });
  expect(screen.getByText('(158,05 €)')).toBeInTheDocument();
  expect(screen.getByText(/Le repas des trappeurs : 75,00 €/)).toBeInTheDocument();
  expect(screen.queryByText('(183,05 €)')).not.toBeInTheDocument();
  expect(screen.queryByText(/Le repas des trappeurs : 100,00 €/)).not.toBeInTheDocument();
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

// specs/adjustable-complement-amounts.md rule 29 — complément d'arrivée reporté au check-out : la
// fiche n'affiche qu'UNE carte, et ajuster son total écrit l'ajustement du complément d'ARRIVÉE à
// « cible − montant de fin de séjour ». Le total saisi est celui que l'opérateur a annoncé au client ;
// c'est au code de retrouver quel bucket doit bouger pour l'obtenir.
const MERGED = {
  editingReservationId: 7,
  reservationId: 7,
  pricingQuote: {
    complementAmount: 128.05, complementAmountAuto: 128.05,
    endOfStayComplementTotal: 30, endOfStayComplementAutoTotal: 30,
    checkoutComplement: {
      deferred: true, amount: 158.05, arrivalAmount: 128.05, endOfStayAmount: 30,
      paid: false, paidCash: false, paidDate: null,
      lines: [{ label: 'Le repas des trappeurs', amount: 128.05, origin: 'arrival' }],
    },
  },
  form: {
    ...FUTURE,
    complementDeferredToCheckout: true,
    complementAdjustment: { floor: 9.6, tax: 9.6, accommodation: 0, allocation: null },
  },
};

test('règle 29 — ajuster la carte fusionnée écrit l’ajustement d’ARRIVÉE, net de la fin de séjour', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance(MERGED);

  await user.type(screen.getByLabelText(/Montant ajusté/i), '150');
  await user.tab();

  expect(ctx.updateForm).toHaveBeenCalledWith({ complementAmountOverride: 120 });
});

// specs/adjustable-complement-amounts.md rule 30 — sous le montant de fin de séjour, l'ajustement
// d'arrivée tombe à 0 : descendre plus bas demanderait de corriger les lignes de fin de séjour, qui
// ont leur propre vérité (celles du SAS départ).
test('règle 30 — une cible sous la fin de séjour bute sur le plancher', async () => {
  const user = userEvent.setup();
  // Sans taxe de séjour dans le complément, le seul plancher qui reste est celui de la règle 30 :
  // la part de fin de séjour, que la carte fusionnée ne peut pas négocier.
  const ctx = renderFinance({
    ...MERGED,
    form: { ...MERGED.form, complementAdjustment: { floor: 0, tax: 0, accommodation: 0, allocation: null } },
  });

  await user.type(screen.getByLabelText(/Montant ajusté/i), '20');
  await user.tab();

  expect(ctx.updateForm).toHaveBeenCalledWith({ complementAmountOverride: 0 });
});

// specs/adjustable-complement-amounts.md rule 19 — la ligne « Ajustement » du complément de fin de
// séjour est VISIBLE dans les lignes de la carte, négative comprise : aucune écriture séparée n'est
// produite, donc c'est la seule façon pour l'opérateur de voir de combien il a corrigé.
test('règle 19 — la ligne d’ajustement se lit dans les lignes de la carte, même négative', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    form: {
      ...FUTURE,
      endOfStayComplementAmount: 70,
      endOfStayComplementAmountOverride: 70,
      endOfStayComplementDetail: JSON.stringify([
        { label: 'Ménage de fin de séjour', amount: 80 },
        { label: 'Ajustement', amount: -10 },
      ]),
    },
  });

  expect(screen.getByText(/Ménage de fin de séjour : 80,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Ajustement : -10,00 €/)).toBeInTheDocument();
});
