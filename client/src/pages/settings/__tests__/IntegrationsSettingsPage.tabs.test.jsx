// specs/integrations-tab-per-plugin.md rules 1–7 and 9–12 — Paramètres › Intégrations draws one tab
// per plugin from the `settings.integrations` contributions, names the open tab in the URL, keeps a
// draft across a switch and saves every dirty tab, stopping on the first refusal.
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../../theme';

const toast = { showSuccess: vi.fn(), showError: vi.fn() };
let SECTIONS = [];
vi.mock('../../../plugins/sdk/useSlot', () => ({ __esModule: true, useSlot: () => SECTIONS }));
vi.mock('../../../components/DialogProvider', () => ({ __esModule: true, useToast: () => toast }));
vi.mock('../../../api', () => ({ __esModule: true, default: { getSettings: vi.fn(), getPlugins: vi.fn() } }));

import api from '../../../api';
import IntegrationsSettingsPage from '../IntegrationsSettingsPage';

const mounts = {};
const saves = {};

// A section with one field and a draft, saved by the bar through its ref (as Neat and Météo are).
function section(name, { refuse = false } = {}) {
  const Section = forwardRef(function Section({ onDirtyChange }, ref) {
    const [value, setValue] = useState('');
    useEffect(() => { mounts[name] = (mounts[name] || 0) + 1; }, []);
    useEffect(() => { onDirtyChange(value !== ''); }, [value, onDirtyChange]);
    useImperativeHandle(ref, () => ({
      async save() {
        if (refuse) throw new Error(`${name} refusé`);
        saves[name] = value;
        setValue('');
      },
      reset: () => setValue(''),
    }));
    return <input aria-label={name} value={value} onChange={(e) => setValue(e.target.value)} />;
  });
  return Section;
}

const contribution = (pluginId, key, order, extra = {}) => ({ pluginId, key, order, Component: section(key, extra), ...extra });

function Where() {
  const { search, hash } = useLocation();
  return <output aria-label="adresse">{`${search}${hash}`}</output>;
}

function draw(entry = '/settings/integrations') {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/settings/integrations" element={<><IntegrationsSettingsPage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const address = () => screen.getByLabelText('adresse').textContent;

beforeEach(() => {
  Object.keys(mounts).forEach((k) => { delete mounts[k]; });
  Object.keys(saves).forEach((k) => { delete saves[k]; });
  toast.showSuccess.mockClear();
  toast.showError.mockClear();
  api.getSettings.mockResolvedValue({});
  api.getPlugins.mockResolvedValue([
    { id: 'website-booking', name: 'Réservation depuis le site', setup: { needed: false } },
    { id: 'google-calendar', name: 'Google Agenda', setup: { needed: true } },
    { id: 'neat', name: 'Assurance annulation Neat', setup: { needed: false } },
    { id: 'gate-access', name: 'Accès au portail (Sowel)', setup: { needed: false } },
  ]);
  SECTIONS = [
    contribution('website-booking', 'website', 5, { tabLabel: 'Site' }),
    contribution('google-calendar', 'google', 10, { tabLabel: 'Google Agenda' }),
    contribution('neat', 'neat', 20, { tabLabel: 'Neat' }),
    contribution('gate-access', 'gate', 40),
    contribution('gate-access', 'gate-keys', 45),
  ];
});

test('rules 1, 2 and 4: one tab per plugin, in the bar, short labels or the catalogue name', async () => {
  draw();
  const list = await screen.findByRole('tablist', { name: 'Intégrations' });
  expect(list.closest('[data-sticky-bar]')).not.toBeNull();
  const tabs = within(list).getAllByRole('tab').map((t) => t.textContent);
  expect(tabs[0]).toBe('Site');
  expect(tabs.slice(1, 3).map((t) => t.replace(/(à configurer|modifié|refusé)$/, ''))).toEqual(['Google Agenda', 'Neat']);
  await waitFor(() => expect(within(list).getAllByRole('tab')[3]).toHaveTextContent('Accès au portail (Sowel)'));

  await userEvent.click(within(list).getAllByRole('tab')[3]);
  const panel = screen.getByRole('tabpanel', { name: 'Accès au portail (Sowel)' });
  expect(within(panel).getByLabelText('gate')).toBeInTheDocument();
  expect(within(panel).getByLabelText('gate-keys')).toBeInTheDocument();
});

test('rule 3: a single plugin draws no tab strip', async () => {
  SECTIONS = [contribution('neat', 'neat', 20, { tabLabel: 'Neat' })];
  draw('/settings/integrations?tab=neat');
  expect(await screen.findByLabelText('neat')).toBeVisible();
  expect(screen.queryByRole('tablist')).toBeNull();
  await waitFor(() => expect(address()).toBe(''));
});

test('rule 5: ?tab= opens its tab, and a click names the new one', async () => {
  draw('/settings/integrations?tab=neat');
  expect(await screen.findByRole('tab', { name: /^Neat/ })).toHaveAttribute('aria-selected', 'true');
  expect(address()).toBe('?tab=neat');

  await userEvent.click(screen.getByRole('tab', { name: /^Site/ }));
  expect(address()).toBe('?tab=website-booking');
});

test('rule 5: an unknown or inactive tab opens the first one', async () => {
  draw('/settings/integrations?tab=weather-alerts');
  expect(await screen.findByRole('tab', { name: /^Site/ })).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => expect(address()).toBe('?tab=website-booking'));
});

test('rule 6: the old #plugin-<id> anchor opens that tab and becomes ?tab=', async () => {
  draw('/settings/integrations#plugin-neat');
  expect(await screen.findByRole('tab', { name: /^Neat/ })).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => expect(address()).toBe('?tab=neat'));
});

test('rule 7: the Google OAuth return opens the Google tab and keeps its parameter', async () => {
  draw('/settings/integrations?google=connected');
  expect(await screen.findByRole('tab', { name: /^Google Agenda/ })).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => expect(address()).toBe('?google=connected&tab=google-calendar'));
});

test('rule 9: a section mounts at the first opening of its tab, then stays mounted', async () => {
  draw();
  await screen.findByLabelText('website');
  expect(mounts.neat).toBeUndefined();
  await userEvent.click(screen.getByRole('tab', { name: /^Neat/ }));
  await screen.findByLabelText('neat');
  await userEvent.click(screen.getByRole('tab', { name: /^Site/ }));
  await userEvent.click(screen.getByRole('tab', { name: /^Neat/ }));
  expect(mounts.neat).toBe(1);
});

test('rule 10: a draft survives a tab switch and its tab says « modifié »', async () => {
  draw('/settings/integrations?tab=neat');
  await userEvent.type(await screen.findByLabelText('neat'), '4,5');
  await userEvent.click(screen.getByRole('tab', { name: /^Site/ }));
  expect(within(screen.getByRole('tab', { name: /^Neat/ })).getByLabelText('modifié')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: /^Neat/ }));
  expect(screen.getByLabelText('neat')).toHaveValue('4,5');
});

test('rule 10: Save runs every dirty tab in order and stops on the first refusal, which opens', async () => {
  SECTIONS = [
    contribution('website-booking', 'website', 5, { tabLabel: 'Site' }),
    contribution('neat', 'neat', 20, { tabLabel: 'Neat', refuse: true }),
    contribution('gate-access', 'gate', 40, { tabLabel: 'Portail' }),
  ];
  draw('/settings/integrations?tab=website-booking');
  await userEvent.type(await screen.findByLabelText('website'), 'https://exemple.fr');
  await userEvent.click(screen.getByRole('tab', { name: /^Neat/ }));
  await userEvent.type(await screen.findByLabelText('neat'), 'x');
  await userEvent.click(screen.getByRole('tab', { name: /^Portail/ }));
  await userEvent.type(await screen.findByLabelText('gate'), 'y');

  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(screen.getByRole('tab', { name: /^Neat/ })).toHaveAttribute('aria-selected', 'true'));
  expect(address()).toBe('?tab=neat');
  expect(within(screen.getByRole('tab', { name: /^Neat/ })).getByLabelText('refusé')).toBeInTheDocument();
  expect(saves).toEqual({ website: 'https://exemple.fr' });
  expect(screen.getByLabelText('gate')).toHaveValue('y');
  expect(toast.showError).toHaveBeenCalledWith('neat refusé');
});

test('rule 10: Cancel resets every tab', async () => {
  draw('/settings/integrations?tab=neat');
  await userEvent.type(await screen.findByLabelText('neat'), 'x');
  await userEvent.click(screen.getByRole('tab', { name: /^Site/ }));
  await userEvent.type(await screen.findByLabelText('website'), 'y');
  await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(screen.getByLabelText('website')).toHaveValue('');
  expect(screen.getByLabelText('neat', { selector: 'input' })).toHaveValue('');
});

test('rule 11: a plugin still to set up carries the amber dot; a modified tab shows « modifié » instead', async () => {
  draw('/settings/integrations?tab=google-calendar');
  const google = await screen.findByRole('tab', { name: /^Google Agenda/ });
  await waitFor(() => expect(within(google).getByLabelText('à configurer')).toBeInTheDocument());
  expect(within(screen.getByRole('tab', { name: /^Neat/ })).queryByLabelText('à configurer')).toBeNull();
  await userEvent.type(screen.getByLabelText('google'), 'z');
  expect(within(google).getByLabelText('modifié')).toBeInTheDocument();
  expect(within(google).queryByLabelText('à configurer')).toBeNull();
});

test('rule 12: the arrow keys move between tabs', async () => {
  draw('/settings/integrations?tab=website-booking');
  const site = await screen.findByRole('tab', { name: /^Site/ });
  act(() => site.focus());
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: /^Google Agenda/ })).toHaveFocus();
});
