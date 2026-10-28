// specs/reservation-payment-ledger.md rules 56 and 62 — the platform price alert prints what the server decided.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import PlatformPriceAlert from '../PlatformPriceAlert';

const CHECK = {
  platformLabel: 'Booking', paid: 812, expected: 1180, gap: -368, gapPercent: -31.2, direction: 'below', gridPath: '/properties/3/pricing-seasons',
};

const renderAlert = (check) => render(<MemoryRouter><PlatformPriceAlert check={check} /></MemoryRouter>);

test('rule 62 — title with the platform, the amounts and the signed whole percentage', () => {
  renderAlert(CHECK);
  expect(screen.getByText('Prix Booking à vérifier')).toBeInTheDocument();
  expect(screen.getByTestId('platform-price-alert')).toHaveTextContent('812,00 € payés · 1 180,00 € selon la grille (−31 %)');
});

test('rule 62 — above the grid the percentage is signed with a plus', () => {
  renderAlert({ ...CHECK, paid: 1510, expected: 1180, gap: 330, gapPercent: 28, direction: 'above' });
  expect(screen.getByTestId('platform-price-alert')).toHaveTextContent('1 510,00 € payés · 1 180,00 € selon la grille (+28 %)');
});

test('rule 62 — « Voir la grille » links to the property’s pricing seasons, as a 44 px target', () => {
  renderAlert(CHECK);
  const link = screen.getByRole('link', { name: 'Voir la grille' });
  expect(link).toHaveAttribute('href', '/properties/3/pricing-seasons');
  expect(getComputedStyle(link).minHeight).toBe('44px');
});

test('rule 62 — nothing is rendered without a check, and the alert has no dismiss button', () => {
  const { container } = renderAlert(null);
  expect(container).toBeEmptyDOMElement();
  renderAlert(CHECK);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('rule 56 — no « tarif » / « ancien » wording in the alert', () => {
  renderAlert(CHECK);
  expect(screen.getByTestId('platform-price-alert')).not.toHaveTextContent(/tarif|ancien/i);
});
