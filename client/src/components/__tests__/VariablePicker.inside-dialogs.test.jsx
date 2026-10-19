// specs/guest-email-texts-made-simple.md rule 41 (review of PR #723, B2) — Échap and Entrée in the
// variable list stop there: the dialog or the sheet around the field stays open, with what was typed.
import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog, Drawer } from '@mui/material';
import TokenTextField from '../TokenTextField';

function Field() {
  const [fr, setFr] = useState('Bonjour ');
  return (
    <TokenTextField
      label="Corps"
      language="fr"
      fr={fr}
      onChange={(lang, v) => setFr(v)}
      tokens={[{ name: 'clientFirstName', label: 'Prénom du voyageur' }]}
    />
  );
}

function InDialog({ onClose }) {
  return <Dialog open onClose={onClose}><Field /></Dialog>;
}

function InDrawer({ onClose }) {
  return <Drawer anchor="bottom" open onClose={onClose}><Field /></Drawer>;
}

for (const [name, Wrapper] of [['a dialog', InDialog], ['a sheet', InDrawer]]) {
  test(`inside ${name}, Échap closes the list only`, () => {
    const onClose = vi.fn();
    render(<Wrapper onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Variable' }));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Corps — français')).toHaveValue('Bonjour ');
  });

  test(`inside ${name}, Entrée inserts and keeps it open`, () => {
    const onClose = vi.fn();
    render(<Wrapper onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Variable' }));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Corps — français').value).toContain('⟦Prénom du voyageur⟧');
  });
}

test('Tab closes the list', () => {
  render(<Field />);
  fireEvent.click(screen.getByRole('button', { name: 'Variable' }));
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Tab' });
  expect(screen.queryByRole('combobox')).toBeNull();
});
