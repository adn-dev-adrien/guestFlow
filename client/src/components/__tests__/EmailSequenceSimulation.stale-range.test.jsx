// Audit R5 (2026-10-30), specs/ui-review-2026-10-19-operations.md rule 39 — a slow simulation for a range already left never replaces the one shown.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({ __esModule: true, default: { getEmailSequenceSimulation: vi.fn() } }));

import api from '../../api';
import EmailSequenceSimulation from '../EmailSequenceSimulation';

const result = (name) => ({
  rows: [{ date: '2026-09-25', mailKey: 'arrival_reminder_7d', mailLabel: 'J-7', reservationId: 1, clientId: 1, clientName: name, propertyName: 'La Granja', status: 'send', reason: '' }],
  counts: { send: 1, blocked: 0, alreadySent: 0, toCheck: 0 }, startDate: null, assumedStartDate: '2026-09-18', autoMailKeys: [],
});

test('the late simulation of the range left is dropped', async () => {
  let finishFirst;
  let calls = 0;
  api.getEmailSequenceSimulation.mockImplementation(() => {
    calls += 1;
    return calls === 1 ? new Promise((resolve) => { finishFirst = resolve; }) : Promise.resolve(result('Nouvelle plage'));
  });
  render(<MemoryRouter><EmailSequenceSimulation tabs={null} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2027-01-01' } });
  expect((await screen.findAllByText('Nouvelle plage')).length).toBeGreaterThan(0);
  await act(async () => { finishFirst(result('Ancienne plage')); });
  expect(screen.queryByText('Ancienne plage')).not.toBeInTheDocument();
});
