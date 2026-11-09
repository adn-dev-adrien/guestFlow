// specs/mid-stay-notes.md rule 24 reading R32-C-L2 (2026-11-09) — a note's settlement is judged by its PATCH alone. A
// re-read failing after it left « Nouvelle note » busy with every button disabled (« Annuler » included), and a stored
// settlement followed by a failed re-read was reported « Encaissement impossible ». The re-read is now best effort.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach, afterEach } from 'vitest';
import { renderFinance, ledgerOf } from './ledgerFixtures';
import api from '../../../api';
import { addIsoDays, localIsoToday } from '../../../utils/isoDay';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn(), previewMidStayNote: vi.fn() } }));

const TODAY = localIsoToday();
const LINE = { label: 'Petit-déjeuner', amount: 24, key: 'opt:9', source: 'midStayExtra' };
const unhandled = [];
const onUnhandled = (e) => unhandled.push(String(e));

beforeEach(() => {
  vi.clearAllMocks();
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  api.previewMidStayNote.mockResolvedValue({ items: [{ key: LINE.key, amount: 24 }], total: 24 });
});
afterEach(() => { process.off('unhandledRejection', onUnhandled); });

async function settleWithFailingReread() {
  const view = renderFinance({
    ledger: ledgerOf([]), editingReservationId: 7, reservationId: 7, midStayNoteOpen: true,
    form: { startDate: addIsoDays(TODAY, -2), endDate: addIsoDays(TODAY, 3), endOfStayComplementDetail: JSON.stringify([LINE]) },
    pricingQuote: { midStayExtrasLines: [LINE] },
  });
  // The fiche's save starts the action without waiting for it, then answers that it saved.
  view.ctx.saveThenRun.mockImplementation((action) => { action(); return Promise.resolve(true); });
  view.ctx.reloadReservationFinance.mockRejectedValue(new Error('Network down'));
  await userEvent.click(screen.getAllByRole('checkbox')[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'CB / Chèque' }));
  return view;
}

test('R32-C-L2 — refused, then the re-read fails: the refusal shows and the dialog is usable again', async () => {
  api.markPayment.mockRejectedValueOnce(new Error('Note déjà encaissée.'));
  const { ctx } = await settleWithFailingReread();
  expect(await screen.findByText('Note déjà encaissée.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Annuler' })).toBeEnabled();
  expect(ctx.reloadReservationFinance).toHaveBeenCalled();
  expect(ctx.setMidStayNoteOpen).not.toHaveBeenCalledWith(false);
  expect(unhandled).toEqual([]);
});

test('R32-C-L2 — stored, then the re-read fails: the dialog closes and no refusal is shown', async () => {
  api.markPayment.mockResolvedValueOnce({ ok: true });
  const { ctx } = await settleWithFailingReread();
  await waitFor(() => expect(ctx.setMidStayNoteOpen).toHaveBeenCalledWith(false));
  expect(screen.queryByText('Encaissement impossible.')).not.toBeInTheDocument();
  expect(api.markPayment).toHaveBeenCalledTimes(1);
  expect(unhandled).toEqual([]);
});
