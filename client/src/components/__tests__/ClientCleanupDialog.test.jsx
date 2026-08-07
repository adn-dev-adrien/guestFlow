import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import ClientCleanupDialog from '../ClientCleanupDialog';

// Coverage for the selective cleanup popup — see specs/clients.md §3 rule 8 + §6.
// All rows default-checked; master toggle reflects mix; Annuler is a pure no-op; Supprimer calls
// onConfirm with the currently-checked ids only.

const ORPHANS = [
  { id: 1, lastName: 'Albert', firstName: 'Zoé',  email: 'a@x.com', phone: '0611' },
  { id: 2, lastName: 'Bernard', firstName: 'Anne', email: 'b@x.com', phone: '0622' },
  { id: 3, lastName: 'Carl',    firstName: 'Tom',  email: '',         phone: '0633' },
];

function setup(props = {}) {
  const onClose = props.onClose || vi.fn();
  const onConfirm = props.onConfirm || vi.fn();
  const utils = render(
    <ClientCleanupDialog
      open
      orphans={props.orphans ?? ORPHANS}
      onClose={onClose}
      onConfirm={onConfirm}
      busy={!!props.busy}
    />
  );
  return { ...utils, onClose, onConfirm };
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /Supprimer/ });
}

function getSubmitSelectedIds() {
  const raw = getSubmitButton().getAttribute('data-selected-ids') || '';
  return raw ? raw.split(',').map((s) => Number(s)) : [];
}

describe('ClientCleanupDialog', () => {
  test('empty list shows the empty state + disabled Supprimer', () => {
    setup({ orphans: [] });
    expect(screen.getByText(/Aucun client à supprimer/)).toBeInTheDocument();
    expect(getSubmitButton()).toBeDisabled();
    expect(getSubmitButton()).toHaveTextContent('Supprimer (0)');
  });

  test('3 orphans default to all checked, master shows "Tout décocher", submit reports 3', () => {
    setup();
    // Master toggle copy reflects "all checked".
    expect(screen.getByText('Tout décocher')).toBeInTheDocument();
    expect(getSubmitButton()).toHaveTextContent('Supprimer (3)');
    expect(getSubmitSelectedIds().sort()).toEqual([1, 2, 3]);

    // Every row has a checked checkbox (3 rows + 1 master = 4).
    const checked = screen.getAllByRole('checkbox', { checked: true });
    expect(checked.length).toBe(4);
  });

  test('clicking a single row toggles only that row; master becomes indeterminate; count drops', async () => {
    const user = userEvent.setup();
    setup();
    // Bernard's row — click on the visible label, which calls toggleOne via ListItem onClick.
    await user.click(screen.getByText('Bernard Anne'));
    expect(getSubmitButton()).toHaveTextContent('Supprimer (2)');
    expect(getSubmitSelectedIds().sort()).toEqual([1, 3]);
    // Master toggle goes to "Tout cocher" (uncheck-some state → indeterminate, label = "Tout cocher").
    expect(screen.getByText('Tout cocher')).toBeInTheDocument();
  });

  test('master toggle "Tout décocher" clears every selection, Supprimer goes disabled', async () => {
    const user = userEvent.setup();
    setup();
    // Click the master label text — FormControlLabel forwards the click to the checkbox.
    await user.click(screen.getByText('Tout décocher'));
    expect(getSubmitButton()).toBeDisabled();
    expect(getSubmitButton()).toHaveTextContent('Supprimer (0)');
    expect(getSubmitSelectedIds()).toEqual([]);
  });

  test('Annuler calls onClose and never calls onConfirm', async () => {
    const user = userEvent.setup();
    const { onClose, onConfirm } = setup();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('Supprimer calls onConfirm with only the currently-checked ids', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();
    // Uncheck Carl (id=3): selection becomes [1, 2].
    await user.click(screen.getByText('Carl Tom'));
    await user.click(getSubmitButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const ids = onConfirm.mock.calls[0][0];
    expect([...ids].sort()).toEqual([1, 2]);
  });

  test('busy mode disables both buttons (Supprimer and Annuler)', () => {
    setup({ busy: true });
    expect(getSubmitButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled();
  });
});
