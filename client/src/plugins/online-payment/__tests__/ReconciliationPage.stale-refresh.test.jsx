// Audit R5 (2026-10-30), specs/ui-review-2026-10-19-operations.md rule 39 — « Actualiser » reads the bank slowly; changing tab meanwhile must not let the
// late answer of the tab left take over the tab shown.
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import DialogProvider from '../../../components/DialogProvider';
import ReconciliationPage from '../ReconciliationPage';
import { gap, COUNTS, BULK } from './reconciliationFixtures';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getReconciliation: vi.fn(), readReconciliation: vi.fn(), confirmReconciliation: vi.fn(), confirmAllReconciliation: vi.fn(),
    discardReconciliation: vi.fn(), undoReconciliation: vi.fn(), setReconciliationOutside: vi.fn(), getReconciliationCandidates: vi.fn(),
  },
}));
import api from '../../../api';

const payload = (view, items) => ({
  lastReadAt: '2026-10-23T08:00:00.000Z', lastError: null, startDate: '2026-10-01', counts: COUNTS, view, filter: null, items, credits: [], bulk: BULK,
});

test('the late answer of « Actualiser » for the tab left is dropped', async () => {
  window.innerWidth = 1280;
  const marker = gap({ key: '1|balance', reservation: { id: 1, clientName: 'Zoe Todo', propertyName: 'Gîte', platform: 'direct' } });
  api.getReconciliation.mockImplementation((view) => Promise.resolve(payload(view, view === 'todo' ? [marker] : [])));
  let finishRead;
  api.readReconciliation.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
  render(<MemoryRouter><DialogProvider><ReconciliationPage /></DialogProvider></MemoryRouter>);
  await screen.findByText(/Zoe Todo/);
  fireEvent.click(screen.getByRole('button', { name: /Actualiser/ }));
  fireEvent.click(screen.getByRole('tab', { name: /Attendus/ }));
  await waitFor(() => expect(api.getReconciliation).toHaveBeenLastCalledWith('waiting', null));
  await waitFor(() => expect(screen.queryByText(/Zoe Todo/)).toBeNull());
  await act(async () => { finishRead(payload('todo', [marker])); });
  expect(screen.queryByText(/Zoe Todo/)).toBeNull();
});
