// specs/payment-link-lifecycle.md rules 40, 41, 49 — ConflictList prints the records a refusal or a warning
// names, the server's label and detail, one « Ouvrir » per row (new tab on desktop, in place on a phone).
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ConflictList from '../ConflictList';

const ITEMS = [
  { key: 'a', label: 'Devis D-2026-118 · Ana Test', detail: '840,00 € · lien valable jusqu’au 01/11 à 06:00', url: '/reservations/new?mode=devis&devisId=12' },
  { key: 'b', label: 'Devis D-2026-121 · Bo Test', url: '/reservations/new?mode=devis&devisId=13' },
];

const inRouter = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

test('a group prints its title, each label and detail, and one « Ouvrir » link per row', () => {
  inRouter(<ConflictList severity="warning" title="Demande de paiement en cours sur ces dates." items={ITEMS} />);
  const block = screen.getByRole('status');
  expect(within(block).getByText('Demande de paiement en cours sur ces dates.')).toBeInTheDocument();
  expect(within(block).getByText('Devis D-2026-118 · Ana Test')).toBeInTheDocument();
  expect(within(block).getByText('840,00 € · lien valable jusqu’au 01/11 à 06:00')).toBeInTheDocument();
  const link = within(block).getByRole('link', { name: 'Ouvrir : Devis D-2026-118 · Ana Test' });
  expect(link).toHaveAttribute('href', '/reservations/new?mode=devis&devisId=12');
  expect(link).not.toHaveAttribute('target');
  expect(within(block).getAllByRole('link')).toHaveLength(2);
});

test('newTab opens each record in a new tab', () => {
  inRouter(<ConflictList title="T" items={ITEMS} newTab />);
  for (const link of screen.getAllByRole('link')) {
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
  }
});

test('an error block is an alert; several groups share one block and empty ones are left out', () => {
  inRouter(
    <ConflictList severity="error" groups={[
      { title: 'Réservation sur ces dates : fermeture impossible.', items: [ITEMS[0]] },
      { title: 'Devis en cours sur ces dates.', items: [] },
    ]} />,
  );
  const block = screen.getByRole('alert');
  expect(within(block).getByText('Réservation sur ces dates : fermeture impossible.')).toBeInTheDocument();
  expect(screen.queryByText('Devis en cours sur ces dates.')).toBeNull();
});

test('nothing to name, nothing rendered', () => {
  const { container } = inRouter(<ConflictList title="T" items={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test('outside a router the rows are plain links', () => {
  render(<ConflictList title="T" items={[ITEMS[1]]} />);
  expect(screen.getByRole('link', { name: 'Ouvrir : Devis D-2026-121 · Bo Test' })).toHaveAttribute('href', '/reservations/new?mode=devis&devisId=13');
});
