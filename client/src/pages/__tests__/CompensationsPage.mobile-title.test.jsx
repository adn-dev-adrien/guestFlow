// specs/plugins-phase-2-hosts.md rule 21 — the page of the indemnities reads « Indemnités » on a phone,
// where the full title would be cut, and its explanation speaks of no one (« faute de règlement »).
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({ __esModule: true, default: { getCancellationCompensations: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'] } }) }));

import api from '../../api';
import CompensationsPage from '../CompensationsPage';

const media = (matches) => (query) => ({
  matches, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});
let orig;
beforeEach(() => {
  orig = window.matchMedia;
  api.getCancellationCompensations.mockResolvedValue({ pending: [], received: [], totals: { pendingExpected: 0, receivedInMonth: 0 } });
});
afterEach(() => { window.matchMedia = orig; });

const renderPage = () => render(<MemoryRouter initialEntries={['/finance/indemnites']}><DialogProvider><CompensationsPage /></DialogProvider></MemoryRouter>);

test('rule 21: « Indemnités » on a phone, the full title above', async () => {
  window.matchMedia = media(true);
  const { unmount } = renderPage();
  expect(await screen.findByText('Indemnités')).toBeInTheDocument();
  expect(screen.getByText(/conservé faute de\s+règlement/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/nous\s+annulons/);
  unmount();
  window.matchMedia = media(false);
  renderPage();
  expect(await screen.findByText('Indemnités d\'annulation')).toBeInTheDocument();
});
