// Audit R5 (2026-10-30), specs/ui-review-2026-10-19-operations.md rule 39 — a slow answer for a logement already left never replaces the catalogue shown.
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import api from '../../api';
import OptionsPage from '../OptionsPage';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));
vi.mock('../../api', () => ({
  default: { getOptionsCatalogueView: vi.fn(), getProperties: vi.fn() },
}));

const view = (title) => ({
  total: 1,
  chips: [{ key: 'none', label: 'Sans catégorie', count: 1 }],
  groups: [{ key: 'none', label: 'Sans catégorie', count: 1, items: [{ id: 1, title, description: '', category: '', price: { value: '10 €', unit: '/ séjour', note: '' }, traits: [], archivable: true, archiveBlockedReason: '' }] }],
  archived: [],
});

test('the late catalogue of the logement left is dropped', async () => {
  let finishGranja;
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }, { id: 2, name: 'Estiva' }]);
  api.getOptionsCatalogueView.mockImplementation((filter) => (filter === 1 || filter === '1'
    ? new Promise((resolve) => { finishGranja = resolve; })
    : Promise.resolve(view('Option de tous'))));
  render(
    <ThemeProvider theme={theme}><MemoryRouter><DialogProvider><OptionsPage barTabs={<div>tabs</div>} /></DialogProvider></MemoryRouter></ThemeProvider>,
  );
  await screen.findByRole('button', { name: 'Option de tous' });
  await userEvent.click(await screen.findByRole('button', { name: 'Granja' }));
  await userEvent.click(screen.getByRole('button', { name: /Tous/ }));
  await screen.findByRole('button', { name: 'Option de tous' });
  await act(async () => { finishGranja(view('Option Granja')); });
  expect(screen.queryByRole('button', { name: 'Option Granja' })).not.toBeInTheDocument();
});
