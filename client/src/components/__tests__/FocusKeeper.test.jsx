// specs/plugins/plugins-phase-1-sdk.md rule 54 (reading 2026-11-18, loop t22 UI22-1) — FocusKeeper: when the control holding the focus is removed,
// disabled or hidden, the focus goes to the nearest anchor still drawn around it (never the document body); it never takes the focus from
// anywhere else, and forgets a control the operator left on purpose.
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FocusKeeper from '../FocusKeeper';

function Harness({ initial = 'present' }) {
  const [state, setState] = useState(initial);
  return (
    <div>
      <button type="button" onClick={() => setState('removed')}>remove</button>
      <button type="button" onClick={() => setState('disabled')}>disable</button>
      <button type="button" onClick={() => setState('hidden')}>hide</button>
      <button type="button" onClick={() => setState('innerHidden')}>hide inner</button>
      <button type="button" onClick={() => setState('other')}>rerender</button>
      <button type="button">outside</button>
      <FocusKeeper data-testid="outer">
        <FocusKeeper data-testid="inner" style={state === 'innerHidden' ? { visibility: 'hidden' } : undefined}>
          {state !== 'removed' && (
            <input aria-label="field" disabled={state === 'disabled'} style={state === 'hidden' ? { visibility: 'hidden' } : undefined} />
          )}
          <span>{state}</span>
        </FocusKeeper>
      </FocusKeeper>
    </div>
  );
}

const field = () => screen.getByRole('textbox', { name: 'field', hidden: true });
const press = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };

const LOSSES = [
  { name: 'removed', gesture: 'remove', lands: 'inner' },
  { name: 'disabled', gesture: 'disable', lands: 'inner' },
  { name: 'hidden', gesture: 'hide', lands: 'inner' },
  { name: 'hidden with its nearest region', gesture: 'hide inner', lands: 'outer' },
];

test.each(LOSSES)('a focused control $name: the focus lands on the nearest region still drawn ($lands), never on the body', async ({ gesture, lands }) => {
  render(<Harness />);
  field().focus();
  expect(document.activeElement).toBe(field());
  await press(gesture);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(lands)));
});

test('a control that stays drawn keeps the focus', async () => {
  render(<Harness />);
  field().focus();
  await press('rerender');
  expect(document.activeElement).toBe(field());
});

test('it never takes the focus from elsewhere: the operator left the field, then the field went', async () => {
  render(<Harness />);
  field().focus();
  screen.getByRole('button', { name: 'outside' }).focus();
  await press('remove');
  expect(document.activeElement).not.toBe(screen.getByTestId('inner'));
  expect(document.activeElement).not.toBe(screen.getByTestId('outer'));
});

test('a region is focusable by script only: it adds no Tab stop', () => {
  render(<Harness />);
  expect(screen.getByTestId('outer')).toHaveAttribute('tabindex', '-1');
  expect(screen.getByTestId('outer')).toHaveAttribute('data-focus-anchor');
});
