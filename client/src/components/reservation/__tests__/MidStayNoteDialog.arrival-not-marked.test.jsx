// specs/mid-stay-notes.md rules 5bis, 23 (D19) — a note on a started stay with no arrival marked stays open and says
// where the sale goes; the flag is the server's, read from the note's own preview.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import MidStayNoteDialog from '../MidStayNoteDialog';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from './mockReservationForm';
import api from '../../../api';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({ __esModule: true, default: { previewMidStayNote: vi.fn() } }));

const CAPTION = 'Arrivée non marquée : la vente rejoint le solde.';

const open = () => render(
  <ReservationFormProvider
    value={makeMockContext({
      editingReservationId: 7,
      propertyOptions: [],
      pricingQuote: { midStayExtrasLines: [] },
      form: { selectedOptions: [], customOptions: [], selectedResources: [] },
    })}
  >
    <MidStayNoteDialog open onClose={vi.fn()} pendingLines={[]} onSettle={vi.fn()} onSellOnly={vi.fn()} />
  </ReservationFormProvider>,
);

beforeEach(() => { api.previewMidStayNote.mockReset(); });

test('rule 23: the caption shows when the server says no arrival, and the preview names the stay', async () => {
  api.previewMidStayNote.mockResolvedValue({ items: [], total: 0, arrivalNotMarked: true });
  open();
  expect(await screen.findByText(CAPTION)).toBeInTheDocument();
  expect(api.previewMidStayNote.mock.calls[0][0]).toMatchObject({ reservationId: 7 });
});

test('rule 23: no caption when the server does not say so, nor when the preview fails', async () => {
  api.previewMidStayNote.mockResolvedValue({ items: [], total: 0, arrivalNotMarked: false });
  const first = open();
  await waitFor(() => expect(api.previewMidStayNote).toHaveBeenCalled());
  await screen.findByText('Total de la note');
  expect(screen.queryByText(CAPTION)).toBeNull();
  first.unmount();
  api.previewMidStayNote.mockClear();
  api.previewMidStayNote.mockRejectedValue(new Error('Connexion au serveur impossible.'));
  open();
  await screen.findByText('Total de la note');
  await waitFor(() => expect(api.previewMidStayNote).toHaveBeenCalled());
  expect(screen.queryByText(CAPTION)).toBeNull();
});
