// specs/integrations-tab-per-plugin.md rule 10 — a plugin disabled during the session takes its card's
// draft with it: the page stops being « modified » once no drawn card has a draft.
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../../theme';

let SECTIONS = [];
vi.mock('../../../plugins/sdk/useSlot', () => ({ __esModule: true, useSlot: () => SECTIONS }));
vi.mock('../../../components/DialogProvider', () => ({ __esModule: true, useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
vi.mock('../../../api', () => ({ __esModule: true, default: { getSettings: vi.fn(), getPlugins: vi.fn() } }));

import api from '../../../api';
import IntegrationsSettingsPage from '../IntegrationsSettingsPage';

function section(name) {
  return forwardRef(function Section({ onDirtyChange }, ref) {
    const [value, setValue] = useState('');
    useEffect(() => { onDirtyChange(value !== ''); }, [value, onDirtyChange]);
    useImperativeHandle(ref, () => ({ async save() {}, reset: () => setValue('') }));
    return <input aria-label={name} value={value} onChange={(e) => setValue(e.target.value)} />;
  });
}

const SITE = { pluginId: 'website-booking', key: 'website', order: 5, tabLabel: 'Site', Component: section('website') };
const NEAT = { pluginId: 'neat', key: 'neat', order: 20, tabLabel: 'Neat', Component: section('neat') };

const page = () => (
  <ThemeProvider theme={theme}>
    <MemoryRouter initialEntries={['/settings/integrations?tab=neat']}><IntegrationsSettingsPage /></MemoryRouter>
  </ThemeProvider>
);

beforeEach(() => {
  api.getSettings.mockResolvedValue({});
  api.getPlugins.mockResolvedValue([]);
  SECTIONS = [SITE, NEAT];
});

test('a still-dirty card of a plugin disabled during the session no longer keeps the page modified', async () => {
  const { rerender } = render(page());
  await userEvent.type(await screen.findByLabelText('neat'), 'x');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled());

  SECTIONS = [SITE];
  rerender(page());

  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled());
  expect(screen.queryByLabelText('neat')).toBeNull();
});
