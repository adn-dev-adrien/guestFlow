// specs/payment-link-lifecycle.md rules 39 and 46 (readings of 2026-11-01, audit R11-C2) — « Ouvrir » in place inside an
// app dialog closes that dialog (a confirm answers « no », so « Approuver quand même » never runs out of context) and
// goes through the page's unsaved-changes guard; « Ouvrir » in a new tab leaves the dialog open.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import DialogProvider, { useAppDialogs } from '../DialogProvider';
import ConflictList from '../ConflictList';

const ITEMS = [{ key: 41, label: 'T41', url: '/reservations/41' }];

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }

function Trigger({ kind, newTab = false, onAnswer }) {
  const { confirm, alert } = useAppDialogs();
  const details = <ConflictList severity="warning" items={ITEMS} newTab={newTab} />;
  const open = async () => {
    const answer = kind === 'confirm'
      ? await confirm({ title: 'Dates réservées', message: 'm', details, confirmLabel: 'Approuver quand même', confirmColor: 'warning' })
      : await alert({ title: 'Devis non enregistré', message: 'm', details });
    onAnswer(answer);
  };
  return <button type="button" onClick={open}>go</button>;
}

function renderIn(props) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <DialogProvider>
        <Where />
        <Routes>
          <Route path="/" element={<Trigger {...props} />} />
          <Route path="/reservations/:id" element={<div>stay page</div>} />
        </Routes>
      </DialogProvider>
    </MemoryRouter>,
  );
}

afterEach(() => { delete window.__guestflowBeforeNavigate; });

test('« Ouvrir » in a confirm closes it with « no » and opens the stay', async () => {
  const onAnswer = vi.fn();
  renderIn({ kind: 'confirm', onAnswer });
  fireEvent.click(screen.getByText('go'));
  fireEvent.click(await screen.findByRole('link', { name: 'Ouvrir : T41' }));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/reservations/41'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('button', { name: 'Approuver quand même' })).toBeNull();
  expect(onAnswer).toHaveBeenCalledWith(false);
});

test('« Ouvrir » in an alert closes it; a guard that blocks keeps the page and gets the target', async () => {
  window.__guestflowBeforeNavigate = vi.fn(() => true);
  const onAnswer = vi.fn();
  renderIn({ kind: 'alert', onAnswer });
  fireEvent.click(screen.getByText('go'));
  fireEvent.click(await screen.findByRole('link', { name: 'Ouvrir : T41' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(window.__guestflowBeforeNavigate).toHaveBeenCalledWith('/reservations/41');
  expect(screen.getByTestId('where').textContent).toBe('/');
  expect(onAnswer).toHaveBeenCalledTimes(1);
});

test('« Ouvrir » in a new tab leaves the dialog open', async () => {
  const onAnswer = vi.fn();
  renderIn({ kind: 'confirm', newTab: true, onAnswer });
  fireEvent.click(screen.getByText('go'));
  const link = await screen.findByRole('link', { name: 'Ouvrir : T41' });
  expect(link).toHaveAttribute('target', '_blank');
  fireEvent.click(link);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(onAnswer).not.toHaveBeenCalled();
});
