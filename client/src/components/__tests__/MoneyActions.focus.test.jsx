// specs/plugins/plugins-phase-1-sdk.md rule 58 (I4, loop t26 verifier) — the actions row of a money dialog keeps the focus when the commit
// holding it goes busy (disabled): the focus lands on the row, never stays on a disabled control or falls to the page.
import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MoneyActions } from '../../hooks/useMoneyCommit';

function Row() {
  const [busy, setBusy] = useState(false);
  return <MoneyActions><button type="button" disabled={busy} onClick={() => setBusy(true)}>Encaisser</button></MoneyActions>;
}

test('a commit going busy under the focus leaves it on the actions row', async () => {
  render(<Row />);
  const button = screen.getByRole('button', { name: 'Encaisser' });
  act(() => { button.focus(); });
  fireEvent.click(button);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const active = document.activeElement;
  expect(active).not.toBe(document.body);
  expect(active).not.toBe(button);
  expect(active.hasAttribute('data-focus-anchor')).toBe(true);
});
