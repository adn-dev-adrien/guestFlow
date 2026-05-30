import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Regression guard against the legacy PageHeader → PageActionBar migration: the page used to pass
// an `actions={<Button>}` prop that the old PageHeader silently dropped, so the "Nouveau devis"
// button never rendered. The test below pins both the visibility AND the click → /reservations/new
// navigation behaviour.

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('../../api', () => ({
  __esModule: true,
  default: {
    getDevis: jest.fn(),
    deleteDevis: jest.fn(),
    convertDevisToReservation: jest.fn(),
    getDevisPdfBlob: jest.fn(),
  },
}));

jest.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({
    confirm: jest.fn().mockResolvedValue(false),
    alert: jest.fn().mockResolvedValue(undefined),
  }),
}));

import api from '../../api';
import DevisPage from '../DevisPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <DevisPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  api.getDevis.mockReset();
  api.getDevis.mockResolvedValue([]);
});

describe('DevisPage — "Nouveau devis" button', () => {
  test('the create button is visible in the page action bar', async () => {
    renderPage();
    // The button label is rendered (not collapsed to an icon-only IconButton).
    expect(await screen.findByRole('button', { name: /Nouveau devis/i })).toBeInTheDocument();
  });

  test('clicking the create button navigates to /reservations/new?mode=devis', async () => {
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole('button', { name: /Nouveau devis/i });

    await user.click(button);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/reservations/new?mode=devis');
  });

  test('the create button is reachable even while the devis list is loading', async () => {
    // Hold the API in a pending state.
    let resolveList;
    api.getDevis.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve; }));

    renderPage();
    // Button visible immediately — not gated by the list fetch.
    expect(screen.getByRole('button', { name: /Nouveau devis/i })).toBeInTheDocument();

    // Resolve the API to let the page settle without dangling promises in the test.
    resolveList([]);
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });
});
