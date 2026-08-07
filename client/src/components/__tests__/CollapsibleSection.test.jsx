import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CollapsibleSection from '../CollapsibleSection';

// specs/option-categories.md §3 rules 8-12 — the generic collapsible section.

const renderSection = (props = {}) => render(
  <CollapsibleSection title="Boissons" {...props}>
    <div>contenu replié</div>
  </CollapsibleSection>
);

test('collapsed by default: the body is not rendered', () => {
  renderSection();
  expect(screen.getByText('Boissons')).toBeInTheDocument();
  expect(screen.queryByText('contenu replié')).not.toBeInTheDocument();
});

test('clicking the header reveals the body and flips aria-expanded', async () => {
  const user = userEvent.setup();
  renderSection();
  const header = screen.getByRole('button', { name: /Catégorie Boissons/ });
  expect(header).toHaveAttribute('aria-expanded', 'false');

  await user.click(header);
  expect(header).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('contenu replié')).toBeInTheDocument();

  await user.click(header);
  expect(header).toHaveAttribute('aria-expanded', 'false');
});

test('defaultExpanded renders the body straight away', () => {
  renderSection({ defaultExpanded: true });
  expect(screen.getByText('contenu replié')).toBeInTheDocument();
});

test('the count chip is hidden at 0 and shown above it', () => {
  const { unmount } = renderSection({ count: 0 });
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  unmount();

  renderSection({ count: 3 });
  expect(screen.getByText('3')).toBeInTheDocument();
});

test('the accessible name carries the selected count for screen readers', () => {
  renderSection({ count: 2 });
  expect(screen.getByRole('button', { name: 'Catégorie Boissons, 2 options sélectionnées' })).toBeInTheDocument();
});

test('the singular is used for a single selection', () => {
  renderSection({ count: 1 });
  expect(screen.getByRole('button', { name: 'Catégorie Boissons, 1 option sélectionnée' })).toBeInTheDocument();
});

test('pinned content stays visible while collapsed — the whole point of the component', () => {
  renderSection({ pinned: <div>ligne épinglée</div> });
  expect(screen.getByText('ligne épinglée')).toBeInTheDocument();
  expect(screen.queryByText('contenu replié')).not.toBeInTheDocument();
});

test('the toggle affordance swaps its label with the state', async () => {
  const user = userEvent.setup();
  renderSection({ toggleLabel: 'Voir les 7 autres' });
  expect(screen.getByText('Voir les 7 autres')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Catégorie Boissons/ }));
  expect(screen.getByText('Réduire')).toBeInTheDocument();
  expect(screen.queryByText('Voir les 7 autres')).not.toBeInTheDocument();
});

test('no toggle affordance when none is provided', () => {
  renderSection();
  expect(screen.queryByText('Réduire')).not.toBeInTheDocument();
});
