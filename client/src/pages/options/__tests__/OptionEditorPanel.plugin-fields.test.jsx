// specs/plugins-phase-1-sdk.md rule 13 (specs/guest-app.md rule 22) — the option editor's `options.fields` slot,
// mirroring `resources.fields`: nothing without a live contribution; a contribution with a `section` gets its own
// section at the bottom, counts in « Enregistrer » and the guard, and is saved after the option.
import React, { useEffect } from 'react';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../../api';
import { renderEditor, storedOption } from './optionEditorFixtures';

const slots = vi.hoisted(() => ({ list: [] }));
vi.mock('../../../plugins/sdk/useSlot', () => ({ useSlot: (name) => (name === 'options.fields' ? slots.list : []) }));
vi.mock('../../../api', () => ({
  default: { getOption: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(), getOptionPropertyDefaults: vi.fn() },
}));
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

const pluginSave = vi.fn();

function PluginFields({ itemId, registerSave, onDirtyChange }) {
  useEffect(() => registerSave(pluginSave), [registerSave]);
  return (
    <div>
      <span>{`Article ${itemId}`}</span>
      <button type="button" onClick={() => onDirtyChange(true)}>Modifier le plugin</button>
    </div>
  );
}

const contribution = { key: 'shop', pluginId: 'demo', section: { title: 'Boutique du plugin' }, Component: PluginFields };
const chips = () => within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button').map((b) => b.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  slots.list = [];
  pluginSave.mockResolvedValue(undefined);
  api.getOption.mockResolvedValue(storedOption());
  api.updateOption.mockResolvedValue({ ok: true });
});

test('without a live contribution the editor has no plugin section', async () => {
  renderEditor();
  await screen.findByRole('heading', { name: 'Ménage' });
  expect(chips()).toEqual(['Général', 'Logements et prix', 'Planning', 'Visibilité']);
});

test('a contribution with a section is drawn last, with its chip, and receives the option id', async () => {
  slots.list = [contribution];
  renderEditor();
  await screen.findByRole('heading', { name: 'Ménage' });
  expect(chips()).toEqual(['Général', 'Logements et prix', 'Planning', 'Visibilité', 'Boutique du plugin']);
  const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(headings[headings.length - 1]).toBe('Boutique du plugin');
  expect(await screen.findByText('Article 7')).toBeInTheDocument();
});

test('a plugin change alone enables « Enregistrer »; the option is not rewritten, the plugin saves', async () => {
  slots.list = [contribution];
  const { onSaved } = renderEditor();
  await screen.findByText('Article 7');
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Modifier le plugin' }));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  await waitFor(() => expect(pluginSave).toHaveBeenCalledWith({ itemId: 7 }));
  expect(api.updateOption).not.toHaveBeenCalled();
  expect(onSaved).toHaveBeenCalledWith({ id: 7, isNew: false });
});

test('both changed: the option first, then the plugin; a plugin refusal keeps the panel open with its message', async () => {
  slots.list = [contribution];
  pluginSave.mockRejectedValue(new Error('Boutique : refusé'));
  const { onSaved } = renderEditor();
  await screen.findByText('Article 7');
  await userEvent.type(screen.getByLabelText(/Nom/), ' complet');
  await userEvent.click(screen.getByRole('button', { name: 'Modifier le plugin' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateOption).toHaveBeenCalled());
  await waitFor(() => expect(pluginSave).toHaveBeenCalled());
  expect(api.updateOption.mock.invocationCallOrder[0]).toBeLessThan(pluginSave.mock.invocationCallOrder[0]);
  expect(await screen.findByText('Boutique : refusé')).toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
});
