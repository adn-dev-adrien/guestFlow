// specs/pricing/pricing-components.md rule 108 (loop t8 UI8-5) — the fiche matches the server's refundedLoweredLines on the key the server
// serves on the custom line (`key`), never on a key it rebuilds from the line's label.
import React from 'react';
import { vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

vi.setConfig({ testTimeout: 30000 });

const dialogs = { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() };

vi.mock('../../api', () => {
  const calls = {};
  const handler = {
    get(_t, name) {
      if (name === '__esModule') return false;
      if (!calls[name]) calls[name] = vi.fn(async () => ([]));
      return calls[name];
    },
  };
  return { __esModule: true, default: new Proxy({}, handler) };
});
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => dialogs,
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import { FICHE, SERVER_KEY, mockFiche, openFiche } from './refundedLineFixtures';

test('the custom line the server names by its key reads « ✓ Offert · remboursée », without a toggle', async () => {
  mockFiche(api);
  api.getReservation.mockResolvedValue({ ...FICHE, refundedLoweredLines: [{ key: SERVER_KEY, table: 'custom', lineId: 3 }] });
  openFiche();
  expect(await screen.findByText('✓ Offert · remboursée')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '✓ Offert' })).toBeNull();
});

test('a key the server did not serve on the line matches nothing, whatever the label', async () => {
  mockFiche(api);
  api.getReservation.mockResolvedValue({ ...FICHE, refundedLoweredLines: [{ key: 'custom:bière', table: 'custom', lineId: 3 }] });
  openFiche();
  expect(await screen.findByRole('button', { name: '✓ Offert' })).toBeInTheDocument();
  expect(screen.queryByText('✓ Offert · remboursée')).toBeNull();
});
