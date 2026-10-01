import { vi } from 'vitest';
/**
 * specs/plugins-phase-2-hosts.md rule 19 — the accounting export fills the `finance.menu` slot
 * (Comptabilité, Plan comptable) and `settings.platforms.links`; the core keeps « Indemnités
 * d'annulation » (rule 21), and the accountant's finance entries go with the plugin (rule 3).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

let livePlugins = [];
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: (id) => livePlugins.includes(id) }));

import { FINANCE_MENU, financeMenu, canSeeFinanceEntry, isFinancePath } from '../../../constants/financeMenu';
import Slot from '../../sdk/Slot';
import accountingExport from '..';

const ID = 'accounting-export';
const visible = (user) => FINANCE_MENU.filter((e) => canSeeFinanceEntry(user, e)).map((e) => e.label);

test('specs/plugins-phase-2-hosts.md rule 19 — finance.menu ranks the contributed entries after the core ones', () => {
  expect(financeMenu([accountingExport]).map((e) => e.path)).toEqual([
    '/finance', '/finance/tourist-tax', '/finance/indemnites', '/comptabilite', '/comptabilite/plateformes',
  ]);
  expect(financeMenu([]).map((e) => e.key)).toEqual(['overview', 'tourist-tax', 'compensations']);
  const late = { id: 'probe', contributes: { 'finance.menu': [{ key: 'p', path: '/finance/probe', label: 'Probe', order: 25 }] } };
  expect(financeMenu([late]).map((e) => e.key)).toEqual(['overview', 'tourist-tax', 'p', 'compensations']);
  expect(isFinancePath('/comptabilite/plateformes')).toBe(true);
  expect(isFinancePath('/finance/indemnites')).toBe(true);
  expect(isFinancePath('/planning')).toBe(false);
});

test('specs/plugins-phase-2-hosts.md rule 19 — the admin sees Comptabilité and Plan comptable only while the plugin is active', () => {
  expect(visible({ roles: ['admin'], enabledPlugins: [ID] })).toEqual([
    'Vue générale', 'Taxe de séjour', "Indemnités d'annulation", 'Comptabilité', 'Plan comptable',
  ]);
  expect(visible({ roles: ['admin'], enabledPlugins: [] })).toEqual([
    'Vue générale', 'Taxe de séjour', "Indemnités d'annulation",
  ]);
});

test('specs/plugins-phase-2-hosts.md rule 3 — the accountant sees the compensations and the export while it is live, nothing without it', () => {
  expect(visible({ roles: ['accountant'], enabledPlugins: [ID] })).toEqual([
    "Indemnités d'annulation", 'Comptabilité', 'Plan comptable',
  ]);
  expect(visible({ roles: ['accountant'], enabledPlugins: [] })).toEqual([]);
});

test('specs/plugins-phase-2-hosts.md rule 19 — the « Plan comptable » links of the settings pages come from the plugin', async () => {
  livePlugins = [ID];
  const { unmount } = render(<MemoryRouter><Slot name="settings.platforms.links" page="vat" /></MemoryRouter>);
  const link = await screen.findByRole('link', { name: 'Plan comptable' }, { timeout: 5000 });
  expect(link).toHaveAttribute('href', '/comptabilite/plateformes');
  expect(screen.getByText(/indemnités d'annulation se règlent/)).toBeInTheDocument();
  unmount();

  livePlugins = [];
  const { container } = render(<MemoryRouter><Slot name="settings.platforms.links" page="platforms" /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
