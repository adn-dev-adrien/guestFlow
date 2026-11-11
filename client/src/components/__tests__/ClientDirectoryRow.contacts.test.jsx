/**
 * specs/ui-review-2026-10-19-operations.md rule 37 — the directory row keeps the e-mail link and a call
 * button (the phone text link is hidden by CSS on a coarse pointer, measured in the browser).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import ClientDirectoryRow from '../ClientDirectoryRow';

const client = { id: 1, lastName: 'Martin', firstName: 'Léa', email: 'lea@example.com', phone: '+33612345678', whenLabel: 'Arrive dans 8 j', stayCount: 1, stay: null };

test('rule 37 — the e-mail is a mailto link and the phone has a call button', () => {
  render(<ClientDirectoryRow client={client} onOpen={() => {}} />);
  expect(screen.getByRole('link', { name: 'lea@example.com' })).toHaveAttribute('href', 'mailto:lea@example.com');
  const call = screen.getAllByRole('link').find((a) => a.getAttribute('href') === 'tel:+33612345678' && a.classList.contains('MuiIconButton-root'));
  expect(call).toBeTruthy();
});
