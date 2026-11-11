// specs/options-resources-ux.md rule 29 and specs/ui-review-2026-10-19-operations.md rule 26 — the browser
// « Retour » of a dirty PAGE form, with a real BrowserRouter: its popstate listener runs before any
// component's, so the guard is the interceptor installed before the router mounts.
import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router';
import useDirtyFormGuard from '../useDirtyFormGuard';
import installBackGuard from '../../utils/backGuard';
import UnsavedChangesDialog from '../../components/UnsavedChangesDialog';

installBackGuard();

function Form() {
  const navigate = useNavigate();
  const [value, setValue] = useState('a');
  const guard = useDirtyFormGuard({ draft: value, saved: 'a', navigate });
  return (
    <div>
      <input aria-label="champ" value={value} onChange={(e) => setValue(e.target.value)} />
      <UnsavedChangesDialog open={guard.guardDialogOpen} onStay={guard.dismissGuard} onDiscard={guard.confirmLeave} onSaveAndQuit={guard.confirmLeave} />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Link to="/form">vers le formulaire</Link>
      <Routes>
        <Route path="/prev" element={<p>page précédente</p>} />
        <Route path="/form" element={<Form />} />
      </Routes>
    </BrowserRouter>
  );
}

const back = () => window.history.back();

async function openDirtyForm() {
  window.history.replaceState(null, '', '/prev');
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByText('vers le formulaire'));
  await user.type(await screen.findByLabelText('champ'), 'b');
  return user;
}

afterEach(() => { window.history.replaceState(null, '', '/'); });

test('rule 29: Back on a dirty page form shows the dialog, keeps the form and the URL, and the page entry state', async () => {
  await openDirtyForm();
  const idx = window.history.state.idx;
  back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/form');
  expect(screen.getByLabelText('champ')).toHaveValue('ab');
  expect(screen.queryByText('page précédente')).not.toBeInTheDocument();
  expect(window.history.state.idx).toBe(idx);
});

test('rule 29: « Rester sur la page » keeps editing; a second Back asks again', async () => {
  const user = await openDirtyForm();
  back();
  await user.click(await screen.findByRole('button', { name: 'Rester sur la page' }));
  expect(screen.getByLabelText('champ')).toBeInTheDocument();
  back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
});

test('rule 29: « Quitter sans enregistrer » performs the pending back', async () => {
  const user = await openDirtyForm();
  back();
  await user.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(await screen.findByText('page précédente')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/prev');
});

test('rule 29: Back on a clean page form goes straight back', async () => {
  window.history.replaceState(null, '', '/prev');
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByText('vers le formulaire'));
  await screen.findByLabelText('champ');
  back();
  await waitFor(() => expect(screen.getByText('page précédente')).toBeInTheDocument());
});
