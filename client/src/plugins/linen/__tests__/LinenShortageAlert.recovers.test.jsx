// specs/linen-laundry-days.md §3.3 rule 18 and §6.3 — the shortage alert says when the laundry brings the linen back.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../../api', () => ({ default: { getLinenShortageAlert: vi.fn() } }));
vi.mock('../../../components/AttentionCard', () => ({ default: ({ children }) => <div>{children}</div> }));

import api from '../../../api';
import LinenShortageAlert from '../LinenShortageAlert';

const payload = (over = {}) => ({
  horizon: '2026-08-30',
  shortagesByType: [{
    type: 'double', label: 'Drap double', firstShortageDate: '2026-06-24', maxMissing: 2, recoversOn: '2026-06-30',
    impactedReservations: [], ...over,
  }],
});

const renderAlert = () => render(<MemoryRouter><LinenShortageAlert attention={{}} /></MemoryRouter>);

test('specs/linen-laundry-days.md rule 18: the end of the shortage follows the first shortage — « jusqu\'au mar. 30 juin »', async () => {
  api.getLinenShortageAlert.mockResolvedValue(payload());
  renderAlert();
  await waitFor(() => expect(screen.getByText('Drap double')).toBeInTheDocument());
  const line = screen.getByText('Drap double').parentElement;
  expect(line).toHaveTextContent("jusqu'à 2 manquants");
  expect(line).toHaveTextContent('première rupture le 24 juin 2026');
  expect(line).toHaveTextContent("jusqu'au mar. 30 juin");
});

test('specs/linen-laundry-days.md rule 18: without recoversOn (not within the horizon) the wording is today\'s', async () => {
  api.getLinenShortageAlert.mockResolvedValue(payload({ recoversOn: null }));
  renderAlert();
  await waitFor(() => expect(screen.getByText('Drap double')).toBeInTheDocument());
  const line = screen.getByText('Drap double').parentElement;
  expect(line).toHaveTextContent('première rupture le 24 juin 2026');
  expect(line).not.toHaveTextContent("jusqu'au");
});
