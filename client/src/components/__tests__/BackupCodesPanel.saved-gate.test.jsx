// specs/hosting-h2-account-security.md rule 45 — the backup codes must be saved before the parent's
// « Terminé »: copying, downloading or ticking the box each report "saved".
import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BackupCodesPanel from '../BackupCodesPanel';
import BackupCodesDialog from '../BackupCodesDialog';

const CODES = ['k7m2p-x9q4r', 'a1b2c-d3e4f'];

function Harness() {
  const [saved, setSaved] = useState(false);
  return (
    <>
      <BackupCodesPanel codes={CODES} account="marie@x.fr" onSavedChange={setSaved} />
      <button type="button" disabled={!saved}>Terminé</button>
    </>
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

test('rule 45: « Terminé » waits for the box', () => {
  render(<Harness />);
  expect(screen.getByRole('button', { name: 'Terminé' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Codes enregistrés en lieu sûr' }));
  expect(screen.getByRole('button', { name: 'Terminé' })).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Codes enregistrés en lieu sûr' }));
  expect(screen.getByRole('button', { name: 'Terminé' })).toBeDisabled();
});

test('rule 45: « Copier » copies the codes, answers « Copié » and ticks the box', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Copier' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('k7m2p-x9q4r\na1b2c-d3e4f'));
  expect(await screen.findByRole('button', { name: 'Copié' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Codes enregistrés en lieu sûr' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Terminé' })).toBeEnabled();
});

test('rule 45: a copy the browser refuses ticks nothing', async () => {
  navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Copier' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  expect(screen.getByRole('checkbox', { name: 'Codes enregistrés en lieu sûr' })).not.toBeChecked();
});

test('rule 45: « Télécharger » saves a dated .txt, answers « Téléchargé » and ticks the box', async () => {
  const names = [];
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function recordDownload() { names.push(this.download); };
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Télécharger' }));
  HTMLAnchorElement.prototype.click = click;
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^guestflow-codes-de-secours-\d{4}-\d{2}-\d{2}\.txt$/);
  expect(await screen.findByRole('button', { name: 'Téléchargé' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Codes enregistrés en lieu sûr' })).toBeChecked();
});

test('rules 6, 45: the standalone dialog closes on « Terminé » only, and only once saved', () => {
  const onClose = vi.fn();
  render(<BackupCodesDialog open codes={CODES} account="marie@x.fr" onClose={onClose} />);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
  fireEvent.mouseDown(document.querySelector('.MuiBackdrop-root'));
  fireEvent.click(document.querySelector('.MuiBackdrop-root'));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Terminé' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Codes enregistrés en lieu sûr' }));
  fireEvent.click(screen.getByRole('button', { name: 'Terminé' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
