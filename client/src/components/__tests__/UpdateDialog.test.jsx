/**
 * UpdateDialog — the digest leads, the changelog waits (rule 20c), and the offer covers every
 * version the update crosses, not just the target (rule 20d).
 * specs/self-update-and-releases.md §6.2.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UpdateDialog from '../UpdateDialog';

const TARGET = {
  version: '2.3.0',
  publishedAt: '2026-09-01T10:00:00Z',
  summary: [
    'Les emails clients attendent votre validation.',
    "L'assurance annulation se facture à la nuit.",
  ],
  notes: [
    { key: 'added', title: 'Ajouts', items: ['Un très long paragraphe qui explique le pourquoi.'] },
    { key: 'fixed', title: 'Corrections', items: ['Une correction détaillée.'] },
  ],
};

const SKIPPED = {
  version: '2.2.0',
  publishedAt: '2026-08-20T10:00:00Z',
  summary: ['La taxe de séjour suit la nuit sèche.'],
  notes: [{ key: 'fixed', title: 'Corrections', items: ['Le détail de la 2.2.0.'] }],
};

const INFO = {
  current: '2.2.0',
  latest: '2.3.0',
  publishedAt: '2026-09-01T10:00:00Z',
  selfUpdateSupported: true,
  versions: [TARGET],
  versionsTruncated: false,
};

function renderDialog(info) {
  return render(
    <UpdateDialog open info={info} starting={false} onClose={() => {}} onConfirm={() => {}} />,
  );
}

/** The usual case: one release between the installed version and the target. */
function oneVersion(overrides) {
  return { ...INFO, versions: [{ ...TARGET, ...overrides }] };
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
  renderDialog(oneVersion({ summary: [] }));

  expect(screen.getByText('Ajouts')).toBeInTheDocument();
  expect(screen.getByText('Un très long paragraphe qui explique le pourquoi.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /tout le changelog/i })).not.toBeInTheDocument();
});

test('a release with a digest and nothing else offers no expander', () => {
  renderDialog(oneVersion({ notes: [] }));

  expect(screen.getByText('Les emails clients attendent votre validation.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /tout le changelog/i })).not.toBeInTheDocument();
});

test('a release with neither says so rather than showing an empty dialog', () => {
  renderDialog({ ...INFO, versions: [] });

  expect(screen.getByText('Cette version ne détaille pas ses changements.')).toBeInTheDocument();
});

test('the install button is still reachable without reading anything', () => {
  renderDialog(INFO);
  expect(screen.getByRole('button', { name: /installer maintenant/i })).toBeEnabled();
});

// ----- rule 20d: the versions the operator skipped -----

test('a skipped version is shown with its own digest, under its own heading', () => {
  renderDialog({ ...INFO, current: '2.1.0', versions: [TARGET, SKIPPED] });

  expect(screen.getByText('2 versions depuis la 2.1.0')).toBeInTheDocument();
  expect(screen.getByText('2.3.0 — 1 septembre 2026')).toBeInTheDocument();
  expect(screen.getByText('2.2.0 — 20 août 2026')).toBeInTheDocument();
  expect(screen.getByText('Les emails clients attendent votre validation.')).toBeInTheDocument();
  expect(screen.getByText('La taxe de séjour suit la nuit sèche.')).toBeInTheDocument();
});

test('« Tout le changelog » unfolds every listed version, not just the target', async () => {
  renderDialog({ ...INFO, current: '2.1.0', versions: [TARGET, SKIPPED] });

  expect(screen.queryByText('Le détail de la 2.2.0.')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /tout le changelog/i }));

  expect(screen.getByText('Un très long paragraphe qui explique le pourquoi.')).toBeInTheDocument();
  expect(screen.getByText('Le détail de la 2.2.0.')).toBeInTheDocument();
});

test('a single-version span carries no count and no version heading', () => {
  renderDialog(INFO);

  expect(screen.queryByText(/versions depuis/)).not.toBeInTheDocument();
  expect(screen.queryByText('2.3.0 — 1 septembre 2026')).not.toBeInTheDocument();
  // The title and its subtitle already name the version and the date.
  expect(screen.getByText(/Mise à jour vers GuestFlow 2.3.0/)).toBeInTheDocument();
  expect(screen.getByText('Publiée le 1 septembre 2026')).toBeInTheDocument();
});

test('inside a span, a version with no digest says so and keeps its detail folded', async () => {
  const preDigest = { ...SKIPPED, summary: [] };
  renderDialog({ ...INFO, current: '2.1.0', versions: [TARGET, preDigest] });

  expect(screen.getByText('Pas de résumé pour cette version.')).toBeInTheDocument();
  expect(screen.queryByText('Le détail de la 2.2.0.')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /tout le changelog/i }));
  expect(screen.getByText('Le détail de la 2.2.0.')).toBeInTheDocument();
});

test('a window that stops short admits the versions it is not listing', () => {
  renderDialog({ ...INFO, current: '1.4.0', versions: [TARGET, SKIPPED], versionsTruncated: true });

  expect(screen.getByText('Les versions antérieures à 2.2.0 ne sont pas listées.')).toBeInTheDocument();
});
