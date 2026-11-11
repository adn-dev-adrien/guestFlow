// specs/settings-rationalization.md rules 24–27 (UI/UX review 2026-10-18, proposal 20, decision 12) —
// `/settings` is the summary: four groups, one row per page with the server's state line, a search
// that understands wifi / iban / smtp / 2fa, and an empty state that suggests words.
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

test('rule 24: four groups with their pages, the plugin pages only while live', async () => {
  draw();
  const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(titles).toEqual(['Établissement', 'Séjours', 'Paiements et emails', 'Compte et système']);
  const pay = screen.getByRole('region', { name: 'Paiements et emails' });
  expect(within(pay).getByRole('link', { name: /Paiements en ligne/ })).toBeInTheDocument();
  expect(within(pay).getByRole('link', { name: /Textes des emails/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Recettes tarifaires/ })).toBeNull();
  expect(screen.getByRole('link', { name: /Mon compte/ })).toBeInTheDocument();
});

test('rule 25: each row carries the server’s state line', async () => {
  draw();
  expect(await screen.findByText('2 logements')).toBeInTheDocument();
  expect(screen.getByText('Envoi non configuré')).toBeInTheDocument();
});

test('rule 27: « wifi » finds Logements and says why; « zzz » says nothing matches', async () => {
  draw();
  const search = screen.getByRole('searchbox', { name: 'Chercher un réglage' });
  await userEvent.type(search, 'wifi');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /Logements/ })).toHaveTextContent('Contient : Wi-Fi');
  await userEvent.clear(search);
  await userEvent.type(search, 'smtp');
  expect(screen.getByRole('link', { name: /Emails & notifications/ })).toBeInTheDocument();
  await userEvent.clear(search);
  await userEvent.type(search, '2fa');
  expect(screen.getByRole('link', { name: /Mon compte/ })).toBeInTheDocument();
  await userEvent.clear(search);
  await userEvent.type(search, 'zzz');
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByText('Aucun réglage pour « zzz »')).toBeInTheDocument();
});

test('rule 24: a row opens its page; #group scrolls to that group', async () => {
  draw('/settings#sejours');
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('link', { name: /Logements/ }));
  expect(screen.getByText('Ouvert : /properties')).toBeInTheDocument();
});
