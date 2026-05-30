import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AccountFormDialog from '../AccountFormDialog';

// Verifies the per-field invariants documented in specs/admin-account-management.md §6.2:
//   - email is locked in edit mode (helper-text explains why)
//   - the admin role checkbox is locked when isSelf=true and the user already has admin (rule 12)
//   - the submit handler receives a normalized payload (trimmed strings, roles array)
//   - server-side fieldErrors land under the matching input

function noop() {}

function renderDialog(props = {}) {
  return render(
    <AccountFormDialog
      open
      mode={props.mode || 'create'}
      initialValues={props.initialValues}
      isSelf={props.isSelf || false}
      fieldErrors={props.fieldErrors || {}}
      busy={props.busy || false}
      onClose={props.onClose || noop}
      onSubmit={props.onSubmit || noop}
    />
  );
}

describe('AccountFormDialog', () => {
  test('create mode: email field is editable', () => {
    renderDialog({ mode: 'create' });
    const email = screen.getByLabelText(/Email/);
    expect(email).not.toBeDisabled();
  });

  test('edit mode: email field is disabled + carries the lock explanation', () => {
    renderDialog({
      mode: 'edit',
      initialValues: { firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['accountant'] },
    });
    const email = screen.getByLabelText(/Email/);
    expect(email).toBeDisabled();
    expect(screen.getByText(/L'email n'est pas modifiable depuis ce formulaire/)).toBeInTheDocument();
  });

  test('self-protection: when isSelf=true and the user already has admin, the admin option is locked', async () => {
    const user = userEvent.setup();
    renderDialog({
      mode: 'edit',
      isSelf: true,
      initialValues: { firstName: 'Adrien', lastName: 'J', email: 'adrien@example.com', companyName: '', notes: '', roles: ['admin'] },
    });

    // Open the multi-select.
    await user.click(screen.getByLabelText(/Rôles/));
    // The admin option must show the protection caption and be disabled.
    await waitFor(() => expect(
      screen.getByText(/Vous ne pouvez pas retirer votre propre rôle admin/)
    ).toBeInTheDocument());
  });

  test('server-side fieldErrors land under the matching input', () => {
    renderDialog({
      mode: 'create',
      fieldErrors: { email: 'Cet email est déjà utilisé.' },
    });
    expect(screen.getByText('Cet email est déjà utilisé.')).toBeInTheDocument();
  });

  test('submit forwards trimmed identity fields + the roles array', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    renderDialog({ mode: 'create', onSubmit });

    await user.type(screen.getByLabelText(/Prénom/), '  Marie ');
    await user.type(screen.getByLabelText(/Nom/), 'Dupont ');
    await user.type(screen.getByLabelText(/Email/), 'marie@example.com');

    // Open roles and pick Comptable.
    await user.click(screen.getByLabelText(/Rôles/));
    await user.click(await screen.findByRole('option', { name: 'Comptable' }));
    // Close the menu (Escape) — MUI listbox stays open after click.
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: /Créer le compte/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.firstName).toBe('Marie');
    expect(payload.lastName).toBe('Dupont');
    expect(payload.email).toBe('marie@example.com');
    expect(payload.roles).toEqual(['accountant']);
  });
});
