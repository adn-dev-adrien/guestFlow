// specs/settings.md — the caption under a Paramètres page title says when the SETTINGS were saved. « Dernière mise à
// jour » read as the software's own update on Système, right above « Système et mises à jour » (shadow trial of 4.0.0).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import SettingsFormPage from '../SettingsFormPage';

const form = (overrides = {}) => ({
  isDirty: false, loading: false, saving: false, loadError: false, guardDialogOpen: false,
  updatedAtLabel: '22/09/2026 à 15:17', save: () => {}, cancel: () => {}, dismissGuard: () => {}, confirmLeave: () => {},
  ...overrides,
});

function renderPage(f) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <SettingsFormPage title="Système et mises à jour" form={f}><div>contenu</div></SettingsFormPage>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('a saved page captions « Réglages enregistrés le … », never « Dernière mise à jour »', () => {
  renderPage(form());
  expect(screen.getByText('Réglages enregistrés le 22/09/2026 à 15:17')).toBeTruthy();
  expect(screen.queryByText(/Dernière mise à jour/)).toBeNull();
});

test('unsaved changes replace the caption; a page never saved shows none', () => {
  const { unmount } = renderPage(form({ isDirty: true }));
  expect(screen.getByText('Modifications non enregistrées', { selector: 'span' })).toBeTruthy();
  expect(screen.queryByText(/Réglages enregistrés/)).toBeNull();
  unmount();
  renderPage(form({ updatedAtLabel: null }));
  expect(screen.queryByText(/Réglages enregistrés/)).toBeNull();
});
