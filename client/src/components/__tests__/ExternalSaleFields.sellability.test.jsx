// specs/pricing/pricing-components.md rule 124 — « Vendable hors séjour » explains before the save: an article the engine cannot sell with no stay leaves the switch inert (focusable,
// `aria-disabled`) with the reason as its helper; one saved before and already checked stays active so it can be unchecked, the reason in the error colour then « Décocher pour enregistrer. ».
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ExternalSaleFields from '../ExternalSaleFields';

const CLASSES = [{ vatClass: 'options', label: 'Options', externalRate: 20 }];
const REASON = 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.';
const REFUSED = { sellable: false, code: 'NEEDS_STAY', reason: REASON };
const base = { sellableExternally: false, vatClass: '', externalVatRate: null };
const draw = (props) => render(<ExternalSaleFields value={base} onChange={() => {}} classes={CLASSES} {...props} />);

test('rule 124 — not sellable and unchecked: the switch is aria-disabled yet focusable, a click changes nothing and the helper reads the reason', () => {
  const onChange = vi.fn();
  draw({ onChange, sellability: REFUSED });
  const toggle = screen.getByRole('switch', { name: 'Vendable hors séjour' });
  expect(toggle).toHaveAttribute('aria-disabled', 'true');
  expect(toggle).not.toBeDisabled();
  toggle.focus();
  expect(toggle).toHaveFocus();
  fireEvent.click(toggle);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText(REASON)).toBeInTheDocument();
  expect(toggle).toHaveAccessibleDescription(REASON);
});

test('rule 124 — not sellable but already checked: the switch stays active to be unchecked, the helper is the reason then « Décocher pour enregistrer. »', () => {
  const onChange = vi.fn();
  draw({ onChange, value: { ...base, sellableExternally: true }, sellability: REFUSED });
  const toggle = screen.getByRole('switch', { name: 'Vendable hors séjour' });
  expect(toggle).not.toHaveAttribute('aria-disabled');
  const helper = screen.getByText(`${REASON} Décocher pour enregistrer.`);
  expect(helper).toHaveClass('Mui-error');
  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith({ sellableExternally: false });
});

test('rule 124 — sellable, or the answer still pending: the switch behaves as before', () => {
  const onChange = vi.fn();
  const { rerender } = draw({ onChange, sellability: { sellable: true, code: null, reason: null } });
  fireEvent.click(screen.getByRole('switch', { name: 'Vendable hors séjour' }));
  expect(onChange).toHaveBeenCalledWith({ sellableExternally: true });
  expect(screen.getByText('Proposé au comptoir et à l’arrivée d’un client sans séjour.')).toBeInTheDocument();
  rerender(<ExternalSaleFields value={base} onChange={onChange} classes={CLASSES} sellability={null} />);
  expect(screen.getByRole('switch', { name: 'Vendable hors séjour' })).not.toHaveAttribute('aria-disabled');
});
