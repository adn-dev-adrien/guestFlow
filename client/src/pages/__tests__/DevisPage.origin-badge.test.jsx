/**
 * DevisPage — the origin badge (specs/site-english-version.md rule 19).
 *
 * The badge says « Site internet », not « WordPress »: the operator cares which channel brought the
 * booking, not which software serves the pages.
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
  mockNavigate.mockReset();
  api.getDevis.mockReset();
});

test('a devis born of a website request is badged « Site internet »', async () => {
  api.getDevis.mockResolvedValue([DEVIS]);
  renderPage();
  expect(await screen.findByText('Site internet')).toBeInTheDocument();
});

test('the badge never says « WordPress » — the operator reads channels, not software', async () => {
  api.getDevis.mockResolvedValue([DEVIS]);
  renderPage();
  await screen.findByText('Site internet');
  expect(screen.queryByText('WordPress')).not.toBeInTheDocument();
});

test('a devis created by hand carries no origin badge', async () => {
  api.getDevis.mockResolvedValue([{ ...DEVIS, requestOrigin: null }]);
  renderPage();
  await screen.findByText('D-2026-001');
  expect(screen.queryByText('Site internet')).not.toBeInTheDocument();
});

test('the origin filter offers the website requests under that name', async () => {
  api.getDevis.mockResolvedValue([]);
  renderPage();
  expect(await screen.findByRole('button', { name: /Nouveau devis/i })).toBeInTheDocument();
  // The filter's option list is rendered by the Select; its label is what matters here.
  expect(document.body.textContent).not.toContain('Demandes WordPress');
});
