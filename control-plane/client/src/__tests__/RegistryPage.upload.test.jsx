// specs/plugins-phase-4-registry.md rule 8 — the « Registre » page: published versions, upload of
// several packages with the refusal of each named, and withdrawal; a table on desktop, cards on a phone.
import React from 'react';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import RegistryPage from '../pages/RegistryPage';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { registry: vi.fn(), uploadPackage: vi.fn(), withdrawPackage: vi.fn() } }));

const row = (id, name, version, extra = {}) => ({
  id, name, version, sha256: 'a'.repeat(64), size: 77000, sizeLabel: '75 Ko', publishedAt: '2026-10-08T10:00:00Z',
  publishedLabel: '08/10/2026', withdrawnAt: null, statusLabel: 'Publié', ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.registry.mockResolvedValue([row('linen', 'Linge et blanchisserie', '1.0.1'), row('neat', 'Assurance annulation Neat', '1.0.0', { withdrawnAt: '2026-10-09T08:00:00Z', statusLabel: 'Retiré le 09/10/2026' })]);
});

it('rule 8 — the published versions, with their state, in a table on desktop', async () => {
  setWidth(1280);
  renderAt(<RegistryPage />);
  const table = await screen.findByRole('table');
  expect(within(table).getByText('Linge et blanchisserie')).toBeInTheDocument();
  expect(within(table).getByText('Retiré le 09/10/2026')).toBeInTheDocument();
  expect(within(table).getAllByRole('button', { name: 'Retirer' })).toHaveLength(1);
});

it('rule 8 — several packages are uploaded one by one; a refused one is named', async () => {
  setWidth(390);
  api.uploadPackage.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('linen-1.0.1.tgz refusé : manifest says 1.0.2'));
  renderAt(<RegistryPage />);
  await screen.findByText('Linge et blanchisserie 1.0.1');
  const a = new File(['x'], 'neat-1.1.0.tgz');
  const b = new File(['y'], 'linen-1.0.1.tgz');
  fireEvent.change(screen.getByTestId('registry-upload'), { target: { files: [a, b] } });
  expect(await screen.findByText('linen-1.0.1.tgz refusé : manifest says 1.0.2')).toBeInTheDocument();
  expect(api.uploadPackage).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(api.registry).toHaveBeenCalledTimes(2));
});

it('rule 8 — « Retirer » asks first, then withdraws the version', async () => {
  setWidth(1280);
  api.withdrawPackage.mockResolvedValue({});
  renderAt(<RegistryPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Les instances qui l’utilisent le gardent.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(api.withdrawPackage).toHaveBeenCalledWith('linen', '1.0.1'));
});
