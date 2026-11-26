// specs/sas/mid-stay-notes.md rule 22 (reading of 2026-11-19, loop t26 UI26-2), specs/plugins/plugins-phase-1-sdk.md rule 54 — « Nouvelle note »
// previews its total through `useLatestPreview`: while a recompute is asked (the note's preview, or the fiche's live quote pricing a
// prestation just added) the latest total stays, dimmed, and no settle button acts on it; a failure shows « — », its reason and
// « Réessayer »; the « Plusieurs moyens » lines stay mounted through a recompute, come back as typed after a failure, and take the focus
// only when the operator opens them.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ReservationFormProvider } from '../ReservationFormContext';
import MidStayNoteDialog from '../MidStayNoteDialog';
import { makeMockContext } from './mockReservationForm';
import api from '../../../api';

vi.mock('../../../api', () => ({ __esModule: true, default: { previewMidStayNote: vi.fn() } }));

const PENDING = [
  { label: 'Petit-déjeuner', amount: 24, key: 'opt:9', source: 'midStayExtra' },
  { label: 'Location vélo', amount: 18, key: 'res:3', source: 'midStayExtra' },
];
const offline = () => Object.assign(new Error('Service indisponible'), { status: 503 });

// The server answers 24 € per ticked key; `hold()` keeps the next answers until `release()`; `state.fail` makes them fail.
const state = { fail: false, gate: null, open: null };
const hold = () => { state.gate = new Promise((resolve) => { state.open = resolve; }); };
const release = async () => { await act(async () => { state.open(); state.gate = null; }); };

function renderNote() {
  const onSettle = vi.fn(() => Promise.resolve());
  render(
    <ReservationFormProvider value={makeMockContext({ editingReservationId: 7, pricingQuote: { midStayExtrasLines: PENDING } })}>
      <MidStayNoteDialog open onClose={() => {}} pendingLines={PENDING} onSettle={onSettle} onSellOnly={vi.fn()} />
    </ReservationFormProvider>,
  );
  return { onSettle };
}
const total = () => screen.getByTestId('note-total');
const tick = (i) => fireEvent.click(screen.getAllByRole('checkbox')[i]);
const amounts = () => [...document.querySelectorAll('[data-tender-amount]')].map((input) => input.value);
const amount = (i) => document.querySelector(`[data-tender-amount="${i}"]`);

beforeEach(() => {
  state.fail = false;
  state.gate = null;
  api.previewMidStayNote.mockImplementation(async ({ checkedKeys }) => {
    if (state.gate) await state.gate;
    if (state.fail) throw offline();
    return { items: checkedKeys.map((key) => ({ key, amount: 24 })), total: 24 * checkedKeys.length };
  });
});

async function withLines() {
  renderNote();
  tick(0);
  await waitFor(() => expect(total()).toHaveTextContent('24,00 €'));
  fireEvent.click(screen.getByRole('button', { name: 'Plusieurs moyens' }));
  await waitFor(() => expect(amounts()).toHaveLength(2));
  // Espèces 10 typed, CB shows what remains.
  fireEvent.change(amount(0), { target: { value: '10' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Encaisser 24,00 €' })).toBeEnabled());
}

test('before the first answer the total is « — » and nothing settles; then the server total', async () => {
  hold();
  renderNote();
  expect(total()).toHaveTextContent('—');
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Caisse interne' })).toBeDisabled();
  await release();
  await waitFor(() => expect(total()).toHaveTextContent('0,00 €'));
});

test('while a recompute is asked the latest total stays and no settle button acts on it', async () => {
  renderNote();
  tick(0);
  await waitFor(() => expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled());
  hold();
  tick(1);
  expect(total()).toHaveTextContent('24,00 €');
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Caisse interne' })).toBeDisabled();
  await release();
  await waitFor(() => expect(total()).toHaveTextContent('48,00 €'));
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled();
});

test('while the fiche re-prices a prestation just added (its live quote on its way), nothing settles on the note', async () => {
  const note = (pending) => (
    <ReservationFormProvider value={makeMockContext({ editingReservationId: 7, pricingQuote: { midStayExtrasLines: PENDING }, pricingQuotePending: pending })}>
      <MidStayNoteDialog open onClose={() => {}} pendingLines={PENDING} onSettle={vi.fn()} onSellOnly={vi.fn()} />
    </ReservationFormProvider>
  );
  const view = render(note(false));
  tick(0);
  await waitFor(() => expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled());
  view.rerender(note(true));
  expect(total()).toHaveTextContent('24,00 €');
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Caisse interne' })).toBeDisabled();
  view.rerender(note(false));
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled();
});

test('« Plusieurs moyens » opened by the operator takes the focus on its first amount', async () => {
  renderNote();
  tick(0);
  await waitFor(() => expect(total()).toHaveTextContent('24,00 €'));
  fireEvent.click(screen.getByRole('button', { name: 'Plusieurs moyens' }));
  await waitFor(() => expect(document.activeElement).toBe(amount(0)));
});

test('a recompute keeps the typed lines mounted, the focus where it is, and the button pending until the new total', async () => {
  await withLines();
  const typed = amount(0);
  typed.focus();
  hold();
  tick(1);
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 300); }); });
  expect(amount(0)).toBe(typed);
  expect(amount(0)).toHaveValue('10');
  expect(document.activeElement).toBe(typed);
  expect(screen.getByRole('button', { name: /^Encaisser/ })).toBeDisabled();
  await release();
  await waitFor(() => expect(total()).toHaveTextContent('48,00 €'));
  expect(amount(0)).toBe(typed);
  expect(amount(0)).toHaveValue('10');
  expect(document.activeElement).toBe(typed);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Encaisser 48,00 €' })).toBeEnabled());
});

test('a failed recompute: « — », its reason and « Réessayer », the focus kept in the dialog; the lines come back as typed', async () => {
  await withLines();
  amount(0).focus();
  state.fail = true;
  tick(1);
  await screen.findByText('Service indisponible');
  expect(total()).toHaveTextContent('—');
  expect(amounts()).toHaveLength(0);
  expect(screen.getByTestId('tenders-unknown')).toHaveTextContent('À encaisser : —');
  expect(screen.getByRole('button', { name: 'Encaisser —' })).toBeDisabled();
  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  state.fail = false;
  const retry = screen.getByRole('button', { name: 'Réessayer' });
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(total()).toHaveTextContent('48,00 €'));
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  await waitFor(() => expect(amounts()[0]).toBe('10'));
  // Brought back by the screen, not opened by the operator: the lines do not take the focus.
  expect(document.activeElement).not.toBe(amount(0));
  expect(document.activeElement).not.toBe(document.body);
});
