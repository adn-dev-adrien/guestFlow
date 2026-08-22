import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';

// specs/tourist-tax-included-services-deduction.md rule 4 — a service included in the rate (a
// property default marked « offerte ») is sold inside the night: it leaves the tourist-tax base and
// it cannot be removed from the booking. Its Switch reads ON, disabled, captioned « Inclus ».

function renderExtras(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <ReservationFormProvider value={ctx}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
  return ctx;
}

test('an included service renders its Switch checked, disabled and captioned « Inclus »', () => {
  renderExtras({ lockedIncludedOptionIds: new Set([10]) });

  const toggle = screen.getAllByRole('switch')[0];
  expect(toggle).toBeChecked();
  // `disabled` is what makes the service unremovable in the browser. (jsdom still dispatches clicks
  // on a disabled input, so asserting on the handler here would test jsdom, not the fiche.)
  expect(toggle).toBeDisabled();
  expect(screen.getByText('Inclus')).toBeInTheDocument();
});

test('an ordinary option stays editable', async () => {
  const user = userEvent.setup();
  const ctx = renderExtras();

  const toggle = screen.getAllByRole('switch')[0];
  expect(toggle).not.toBeChecked();
  expect(toggle).not.toBeDisabled();
  expect(screen.queryByText('Inclus')).toBeNull();

  await user.click(toggle);
  expect(ctx.setOptionEnabled).toHaveBeenCalledWith(10, true);
});
