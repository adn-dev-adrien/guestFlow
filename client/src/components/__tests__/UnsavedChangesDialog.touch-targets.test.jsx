// specs/ds-components.md §3.1 + CLAUDE.md responsive rules — the three actions are 44 px touch targets and
// each still fires its handler.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import UnsavedChangesDialog from '../UnsavedChangesDialog';

test('the three actions are at least 44 px tall and wired', () => {
  const calls = [];
  render(<UnsavedChangesDialog open onStay={() => calls.push('stay')} onDiscard={() => calls.push('discard')} onSaveAndQuit={() => calls.push('save')} />);
  for (const name of ['Rester sur la page', 'Quitter sans enregistrer', 'Enregistrer et quitter']) {
    const button = screen.getByRole('button', { name });
    expect(parseFloat(getComputedStyle(button).minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.click(button);
  }
  expect(calls).toEqual(['stay', 'discard', 'save']);
});
