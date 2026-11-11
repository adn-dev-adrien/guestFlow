// specs/reservation-save-keeps-pricing.md rules 5 and 6 — the fiche prints the notices the server worded.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import PricingNotices from '../PricingNotices';

const TAX = { code: 'TOURIST_TAX_STALE', text: 'Taxe de séjour à mettre à jour : 0,00 € enregistrés, 21,24 € calculés.', action: 'refreshTouristTax' };
const COMMISSION = { code: 'PLATFORM_COMMISSION_ODD', text: 'Commission de 1 118,06 € : 91,5 % du séjour, contre 5,0 % attendus pour Lodgify.' };

test('renders nothing without notices', () => {
  const { container } = render(<PricingNotices notices={undefined} />);
  expect(container).toBeEmptyDOMElement();
  const empty = render(<PricingNotices notices={[]} />);
  expect(empty.container).toBeEmptyDOMElement();
});

test('rule 5 — a commission notice prints the server text, with no action', () => {
  render(<PricingNotices notices={[COMMISSION]} onAction={() => {}} />);
  expect(screen.getByTestId('pricing-notice-PLATFORM_COMMISSION_ODD')).toHaveTextContent(COMMISSION.text);
  expect(screen.queryByRole('button')).toBeNull();
});

test('rule 6 — the stale tax notice offers « Recalculer » and reports its action', () => {
  const onAction = vi.fn();
  render(<PricingNotices notices={[TAX, COMMISSION]} onAction={onAction} />);
  expect(screen.getByTestId('pricing-notice-TOURIST_TAX_STALE')).toHaveTextContent(TAX.text);
  fireEvent.click(screen.getByRole('button', { name: 'Recalculer' }));
  expect(onAction).toHaveBeenCalledWith('refreshTouristTax');
});
