// specs/plugin-operator-provisioning.md rules 10–12, 14, 22 — the details an operator feels: a refusal
// and a failure read red, only the failed part of the header; a stale wait is a warning; the switch
// keeps its focus while it saves and has a 44 px target; the erase dialog takes the slug at once and
// Enter confirms; the folded group does not animate under « reduce motion ».
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import ModulesSection from '../components/ModulesSection';
import api from '../api';
import { renderAt } from './consoleFixtures';
import { line, modulesView } from './modulesFixtures';

vi.mock('../api', () => ({ default: { customerModules: vi.fn(), toggleModule: vi.fn(), retryModules: vi.fn(), eraseModule: vi.fn() } }));

const open = () => renderAt(<ModulesSection customerId={3} slug="moulin" />);
const colour = (el) => getComputedStyle(el).color;

beforeEach(() => {
  vi.clearAllMocks();
  api.customerModules.mockResolvedValue(modulesView());
});

it('rule 11 — a refusal is red, the header stays secondary except the failed count', async () => {
  api.customerModules.mockResolvedValue(modulesView({
    header: '1 actif · 1 en échec',
    headerParts: [{ text: '1 actif', tone: null }, { text: '1 en échec', tone: 'error' }],
    counts: { active: 1, toConfigure: 0, failed: 1, blocked: 0 },
  }));
  api.toggleModule.mockRejectedValue(Object.assign(new Error('Nécessite Linge : à activer d’abord.'), { status: 422 }));
  open();
  const failed = await screen.findByText('1 en échec');
  const active = screen.getByText('1 actif');
  expect(colour(failed)).not.toBe(colour(active));
  expect(colour(failed)).toMatch(/rgb\(\s*(2\d\d|1[5-9]\d)/);
  fireEvent.click(await screen.findByRole('switch', { name: 'Vacances scolaires' }));
  const alert = await screen.findByRole('alert');
  expect(colour(alert)).toBe(colour(failed));
  expect(screen.getByRole('switch', { name: 'Vacances scolaires' })).toHaveAccessibleDescription(/Nécessite Linge/);
});

it('rule 14 — a wait that lasts is a warning badge, a short one is informative', async () => {
  api.customerModules.mockResolvedValue(modulesView({
    included: [
      line({ id: 'a', name: 'Alpha', state: 'pending', stateLabel: 'En attente', detail: 'L’espace lit la licence…' }),
      line({ id: 'b', name: 'Bravo', state: 'pending', stateLabel: 'En attente', detail: 'Depuis 6 min — espace injoignable ?', stale: true }),
    ],
  }));
  open();
  const badges = await screen.findAllByText('En attente');
  const bg = (el) => getComputedStyle(el.closest(".MuiChip-root")).backgroundColor;
  expect(bg(badges[1])).not.toBe(bg(badges[0]));
});

it('rule 12 — the switch being saved keeps the focus and ignores a second click; the others wait', async () => {
  let finish;
  api.toggleModule.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  open();
  const sw = await screen.findByRole('switch', { name: 'Vacances scolaires' });
  sw.focus();
  fireEvent.click(sw);
  await waitFor(() => expect(sw).toHaveAttribute('aria-busy', 'true'));
  expect(sw).not.toBeDisabled();
  expect(document.activeElement).toBe(sw);
  fireEvent.click(sw);
  expect(api.toggleModule).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('switch', { name: 'Linge et blanchisserie' })).toBeDisabled();
  finish(modulesView());
  await waitFor(() => expect(sw).toHaveAttribute('aria-busy', 'false'));
  expect(screen.getByRole('switch', { name: 'Linge et blanchisserie' })).not.toBeDisabled();
});

it('rule 12 — the switch is 44 px tall and clips its hidden input so it never covers « Plus d’actions »', async () => {
  api.customerModules.mockResolvedValue(modulesView({
    included: [line({ on: false, state: 'inactive', stateLabel: 'Inactif', canErase: true, eraseLines: ['3 pièces de stock'], eraseWarnings: [] })],
  }));
  open();
  const sw = await screen.findByRole('switch', { name: 'Linge et blanchisserie' });
  const root = sw.closest('.MuiSwitch-root');
  expect(getComputedStyle(root).height).toBe('44px');
  expect(getComputedStyle(root).overflow).toBe('hidden');
  expect(root.contains(sw)).toBe(true);
  expect(root.contains(screen.getByRole('button', { name: 'Plus d’actions pour Linge et blanchisserie' }))).toBe(false);
});

it('rule 22 — the erase dialog focuses the slug field, and Enter erases once the slug matches', async () => {
  api.customerModules.mockResolvedValue(modulesView({
    included: [line({ on: false, state: 'inactive', stateLabel: 'Inactif', canErase: true, eraseLines: ['3 pièces de stock'], eraseWarnings: [] })],
  }));
  api.eraseModule.mockResolvedValue(modulesView());
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Plus d’actions pour Linge et blanchisserie' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Effacer les données…' }));
  const field = await screen.findByLabelText('Pour confirmer, tapez « moulin »');
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.change(field, { target: { value: 'moul' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(api.eraseModule).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: 'moulin' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  await waitFor(() => expect(api.eraseModule).toHaveBeenCalledWith(3, 'linen', 'moulin'));
});

it('rule 10 — the « Hors forfait » group opens without animation under « reduce motion »', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query) => ({ matches: /prefers-reduced-motion/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Hors forfait/ }));
    const list = await screen.findByRole('list', { name: 'Modules hors forfait' });
    expect(getComputedStyle(list.closest('.MuiCollapse-root')).transitionDuration).toBe('0ms');
  } finally {
    window.matchMedia = original;
  }
  expect(within(document.body).getByRole('list', { name: 'Modules hors forfait' })).toBeInTheDocument();
});
