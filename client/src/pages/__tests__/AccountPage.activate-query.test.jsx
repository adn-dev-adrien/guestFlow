// specs/hosting-h2-account-security.md rule 51 — `/mon-compte?activer=deux-etapes` (the dashboard card's
// « Activer ») opens the activation dialog at step 1 and the query is removed from the address.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import { STATUS_OFF } from '../../components/__tests__/twoFactorFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    listUsers: vi.fn(), updateSelf: vi.fn(), getMyEmailStatus: vi.fn(), getTwoFactorStatus: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import AccountPage from '../AccountPage';

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

test('rule 51: the query opens step 1 of the activation and is dropped from the address', async () => {
  api.getMyEmailStatus.mockResolvedValue({ myEmail: null, defaultStillUsed: false });
  api.getTwoFactorStatus.mockResolvedValue(STATUS_OFF);
  useAuth.mockReturnValue({ user: { id: 1, email: 'marie@x.fr', roles: ['admin'] }, changePassword: vi.fn(), refresh: vi.fn() });
  render(
    <MemoryRouter initialEntries={['/mon-compte?activer=deux-etapes']}>
      <ThemeProvider theme={theme}><DialogProvider><AccountPage /><Where /></DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText('Étape 1 sur 3')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/mon-compte'));
});
