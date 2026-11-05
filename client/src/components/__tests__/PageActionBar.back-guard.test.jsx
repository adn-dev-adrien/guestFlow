// specs/ui-review-2026-10-19-operations.md rule 42 — the « Retour » arrow of a page using `backTo` asks the guard.
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import PageActionBar from '../PageActionBar';
import UnsavedChangesDialog from '../UnsavedChangesDialog';
import useDirtyFormGuard from '../../hooks/useDirtyFormGuard';

function Form() {
  const navigate = useNavigate();
  const [value, setValue] = useState('a');
  const guard = useDirtyFormGuard({ draft: value, saved: 'a', navigate });
  return (
    <div>
      <PageActionBar title="Réglage" backTo="/settings" />
      <input aria-label="champ" value={value} onChange={(e) => setValue(e.target.value)} />
      <UnsavedChangesDialog open={guard.guardDialogOpen} onStay={guard.dismissGuard} onDiscard={guard.confirmLeave} onSaveAndQuit={guard.confirmLeave} />
    </div>
  );
}

const open = () => render(
  <MemoryRouter initialEntries={['/settings/form']}>
    <Routes>
      <Route path="/settings" element={<p>réglages</p>} />
      <Route path="/settings/form" element={<Form />} />
    </Routes>
  </MemoryRouter>,
);

test('rule 42: a clean page goes straight back', () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
  expect(screen.getByText('réglages')).toBeInTheDocument();
});

test('rule 42: a dirty page asks, staying keeps the edit, leaving goes to backTo', async () => {
  open();
  fireEvent.change(screen.getByLabelText('champ'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Rester sur la page' }));
  await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).toBeNull());
  expect(screen.getByLabelText('champ')).toHaveValue('b');
  fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(screen.getByText('réglages')).toBeInTheDocument();
});
