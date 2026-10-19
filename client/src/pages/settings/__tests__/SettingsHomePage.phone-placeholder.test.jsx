// specs/settings-rationalization.md rule 31 — the settings search's placeholder is short enough not to
// be clipped on a 390 px phone.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../../theme';

vi.mock('../../../api', () => ({ __esModule: true, default: { getSettingsSummary: vi.fn() } }));
vi.mock('../../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { roles: ['admin'], enabledPlugins: ['online-payment'], supportAccessEnabled: false } }),
}));

import api from '../../../api';
import SettingsHomePage from '../SettingsHomePage';

function Where() {
  return <p>{`Ouvert : ${useLocation().pathname}`}</p>;
}

function draw(entry = '/settings') {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/settings" element={<SettingsHomePage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  api.getSettingsSummary.mockResolvedValue({
    lines: {
      '/properties': { text: '2 logements', tone: 'neutral' },
      '/settings/emails': { text: 'Envoi non configuré', tone: 'warning' },
      '/parametres/paiements': { text: 'À configurer', tone: 'warning' },
    },
  });
});


test('rule 31: the search placeholder fits a 390 px phone and still suggests words', async () => {
  draw();
  const field = await screen.findByRole('searchbox', { name: 'Chercher un réglage' });
  const placeholder = field.getAttribute('placeholder');
  expect(placeholder).toBe('Chercher : wifi, iban, smtp…');
  // 16 px Inter averages ~8 px a character: the field's 300 px of text room holds 30 characters.
  expect(placeholder.length).toBeLessThanOrEqual(30);
});
