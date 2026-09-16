import React, { createRef } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// specs/settings-one-save-and-automatic-webhook.md §3 rules 1, 2, 3 — the Neat card lost its three
// « Enregistrer » buttons. It now tells the page when it holds unsaved changes, and the page's
// action bar writes it through a ref.

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getNeatSettings: vi.fn(),
    updateNeatSettings: vi.fn(),
    testNeatConnection: vi.fn(),
    getNeatDiscovery: vi.fn(),
    updateNeatSelection: vi.fn(),
    updateNeatMapping: vi.fn(),
  },
}));

import api from '../../api';
import DialogProvider from '../DialogProvider';
import SettingsNeatSection from '../SettingsNeatSection';

import { CONFIGURED_SETTINGS } from './neatSectionFixtures';

function renderSection() {
  const ref = createRef();
  const onDirtyChange = vi.fn();
  render(
    <DialogProvider>
      <SettingsNeatSection ref={ref} onDirtyChange={onDirtyChange} />
    </DialogProvider>,
  );
  return { ref, onDirtyChange };
}

const lastDirty = (onDirtyChange) => onDirtyChange.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  api.getNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
});

// Rule 1 — the card carries no Save of its own any more.
test('rule 1: the card renders no Enregistrer button', async () => {
  renderSection();
  await screen.findByText('Connectée — staging');

  expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enregistrer la sélection' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enregistrer le mappage' })).not.toBeInTheDocument();
  // What reads, rather than writes, stays in the card.
  expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeInTheDocument();
});

// Rule 1 — the bar can only light up if the card says it has something to save.
test('rule 1: editing a field reports the card dirty, and saving reports it clean again', async () => {
  api.updateNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  const { ref, onDirtyChange } = renderSection();
  await screen.findByText('Connectée — staging');

  expect(lastDirty(onDirtyChange)).toBe(false);
  fireEvent.change(screen.getByLabelText('Identifiant client (clientId)'), { target: { value: 'svc-new' } });
  await waitFor(() => expect(lastDirty(onDirtyChange)).toBe(true));
  expect(ref.current.isDirty()).toBe(true);

  await act(async () => { await ref.current.save(); });
  await waitFor(() => expect(lastDirty(onDirtyChange)).toBe(false));
});

// Rule 2 — only the block that changed is posted, and the untouched secret stays out of the payload.
test('rule 2: save posts the credentials alone when only a credential changed', async () => {
  api.updateNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  const { ref } = renderSection();
  await screen.findByText('Connectée — staging');

  fireEvent.change(screen.getByLabelText('Identifiant client (clientId)'), { target: { value: 'svc-new' } });
  await act(async () => { await ref.current.save(); });

  expect(api.updateNeatSettings).toHaveBeenCalledTimes(1);
  expect(api.updateNeatSelection).not.toHaveBeenCalled();
  expect(api.updateNeatMapping).not.toHaveBeenCalled();
  const payload = api.updateNeatSettings.mock.calls[0][0];
  expect(payload.clientId).toBe('svc-new');
  expect(payload.marginPercent).toBe('30');
  expect('clientSecret' in payload).toBe(false);
});

// Rule 2 — nothing changed, nothing posted.
test('rule 2: saving an untouched card posts nothing at all', async () => {
  const { ref } = renderSection();
  await screen.findByText('Connectée — staging');

  await act(async () => { await ref.current.save(); });

  expect(api.updateNeatSettings).not.toHaveBeenCalled();
  expect(api.updateNeatSelection).not.toHaveBeenCalled();
  expect(api.updateNeatMapping).not.toHaveBeenCalled();
});

// Rule 2 — two blocks changed in one go: both written, in order.
test('rule 2: credentials and mapping edited together are both written, credentials first', async () => {
  api.updateNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  api.updateNeatMapping.mockResolvedValue(CONFIGURED_SETTINGS);
  const order = [];
  api.updateNeatSettings.mockImplementation(async () => { order.push('credentials'); return CONFIGURED_SETTINGS; });
  api.updateNeatMapping.mockImplementation(async () => { order.push('mapping'); return CONFIGURED_SETTINGS; });

  const { ref } = renderSection();
  await screen.findByText('Connectée — staging');

  fireEvent.change(screen.getByLabelText('Identifiant client (clientId)'), { target: { value: 'svc-new' } });
  fireEvent.change(screen.getByLabelText('Marge sur la prime Neat (%)'), { target: { value: '18' } });
  // Map the second, optional field so the mapping differs from the stored one.
  fireEvent.mouseDown(screen.getAllByLabelText('Source GuestFlow')[1]);
  fireEvent.click(screen.getByRole('option', { name: 'Nombre de nuits' }));

  await act(async () => { await ref.current.save(); });

  expect(order).toEqual(['credentials', 'mapping']);
});

// Rule 3 — a refusal keeps what the operator typed and flags the fields concerned.
test('rule 3: a 422 on the mapping is reported per field and leaves the typed values in place', async () => {
  api.getNeatSettings.mockResolvedValue({ ...CONFIGURED_SETTINGS, mapping: {} });
  const err = new Error('MAPPING_INVALID');
  err.code = 'MAPPING_INVALID';
  err.errors = [{ fieldId: 'f-nights', error: 'REQUIRED_UNMAPPED' }];
  api.updateNeatMapping.mockRejectedValue(err);
  api.updateNeatSettings.mockResolvedValue({ ...CONFIGURED_SETTINGS, mapping: {} });

  const { ref } = renderSection();
  await screen.findByText('Champs du contrat Neat');

  fireEvent.change(screen.getByLabelText('Identifiant client (clientId)'), { target: { value: 'svc-new' } });
  fireEvent.mouseDown(screen.getAllByLabelText('Source GuestFlow')[0]);
  fireEvent.click(screen.getByRole('option', { name: 'Nombre de nuits' }));

  // The page is told, so it can report it; the card shows which field is wrong.
  await act(async () => {
    await expect(ref.current.save()).rejects.toThrow(/Mappage Neat incomplet/);
  });

  expect(await screen.findByText('Champ requis non mappé.')).toBeInTheDocument();
  expect(screen.getByText('Mappage incomplet — corrige les champs signalés.')).toBeInTheDocument();
  // Rule 3: the block that was accepted before the refusal was written.
  expect(api.updateNeatSettings).toHaveBeenCalledTimes(1);
});
