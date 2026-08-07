import { vi } from 'vitest';
/**
 * CalendarNoteDialog — DS phase-5 sweep (specs/ds-sweep-planning.md rule 23): the note dialog now
 * rides FormDialog (canonical Annuler/Enregistrer + fullScreen-on-xs inherited) with « Supprimer »
 * in the new secondary-action slot (shown only when a saved note exists).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import CalendarNoteDialog from '../CalendarNoteDialog';

function renderDialog(props = {}) {
  const handlers = { onChangeText: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), onClose: vi.fn() };
  render(
    <ThemeProvider theme={theme}>
      <CalendarNoteDialog
        open
        date="2026-07-16"
        text="Ménage à 11h"
        maxLength={50}
        hasNote={false}
        {...handlers}
        {...props}
      />
    </ThemeProvider>,
  );
  return handlers;
}

test('renders title, canonical Annuler/Enregistrer actions, and fires onSave', () => {
  const h = renderDialog();
  expect(screen.getByText('Note — 2026-07-16')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(h.onSave).toHaveBeenCalledTimes(1);
});

test('« Supprimer » only appears for an existing note, and fires onDelete', () => {
  const h = renderDialog({ hasNote: true });
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
  expect(h.onDelete).toHaveBeenCalledTimes(1);
});

test('no « Supprimer » when there is no saved note', () => {
  renderDialog({ hasNote: false });
  expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
});

test('typing is length-capped through onChangeText', () => {
  const h = renderDialog({ text: '' });
  fireEvent.change(screen.getByLabelText(/Note \(50 car\. max\)/), { target: { value: 'x'.repeat(60) } });
  expect(h.onChangeText).toHaveBeenCalledWith('x'.repeat(50));
});
