import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';
import { vi } from 'vitest';
import { dueRow, editable, ledgerOf } from './ledgerFixtures';

import api from '../../../api';

// specs/mid-stay-notes.md §3.5 — les notes en séjour : total courant, entrée « Nouvelle note »,
// historique dépliable et annulation. Depuis specs/reservation-payment-ledger.md rule 2 elles sont
// une ligne du registre (« Notes en séjour », présente dès qu'une note porte de l'argent), leur
// historique replié sous « Détail », et « + Nouvelle note » sous le registre. Le bloc complément de fin de séjour, lui,
// ne gagne AUCUN bouton par ligne (décision 2026-08-06 : ne pas charger la fiche).

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const NOTES = JSON.stringify([
  {
    id: 1, paidDate: '2026-08-06', paidCash: 0, total: 30,
    lines: [{ label: 'Petit-déjeuner', amount: 24, key: 'opt:9' }, { label: 'Coca', amount: 6, key: 'opt:14' }],
  },
  { id: 2, paidDate: '2026-08-05', paidCash: 1, total: 17, lines: [{ label: 'Boisson', amount: 17, key: 'opt:14' }] },
]);

const NOTES_ROW = {
  key: 'midStayNotes', label: 'Notes en séjour', amount: 47, state: 'paid', tone: 'done', stateLabel: '2 notes perçues',
  action: null, amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null }, detail: { slot: 'midStayNotes' },
};

// Une résa EN COURS (arrivée passée) : c'est la condition d'apparition de « Nouvelle note ».
function renderFinance(overrides = {}) {
  const { form: formOverrides, ...rest } = overrides;
  const ctx = makeMockContext({
    editingReservationId: 7,
    reservationId: 7,
    ledger: ledgerOf(formOverrides && formOverrides.midStaySettledNotes ? [NOTES_ROW] : []),
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

test('« Nouvelle note » apparaît dès que le séjour a commencé', () => {
  renderFinance();
  expect(screen.getByRole('button', { name: /Nouvelle note/i })).toBeEnabled();
});

test('séjour à venir et aucun encaissement → pas de « Nouvelle note », pas de ligne', () => {
  renderFinance({ form: { startDate: '2099-01-01', endDate: '2099-01-05' } });
  expect(screen.queryByRole('button', { name: /Nouvelle note/i })).not.toBeInTheDocument();
  expect(screen.queryByText('Notes en séjour')).not.toBeInTheDocument();
});

test('le total cumulé des notes est affiché, l\'historique se déplie avec date, mode et lignes', async () => {
  const user = userEvent.setup();
  renderFinance({ form: { midStaySettledNotes: NOTES } });
  expect(screen.getByText('Notes en séjour')).toBeInTheDocument();
  expect(screen.getByText(/47,00/)).toBeInTheDocument(); // 30 + 17, the server's row

  await user.click(screen.getByRole('button', { name: 'Détail' }));
  expect(screen.getByText('06/08 — 30,00 € — CB')).toBeInTheDocument();
  expect(screen.getByText('05/08 — 17,00 € — Caisse interne')).toBeInTheDocument();
  expect(screen.getByText('Petit-déjeuner : 24,00 €')).toBeInTheDocument();
});

test('reporter une note au départ : confirmation puis PATCH cancelMidStayNote + rechargement', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({ form: { midStaySettledNotes: NOTES } });
  await user.click(screen.getByRole('button', { name: 'Détail' }));
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
    ledger: ledgerOf([dueRow('endOfStayComplement', 'Complément de fin de séjour', 24, { amountEdit: editable('complement'), detail: { slot: 'endOfStayComplement' } })]),
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
