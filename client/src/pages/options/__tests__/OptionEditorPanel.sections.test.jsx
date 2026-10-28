// specs/options-resources-ux.md rules 12, 13, 17 — the option editor panel: sections in order, section chips,
// footer states, save and the unsaved-changes guard.
import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../../api';
import { renderEditor, storedOption } from './optionEditorFixtures';

vi.mock('../../../api', () => ({
  default: { getOption: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(), getOptionPropertyDefaults: vi.fn() },
}));
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getOption.mockResolvedValue(storedOption());
  api.createOption.mockResolvedValue({ id: 99 });
  api.updateOption.mockResolvedValue({ ok: true });
});

const chips = () => within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button').map((b) => b.textContent);

test('rule 13: an existing option opens under its name with the sections in order', async () => {
  renderEditor();
  expect(await screen.findByRole('heading', { name: 'Ménage' })).toBeInTheDocument();
  expect(api.getOption).toHaveBeenCalledWith(7);
  expect(chips()).toEqual(['Général', 'Logements et prix', 'Planning', 'Visibilité']);
  const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(headings).toEqual(['Général', 'Logements et prix', 'Planning', 'Visibilité']);
});

test('rule 13: a system (auto) option has no Planning section', async () => {
  api.getOption.mockResolvedValue(storedOption({ title: 'Départ tardif', autoOptionType: 'late_check_out' }));
  renderEditor();
  await screen.findByRole('heading', { name: 'Départ tardif' });
  expect(chips()).toEqual(['Général', 'Logements et prix', 'Visibilité']);
});

test('rule 12: a new option opens empty, with every property proposed and the active category filled in', async () => {
  renderEditor({ optionId: null, props: { initialCategory: 'Boissons' } });
  expect(await screen.findByRole('heading', { name: 'Nouvelle option' })).toBeInTheDocument();
  expect(api.getOption).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Catégorie')).toHaveValue('Boissons');
  expect(screen.getByRole('checkbox', { name: /Toujours visible/ })).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Proposée · Granja' })).toBeChecked();
  expect(screen.getByRole('switch', { name: 'Proposée · Estiva' })).toBeChecked();
});

test('rule 17: nothing changed → Enregistrer is disabled; an edit enables it and the footer says « Modifié »', async () => {
  const user = userEvent.setup();
  renderEditor();
  await screen.findByRole('heading', { name: 'Ménage' });
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await user.type(screen.getByLabelText(/^Description/), '!');
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  expect(screen.getByText('Modifié')).toBeInTheDocument();
});

test('rule 17: saving an existing option sends the payload and hands the id to the page', async () => {
  const user = userEvent.setup();
  const { onSaved } = renderEditor();
  await screen.findByRole('heading', { name: 'Ménage' });
  await user.clear(screen.getByLabelText(/^Nom/));
  await user.type(screen.getByLabelText(/^Nom/), 'Ménage final');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(api.updateOption).toHaveBeenCalledWith(7, expect.objectContaining({ title: 'Ménage final', price: 30, propertyIds: [1, 2] }));
  expect(onSaved).toHaveBeenCalledWith({ id: 7, isNew: false });
});

test('rule 17: saving a new option creates it and says it is new', async () => {
  const user = userEvent.setup();
  const { onSaved } = renderEditor({ optionId: null });
  await user.type(await screen.findByLabelText(/^Nom/), 'Vélo');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(api.createOption).toHaveBeenCalledWith(expect.objectContaining({ title: 'Vélo', priceType: 'per_stay', propertyIds: [1, 2] }));
  expect(onSaved).toHaveBeenCalledWith({ id: 99, isNew: true });
});

test('rule 17: an invalid field disables saving, is counted in the footer and flags its section chip', async () => {
  const user = userEvent.setup();
  renderEditor({ optionId: null });
  await user.type(await screen.findByLabelText(/^Nom/), 'Vélo');
  await user.clear(screen.getByLabelText('Prix de base'));
  await user.type(screen.getByLabelText('Prix de base'), '-4');
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  expect(screen.getByText('1 champ à corriger')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Logements et prix' })).toHaveAttribute('data-has-error', 'true');
  expect(screen.getByRole('button', { name: 'Général' })).not.toHaveAttribute('data-has-error');
});

test('rule 17: closing with unsaved changes asks first; discarding closes without a request', async () => {
  const user = userEvent.setup();
  const { onClose } = renderEditor();
  await screen.findByRole('heading', { name: 'Ménage' });
  await user.type(screen.getByLabelText(/^Description/), '!');
  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(api.updateOption).not.toHaveBeenCalled();
});

test('a failed load shows the error with « Réessayer », which loads again', async () => {
  const user = userEvent.setup();
  api.getOption.mockRejectedValueOnce(new Error('down'));
  renderEditor();
  await user.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByRole('heading', { name: 'Ménage' })).toBeInTheDocument();
  expect(api.getOption).toHaveBeenCalledTimes(2);
});

test('a long name wraps in the header instead of being cut', async () => {
  const name = 'Une option au nom démesurément long '.repeat(4).trim();
  api.getOption.mockResolvedValue(storedOption({ title: name }));
  renderEditor();
  expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
});
