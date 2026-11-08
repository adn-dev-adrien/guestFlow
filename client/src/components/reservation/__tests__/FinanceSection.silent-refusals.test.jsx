import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderFinance, dueRow, paidRow, editable, ledgerOf } from './ledgerFixtures';
import api from '../../../api';

// Audit R30-C-L2 (2026-11-08) — specs/defer-arrival-complement-to-checkout.md rule 28, specs/mid-stay-notes.md rule 24.
// A refused « Percevoir en fin de séjour », « Reporter au départ » on a note, or a note's settlement used to fail
// silently: the fiche drew the switch as done (« Perçu en fin de séjour ✓ », dirty, « Enregistrer » lit) while nothing was stored, and the server's reason
// only reached the console. The fiche now moves only once the server took it, and shows the refusal.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn(), previewMidStayNote: vi.fn() } }));

const REFUSAL = 'Remboursement du 08/11 (221,14 €) à supprimer d’abord.';
const complementRow = (paid) => (paid ? paidRow : dueRow)('complement', "Complément d'arrivée", 24, {
  amountEdit: editable('complement'), detail: { slot: 'complement' },
});
const NOTES = JSON.stringify([{ id: 1, paidDate: '2026-08-06', paidCash: 0, total: 30, lines: [{ label: 'Coca', amount: 30, key: 'opt:14' }] }]);
const NOTES_ROW = {
  key: 'midStayNotes', label: 'Notes en séjour', amount: 30, state: 'paid', tone: 'done', stateLabel: '1 note perçue',
  action: null, amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null }, detail: { slot: 'midStayNotes' },
};

beforeEach(() => { vi.clearAllMocks(); });

async function openDetails() {
  for (const button of screen.queryAllByRole('button', { name: 'Détail' })) await userEvent.click(button);
}

async function deferPaidComplement() {
  const view = renderFinance({
    ledger: ledgerOf([complementRow(true)]), editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24, endOfStayComplementTotal: 12 },
    form: { complementPaid: true, complementPaidDate: '2026-10-10' },
  });
  await openDetails();
  await userEvent.click(screen.getByRole('button', { name: /^Percevoir en fin de séjour$/i }));
  await userEvent.click(await screen.findByRole('button', { name: /^Confirmer$/i }));
  return view;
}

test('R30-C-L2 — a refused deferral shows the server wording and leaves the fiche as stored', async () => {
  api.markPayment.mockRejectedValueOnce(new Error(REFUSAL));
  const { ctx } = await deferPaidComplement();
  expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
  expect(api.markPayment).toHaveBeenCalledWith(7, { complementDeferredToCheckout: true, complementPaid: false, complementPaidCash: false });
  expect(ctx.updateForm).not.toHaveBeenCalledWith(expect.objectContaining({ complementDeferredToCheckout: true }));
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Perçu en fin de séjour ✓/ })).not.toBeInTheDocument();
});

test('R30-C-L2 — an accepted deferral moves the fiche after the PATCH, then re-reads it', async () => {
  const order = [];
  api.markPayment.mockImplementationOnce(async () => { order.push('patch'); return { ok: true }; });
  const { ctx } = renderFinance({
    ledger: ledgerOf([complementRow(true)]), editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 24, complementAmountAuto: 24, endOfStayComplementTotal: 12 },
    form: { complementPaid: true, complementPaidDate: '2026-10-10' },
  });
  ctx.updateForm.mockImplementation(() => order.push('form'));
  await openDetails();
  await userEvent.click(screen.getByRole('button', { name: /^Percevoir en fin de séjour$/i }));
  await userEvent.click(await screen.findByRole('button', { name: /^Confirmer$/i }));
  await waitFor(() => expect(ctx.reloadReservationFinance).toHaveBeenCalled());
  expect(order).toEqual(['patch', 'form']);
  expect(ctx.updateForm).toHaveBeenCalledWith({ complementDeferredToCheckout: true, complementPaid: false, complementPaidCash: false, complementPaidDate: '' });
});

test('R30-C-L2 — a refused « Reporter au départ » on a note shows the refusal and re-reads the fiche', async () => {
  api.markPayment.mockRejectedValueOnce(new Error('Complément de fin de séjour déjà encaissé.'));
  const { ctx } = renderFinance({
    ledger: ledgerOf([NOTES_ROW]), editingReservationId: 7, reservationId: 7,
    form: { startDate: '2020-01-01', endDate: '2099-01-01', midStaySettledNotes: NOTES },
  });
  await openDetails();
  await userEvent.click(screen.getAllByRole('button', { name: /Reporter au départ/i })[0]);
  await userEvent.click(await screen.findByRole('button', { name: /^Confirmer$/i }));
  expect(await screen.findByText('Complément de fin de séjour déjà encaissé.')).toBeInTheDocument();
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
});

test('R30-C-L2 — a refused note settlement keeps the dialog open and shows why', async () => {
  api.previewMidStayNote.mockResolvedValue({ items: [{ key: 'opt:9', amount: 24 }], total: 24 });
  api.markPayment.mockRejectedValueOnce(new Error('Complément de fin de séjour encaissable après le départ.'));
  const { ctx } = renderFinance({
    ledger: ledgerOf([]), editingReservationId: 7, reservationId: 7, midStayNoteOpen: true,
    form: {
      startDate: '2020-01-01', endDate: '2099-01-01',
      endOfStayComplementDetail: JSON.stringify([{ label: 'Petit-déjeuner', amount: 24, key: 'opt:9', source: 'midStayExtra' }]),
    },
    pricingQuote: { midStayExtrasLines: [{ label: 'Petit-déjeuner', amount: 24, key: 'opt:9', source: 'midStayExtra' }] },
  });
  await userEvent.click(screen.getAllByRole('checkbox')[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'CB / Chèque' }));
  expect(await screen.findByText('Complément de fin de séjour encaissable après le départ.')).toBeInTheDocument();
  expect(ctx.setMidStayNoteOpen).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled();
});
