// specs/mid-stay-notes.md rule 24 reading R31-C-L1 (2026-11-08) — a settlement is refused only after the fiche was saved,
// so the stored state is the new opening: « Annuler » after a refusal must not take a saved sale back out of the form.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { ReservationFormProvider } from '../ReservationFormContext';
import MidStayNoteDialog from '../MidStayNoteDialog';
import { makeMockContext } from './mockReservationForm';
import api from '../../../api';

vi.mock('../../../api', () => ({ __esModule: true, default: { previewMidStayNote: vi.fn() } }));

const PENDING = [{ label: 'Location vélo', amount: 18, key: 'res:3', source: 'midStayExtra' }];

beforeEach(() => {
  vi.clearAllMocks();
  api.previewMidStayNote.mockImplementation(async ({ checkedKeys }) => ({
    items: checkedKeys.map((key) => ({ key, amount: 18 })), total: 18 * checkedKeys.length,
  }));
});

test('rule 24 — « Annuler » after a refused settlement restores the state saved before it, not the pre-save opening', async () => {
  const user = userEvent.setup();
  const opening = { selectedOptions: [] };
  const saved = { selectedOptions: [{ optionId: 19, quantity: 1 }] };
  const ctx = makeMockContext({ editingReservationId: 7, pricingQuote: { midStayExtrasLines: PENDING } });
  ctx.captureOptionsState.mockReturnValueOnce(opening).mockReturnValue(saved);
  const onSettle = vi.fn(async () => { throw new Error('refused'); });
  const onClose = vi.fn();
  render(
    <ReservationFormProvider value={ctx}>
      <MidStayNoteDialog open onClose={onClose} pendingLines={PENDING} onSettle={onSettle} onSellOnly={vi.fn()} />
    </ReservationFormProvider>,
  );
  await user.click(screen.getAllByRole('checkbox')[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'CB / Chèque' }));
  await waitFor(() => expect(onSettle).toHaveBeenCalled());
  expect(onClose).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(ctx.restoreOptionsState).toHaveBeenCalledTimes(1);
  expect(ctx.restoreOptionsState.mock.calls[0][0]).toBe(saved);
  expect(onClose).toHaveBeenCalled();
});
