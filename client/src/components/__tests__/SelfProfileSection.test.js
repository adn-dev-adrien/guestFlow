import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SelfProfileSection from '../SelfProfileSection';

const BASE = {
  firstName: 'Adrien',
  lastName: 'Jouve',
  email: 'adrien@example.com',
  companyName: 'Domaine Solio',
  notes: '',
};

function renderSection(props = {}) {
  const initialValues = Object.prototype.hasOwnProperty.call(props, 'initialValues') ? props.initialValues : BASE;
  return render(
    <SelfProfileSection
      initialValues={initialValues}
      emailStatus={props.emailStatus}
      fieldErrors={props.fieldErrors ?? {}}
      busy={props.busy ?? false}
      onSubmit={props.onSubmit ?? jest.fn()}
    />
  );
}

describe('SelfProfileSection', () => {
  test('pre-fills every editable field from initialValues + email is editable (2026-06-02)', () => {
    renderSection();

    expect(screen.getByLabelText(/Prénom/)).toHaveValue('Adrien');
    expect(screen.getByLabelText(/Nom/)).toHaveValue('Jouve');
    expect(screen.getByLabelText(/Société/)).toHaveValue('Domaine Solio');
    expect(screen.getByLabelText(/Note/)).toHaveValue('');
    const email = screen.getByLabelText(/Email/);
    expect(email).toHaveValue('adrien@example.com');
    expect(email).not.toBeDisabled();
    // Neutral helper text when the email is not the bootstrap seed.
    expect(screen.getByText(/C'est l'adresse utilisée pour vous connecter/)).toBeInTheDocument();
  });

  test('red default-email warning fires when the user still has the bootstrap seed + the server confirms it', () => {
    renderSection({
      initialValues: { ...BASE, email: 'admin@guestflow.local' },
      emailStatus: { defaultStillUsed: true },
    });
    const email = screen.getByLabelText(/Email/);
    expect(email).toHaveValue('admin@guestflow.local');
    // MUI's `error` prop adds Mui-error on both the input AND the helper text wrapper.
    expect(screen.getByText(/Vous utilisez encore l'adresse par défaut/)).toBeInTheDocument();
  });

  test('default-email warning stays silent when the server says the seed has already been replaced', () => {
    // Edge case: the local draft still reads `admin@guestflow.local` only because the parent has not
    // yet refreshed (server confirmed it's gone). We rely on `defaultStillUsed` to gate the warning.
    renderSection({
      initialValues: { ...BASE, email: 'admin@guestflow.local' },
      emailStatus: { defaultStillUsed: false },
    });
    expect(screen.queryByText(/Vous utilisez encore l'adresse par défaut/)).not.toBeInTheDocument();
  });

  test('Save + Cancel are disabled until the user modifies a field, re-disabled on Cancel', async () => {
    const user = userEvent.setup();
    renderSection();

    const save = screen.getByRole('button', { name: /Enregistrer/i });
    const cancel = screen.getByRole('button', { name: /Annuler/i });
    expect(save).toBeDisabled();
    expect(cancel).toBeDisabled();

    await user.clear(screen.getByLabelText(/Prénom/));
    await user.type(screen.getByLabelText(/Prénom/), 'Marie');
    expect(save).not.toBeDisabled();
    expect(cancel).not.toBeDisabled();

    await user.click(cancel);
    expect(screen.getByLabelText(/Prénom/)).toHaveValue('Adrien'); // restored
    expect(save).toBeDisabled();
    expect(cancel).toBeDisabled();
  });

  test('submit forwards a trimmed payload including email (editable since 2026-06-02), never roles', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    renderSection({ onSubmit });

    await user.clear(screen.getByLabelText(/Prénom/));
    await user.type(screen.getByLabelText(/Prénom/), '  Marie ');
    await user.type(screen.getByLabelText(/Note/), 'Nouveau bureau');

    await user.click(screen.getByRole('button', { name: /Enregistrer/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toEqual({
      firstName: 'Marie',
      lastName: 'Jouve',
      email: 'adrien@example.com',
      companyName: 'Domaine Solio',
      notes: 'Nouveau bureau',
    });
    // Roles must never leak from this form — the server's PUT /api/users/me strips them
    // defensively, but the client should not even send the key (self-privilege guard).
    expect(payload.roles).toBeUndefined();
  });

  test('busy=true: inputs disabled + Save shows a spinner', () => {
    renderSection({ busy: true });
    expect(screen.getByLabelText(/Prénom/)).toBeDisabled();
    expect(screen.getByLabelText(/Nom/)).toBeDisabled();
    expect(screen.getByLabelText(/Email/)).toBeDisabled();
    expect(screen.getByLabelText(/Société/)).toBeDisabled();
    expect(screen.getByLabelText(/Note/)).toBeDisabled();
    expect(screen.getByRole('button', { name: /Enregistrer/i })).toBeDisabled();
  });

  test('fieldErrors land under their matching input', () => {
    renderSection({ fieldErrors: { firstName: 'Le prénom est requis.' } });
    expect(screen.getByText('Le prénom est requis.')).toBeInTheDocument();
  });

  test('initialValues prop change updates the form (e.g. after a refreshAuth)', () => {
    const { rerender } = renderSection();
    expect(screen.getByLabelText(/Prénom/)).toHaveValue('Adrien');

    rerender(
      <SelfProfileSection
        initialValues={{ ...BASE, firstName: 'Marie', companyName: 'Solio v2' }}
        fieldErrors={{}}
        busy={false}
        onSubmit={jest.fn()}
      />
    );

    return waitFor(() => {
      expect(screen.getByLabelText(/Prénom/)).toHaveValue('Marie');
      expect(screen.getByLabelText(/Société/)).toHaveValue('Solio v2');
    });
  });

  test('null initialValues: renders the empty form without crashing', () => {
    renderSection({ initialValues: null });
    expect(screen.getByLabelText(/Prénom/)).toHaveValue('');
    expect(screen.getByLabelText(/Nom/)).toHaveValue('');
  });
});
