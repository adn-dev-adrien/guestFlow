import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';
import { vi } from 'vitest';

import api from '../../../api';

// specs/mid-stay-notes.md §3.5 — le bloc « Complément durant le séjour » : total courant, entrée
// « Nouvelle note », historique dépliable et annulation. Le bloc complément de fin de séjour, lui,
// ne gagne AUCUN bouton par ligne (décision 2026-08-06 : ne pas charger la fiche).

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const NOTES = JSON.stringify([
  {
    id: 1, paidDate: '2026-08-06', paidCash: 0, total: 30,
    lines: [{ label: 'Petit-déjeuner', amount: 24, key: 'opt:9' }, { label: 'Coca', amount: 6, key: 'opt:14' }],
  },
  { id: 2, paidDate: '2026-08-05', paidCash: 1, total: 17, lines: [{ label: 'Boisson', amount: 17, key: 'opt:14' }] },
]);

// Une résa EN COURS (arrivée passée) : c'est la condition d'apparition du bloc.
function renderFinance(overrides = {}) {
  const { form: formOverrides, ...rest } = overrides;
  const ctx = makeMockContext({
    editingReservationId: 7,
    reservationId: 7,
    form: { startDate: '2020-01-01', endDate: '2099-01-01', ...formOverrides },
    ...rest,
  });
  render(
    <DialogProvider>
      <ReservationFormProvider value={ctx}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  return ctx;
}

beforeEach(() => { vi.clearAllMocks(); });

test('le bloc apparaît dès que le séjour a commencé, avec le bouton « Nouvelle note »', () => {
  renderFinance();
  expect(screen.getByText('Complément durant le séjour')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Nouvelle note/i })).toBeEnabled();
});

test('séjour à venir et aucun encaissement → pas de bloc', () => {
  renderFinance({ form: { startDate: '2099-01-01', endDate: '2099-01-05' } });
  expect(screen.queryByText('Complément durant le séjour')).not.toBeInTheDocument();
});

test('le total cumulé des notes est affiché, l\'historique se déplie avec date, mode et lignes', async () => {
  const user = userEvent.setup();
  renderFinance({ form: { midStaySettledNotes: NOTES } });
  expect(screen.getByText('(47,00 €)')).toBeInTheDocument(); // 30 + 17

  await user.click(screen.getByRole('button', { name: /Voir l'historique \(2 notes\)/i }));
  expect(screen.getByText('06/08 — 30,00 € — CB')).toBeInTheDocument();
  expect(screen.getByText('05/08 — 17,00 € — Caisse interne')).toBeInTheDocument();
  expect(screen.getByText('Petit-déjeuner : 24,00 €')).toBeInTheDocument();
});

test('reporter une note au départ : confirmation puis PATCH cancelMidStayNote + rechargement', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({ form: { midStaySettledNotes: NOTES } });
  await user.click(screen.getByRole('button', { name: /Voir l'historique/i }));
  await user.click(screen.getAllByRole('button', { name: /Reporter au départ/i })[0]);

  expect(await screen.findByText(/rejoignent le complément de fin de séjour/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Confirmer$|^Oui$|^Supprimer$/i }));

  await waitFor(() => expect(api.markPayment).toHaveBeenCalledWith(7, { cancelMidStayNote: { id: 1 } }));
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

test('complément de fin de séjour déjà encaissé → « Nouvelle note » désactivé', () => {
  renderFinance({ form: { midStaySettledNotes: NOTES, endOfStayComplementPaid: true } });
  expect(screen.getByRole('button', { name: /Nouvelle note/i })).toBeDisabled();
});

test('le bloc complément de fin de séjour ne gagne AUCUN bouton par ligne', () => {
  renderFinance({
    form: {
      endOfStayComplementAmount: 24,
      endOfStayComplementDetail: JSON.stringify([
        { label: 'Petit-déjeuner', amount: 24, key: 'opt:9', source: 'midStayExtra' },
      ]),
    },
  });
  expect(screen.getByText('Complément de fin de séjour')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Encaisser$/i })).not.toBeInTheDocument();
});
