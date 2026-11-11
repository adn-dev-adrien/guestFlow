// specs/plugins-phase-1-sdk.md rules 13, 49 (specs/guest-app.md rule 22) — `resources.fields` keeps its inline blocks
// under « Horaires » and gains the `section` kind: a section of its own, last, saved after the resource.
import React, { useEffect } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';
import api from '../../../api';
import ResourceEditorPanel from '../ResourceEditorPanel';

const slots = vi.hoisted(() => ({ list: [] }));
vi.mock('../../../plugins/sdk/useSlot', () => ({ useSlot: (name) => (name === 'resources.fields' ? slots.list : []) }));
vi.mock('../../../api', () => ({ default: { getResource: vi.fn(), createResource: vi.fn(), updateResource: vi.fn() } }));
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

const pluginSave = vi.fn();
function SectionFields({ itemId, kind, registerSave, onDirtyChange }) {
  useEffect(() => registerSave(pluginSave), [registerSave]);
  return <button type="button" onClick={() => onDirtyChange(true)}>{`Modifier ${kind} ${itemId}`}</button>;
}
const Inline = () => <span>Bloc horaire</span>;

const STORED = {
  id: 4, name: 'Bois', priceType: 'per_stay', basePrice: 15, quantity: 3, propertyIds: [1], propertyPricing: {},
};

function renderPanel() {
  const onSaved = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <DialogProvider>
          <ResourceEditorPanel open resourceId={4} properties={[{ id: 1, name: 'Granja' }]} onClose={vi.fn()} onSaved={onSaved} />
        </DialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
  return { onSaved };
}
const chips = () => within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button').map((b) => b.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  pluginSave.mockResolvedValue(undefined);
  api.getResource.mockResolvedValue(STORED);
  api.updateResource.mockResolvedValue({ ok: true });
});

test('an inline contribution stays under « Horaires », a section one comes last with its own title', async () => {
  slots.list = [
    { key: 'hourly', pluginId: 'demo', appliesTo: () => true, Component: Inline },
    { key: 'shop', pluginId: 'demo', section: { title: 'Boutique du plugin' }, Component: SectionFields },
  ];
  renderPanel();
  await screen.findByText('Bloc horaire');
  expect(chips()).toEqual(['Général', 'Prix', 'Horaires', 'Mails', 'Boutique du plugin']);
  expect(screen.getByRole('button', { name: 'Modifier resource 4' })).toBeInTheDocument();
});

test('a section change alone saves the plugin, not the resource', async () => {
  slots.list = [{ key: 'shop', pluginId: 'demo', section: { title: 'Boutique du plugin' }, Component: SectionFields }];
  const { onSaved } = renderPanel();
  await userEvent.click(await screen.findByRole('button', { name: 'Modifier resource 4' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(pluginSave).toHaveBeenCalledWith({ itemId: 4 }));
  expect(api.updateResource).not.toHaveBeenCalled();
  expect(onSaved).toHaveBeenCalledWith({ id: 4, isNew: false });
});
