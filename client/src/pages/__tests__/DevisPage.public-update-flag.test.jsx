/**
 * DevisPage — « Modifiée par le client après envoi » (specs/public-request-abuse-and-grouping.md
 * rule 14): a website quote the guest changed after the operator sent it says so in the list.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router', async () => ({
  __esModule: true,
  ...(await vi.importActual('react-router')),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getDevis: vi.fn(),
    deleteDevis: vi.fn(),
    convertDevisToReservation: vi.fn(),
    getDevisPdfBlob: vi.fn(),
  },
}));

vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({
    confirm: vi.fn().mockResolvedValue(false),
    alert: vi.fn().mockResolvedValue(undefined),
  }),
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

import api from '../../api';
import DevisPage from '../DevisPage';

// Every plugin active — the Solio configuration these tests describe (specs/plugins-phase-0-foundation.md).
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));

const DEVIS = {
  id: 1,
  devisNumber: 'D-2026-001',
  devisStatus: 'draft',
  clientName: 'Ada Lovelace',
  lastName: 'Lovelace',
  firstName: 'Ada',
  propertyName: 'La Granja',
  startDate: '2026-07-10',
  endDate: '2026-07-13',
  finalPrice: 600,
  requestOrigin: 'public',
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DevisPage />
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.getDevis.mockReset();
});

test('a sent quote the guest changed is flagged', async () => {
  api.getDevis.mockResolvedValue([{ ...DEVIS, devisStatus: 'sent', status: 'sent', publicUpdatedAfterSendAt: '2026-10-27 10:00:00' }]);
  renderPage();
  expect((await screen.findAllByText('Modifiée par le client après envoi')).length).toBeGreaterThan(0);
});

test('without the stamp, no flag', async () => {
  api.getDevis.mockResolvedValue([{ ...DEVIS, publicUpdatedAfterSendAt: null }]);
  renderPage();
  await screen.findAllByText('D-2026-001');
  expect(screen.queryByText('Modifiée par le client après envoi')).not.toBeInTheDocument();
});
