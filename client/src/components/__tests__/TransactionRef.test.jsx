// specs/mollie-rolling-reserve-and-incoming-payments.md rule 12 — an external identifier is shortened in the middle,
// keeps its full value (title, copy), and copying says so.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DialogProvider from '../DialogProvider';
import TransactionRef from '../TransactionRef';

const LONG = 'solio-6791-1-transaction-019d1b2f-0001';

const renderRef = (props) => render(<DialogProvider><TransactionRef label="Qonto" {...props} /></DialogProvider>);

afterEach(() => { vi.restoreAllMocks(); });

test('rule 12: a long identifier is shortened in the middle and keeps its full value as title', () => {
  renderRef({ value: LONG });
  const shown = screen.getByTitle(LONG);
  expect(shown.textContent).toBe('solio-6791-1…b2f-0001');
});

test('rule 12: a short identifier is shown whole', () => {
  renderRef({ label: 'Lot Mollie', value: 'T19274230.2603.01' });
  expect(screen.getByText('T19274230.2603.01')).toBeInTheDocument();
});

test('rule 12: the copy button names the reference and copies the FULL value, then toasts', async () => {
  const writeText = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderRef({ value: LONG });
  await userEvent.click(screen.getByRole('button', { name: `Copier la référence Qonto ${LONG}` }));
  expect(writeText).toHaveBeenCalledWith(LONG);
  expect(await screen.findByText('Référence Qonto copiée.')).toBeInTheDocument();
});

test('rule 12: a refused clipboard shows an error instead of a false success', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
  renderRef({ value: LONG });
  await userEvent.click(screen.getByRole('button', { name: /Copier la référence Qonto/ }));
  await waitFor(() => expect(screen.getByText(/Copie impossible/)).toBeInTheDocument());
  expect(screen.queryByText('Référence Qonto copiée.')).not.toBeInTheDocument();
});

test('rule 12: nothing is drawn without a value', () => {
  const { container } = renderRef({ value: null });
  expect(container).toBeEmptyDOMElement();
});

test('the copy button is a 44 px touch target', () => {
  renderRef({ value: LONG });
  expect(getComputedStyle(screen.getByRole('button', { name: /Copier la référence/ })).minHeight).toBe('44px');
});
