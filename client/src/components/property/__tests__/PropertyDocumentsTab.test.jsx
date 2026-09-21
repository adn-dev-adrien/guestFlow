// PropertyDocumentsTab — one « Ajouter un document » button reveals Type, Nom, Parcourir and
// Enregistrer; a missing name or file is refused (specs/settings-rationalization.md rule 21).

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../DialogProvider', () => {
  const toast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => toast };
});
vi.mock('../../../api', () => ({ default: { uploadDocument: vi.fn(), deleteDocument: vi.fn() } }));

import api from '../../../api';
import PropertyDocumentsTab from '../PropertyDocumentsTab';

const DOCS = [{ id: 1, type: 'contract', name: 'Contrat de location', filePath: '/uploads/a.pdf' }];

beforeEach(() => {
  vi.clearAllMocks();
  api.uploadDocument.mockResolvedValue({});
  api.deleteDocument.mockResolvedValue({});
});

test('the add form is hidden until « Ajouter un document »', () => {
  render(<PropertyDocumentsTab propertyId="5" documents={DOCS} canManage onChanged={vi.fn()} />);
  expect(screen.getByText('Contrat de location')).toBeInTheDocument();
  expect(screen.queryByLabelText('Nom')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un document' }));
  expect(screen.getByLabelText('Nom')).toBeInTheDocument();
  expect(screen.getByText('Parcourir…')).toBeInTheDocument();
});

test('Enregistrer refuses a missing name and file, then uploads once both are given', async () => {
  const onChanged = vi.fn().mockResolvedValue();
  render(<PropertyDocumentsTab propertyId="5" documents={DOCS} canManage onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un document' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(screen.getByText('Donnez un nom au document.')).toBeInTheDocument();
  expect(screen.getByText('Choisissez le fichier sur votre ordinateur.')).toBeInTheDocument();
  expect(api.uploadDocument).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Règlement 2027' } });
  const file = new File(['x'], 'reglement.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Fichier du document'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1));
  const [, fd] = api.uploadDocument.mock.calls[0];
  expect(fd.get('name')).toBe('Règlement 2027');
  expect(fd.get('type')).toBe('contract');
  expect(onChanged).toHaveBeenCalled();
});

test('« Retirer » removes a document at once', async () => {
  const onChanged = vi.fn().mockResolvedValue();
  render(<PropertyDocumentsTab propertyId="5" documents={DOCS} canManage onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('5', 1));
});
