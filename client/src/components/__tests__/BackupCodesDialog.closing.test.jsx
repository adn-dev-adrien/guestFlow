// specs/hosting-h2-account-security.md rule 6 — the backup codes are shown once: the dialog closes
// on « Terminé » only, never on a click outside nor on Escape.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BackupCodesDialog from '../BackupCodesDialog';

const CODES = ['k7m2p-x9q4r', 'a1b2c-d3e4f'];

test('rule 6 — Escape and a click outside leave the codes on screen; « Terminé » closes', () => {
  const onClose = vi.fn();
  render(<BackupCodesDialog open codes={CODES} account="marie@x.fr" onClose={onClose} />);
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
  const backdrop = document.querySelector('.MuiBackdrop-root');
  fireEvent.mouseDown(backdrop);
  fireEvent.click(backdrop);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByTestId('backup-codes').textContent).toContain('k7m2p-x9q4r');
  fireEvent.click(screen.getByRole('button', { name: 'Terminé' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
