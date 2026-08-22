/**
 * UpdateDialog — the digest leads, the changelog waits.
 * specs/self-update-and-releases.md §6.2 rule 20c.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UpdateDialog from '../UpdateDialog';

const INFO = {
  latest: '2.3.0',
  publishedAt: '2026-09-01T10:00:00Z',
  selfUpdateSupported: true,
  summary: [
    'Les emails clients attendent votre validation.',
    "L'assurance annulation se facture à la nuit.",
  ],
  notes: [
    { key: 'added', title: 'Ajouts', items: ['Un très long paragraphe qui explique le pourquoi.'] },
    { key: 'fixed', title: 'Corrections', items: ['Une correction détaillée.'] },
  ],
};

function renderDialog(info) {
  return render(
    <UpdateDialog open info={info} starting={false} onClose={() => {}} onConfirm={() => {}} />,
  );
}

test('the digest is what is shown; the changelog is one click away', async () => {
  renderDialog(INFO);

  expect(screen.getByText('Les emails clients attendent votre validation.')).toBeInTheDocument();
  expect(screen.queryByText('Ajouts')).not.toBeInTheDocument();
  expect(screen.queryByText('Un très long paragraphe qui explique le pourquoi.')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /tout le changelog/i }));

  expect(screen.getByText('Ajouts')).toBeInTheDocument();
  expect(screen.getByText('Un très long paragraphe qui explique le pourquoi.')).toBeInTheDocument();
  expect(screen.getByText('Les emails clients attendent votre validation.')).toBeInTheDocument();
});

test('the detail folds back', async () => {
  renderDialog(INFO);
  await userEvent.click(screen.getByRole('button', { name: /tout le changelog/i }));
  await userEvent.click(screen.getByRole('button', { name: /masquer le détail/i }));

  // `unmountOnExit` drops the sections only once the collapse transition has run.
  await waitFor(() => expect(screen.queryByText('Ajouts')).not.toBeInTheDocument());
});

test('a release published before the digest convention still shows its sections', () => {
  renderDialog({ ...INFO, summary: [] });

  expect(screen.getByText('Ajouts')).toBeInTheDocument();
  expect(screen.getByText('Un très long paragraphe qui explique le pourquoi.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /tout le changelog/i })).not.toBeInTheDocument();
});

test('a release with a digest and nothing else offers no expander', () => {
  renderDialog({ ...INFO, notes: [] });

  expect(screen.getByText('Les emails clients attendent votre validation.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /tout le changelog/i })).not.toBeInTheDocument();
});

test('a release with neither says so rather than showing an empty dialog', () => {
  renderDialog({ ...INFO, summary: [], notes: [] });

  expect(screen.getByText('Cette version ne détaille pas ses changements.')).toBeInTheDocument();
});

test('the install button is still reachable without reading anything', () => {
  renderDialog(INFO);
  expect(screen.getByRole('button', { name: /installer maintenant/i })).toBeEnabled();
});
