import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';

function renderExtras(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <ReservationFormProvider value={ctx}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
  return ctx;
}

test('renders an option row, the custom-options block and a resource row', () => {
  renderExtras();
  expect(screen.getByText('Petit-déjeuner')).toBeInTheDocument();
  expect(screen.getByText('Options personnalisées')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ajouter une ligne' })).toBeInTheDocument();
  expect(screen.getByText('Vélo')).toBeInTheDocument();
});

test('toggling an option switch calls setOptionEnabled', async () => {
  const user = userEvent.setup();
  const ctx = renderExtras();
  // The first switch belongs to the "Petit-déjeuner" option row. MUI 9 upgraded
  // <Switch> to expose role="switch" instead of "checkbox" per WAI-ARIA — the
  // accessibility fix that broke this assertion at migration time.
  await user.click(screen.getAllByRole('switch')[0]);
  expect(ctx.setOptionEnabled).toHaveBeenCalledWith(10, true);
});

test('editing an enabled option quantity calls setOptionQuantity on blur', () => {
  const ctx = renderExtras({
    form: { selectedOptions: [{ optionId: 10, quantity: 2, totalPrice: 20 }] },
  });
  // QuantityField commits on blur (local draft), not per keystroke.
  const input = screen.getByLabelText('Qté');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '5' } });
  fireEvent.blur(input);
  expect(ctx.setOptionQuantity).toHaveBeenCalledWith(10, 5);
});

test('"Ajouter une ligne" calls addCustomOption', async () => {
  const user = userEvent.setup();
  const ctx = renderExtras();
  await user.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
  expect(ctx.addCustomOption).toHaveBeenCalled();
});

// Bug 2026-07-20: « Prix TTC » was a type="number" input — typing a French comma (« 12,5 »)
// blanked the value to 0 and the next live recompute dropped the whole line. The field is now
// an ArithmeticTextField: comma accepted, value committed on blur/Enter only.
test('typing a comma amount in a custom line commits the decimal on blur', async () => {
  const user = userEvent.setup();
  const ctx = renderExtras({
    form: { customOptions: [{ customKey: 'custom_1', description: 'Ménage', amount: 0 }] },
  });
  const amountField = screen.getByLabelText('Prix TTC');
  await user.click(amountField);
  await user.clear(amountField);
  await user.type(amountField, '12,5');
  // No commit while typing — the comma must not zero the amount mid-edit.
  expect(ctx.updateCustomOption).not.toHaveBeenCalled();
  await user.tab();
  expect(ctx.updateCustomOption).toHaveBeenCalledWith('custom_1', { amount: 12.5 });
});

test('an auto-timed option (autoEnabled=1) renders the "Ajout automatique" hint', () => {
  renderExtras({
    propertyOptions: [{ id: 11, title: 'Check-in anticipé', price: 20, priceType: 'per_stay', autoOptionType: 'early_check_in', autoEnabled: 1 }],
  });
  expect(screen.getByText('Ajout automatique')).toBeInTheDocument();
});

// 2026-06-02 regression — the bed-linen / bathroom-linen seeds carry `autoOptionType` purely
// as an undeletability marker in the catalog (see specs/weekly-bed-linen-tracking.md §4.4). They
// must behave like manual options on the reservation form: Switch ENABLED, no "Ajout
// automatique" hint. The discriminator for "engine-derived" is `autoEnabled === 1`, NOT the
// mere presence of `autoOptionType`.
test('a typed-default linen option (autoOptionType set + autoEnabled=0) behaves as a manual option', async () => {
  const user = userEvent.setup();
  const ctx = renderExtras({
    propertyOptions: [{
      id: 42, title: 'Linge de lit', price: 0, priceType: 'per_stay',
      autoOptionType: 'bed_linen', autoEnabled: 0, countsAsBedLinen: 1,
    }],
  });
  // No auto-add hint anywhere on screen.
  expect(screen.queryByText('Ajout automatique')).not.toBeInTheDocument();
  // The first switch is the linen option's Switch (the only one in propertyOptions). It must
  // not be disabled and must round-trip the click to setOptionEnabled — i.e. the manual flow
  // works end-to-end. MUI 9 exposes <Switch> as role="switch" (see comment above).
  const optionSwitch = screen.getAllByRole('switch')[0];
  expect(optionSwitch).not.toBeDisabled();
  await user.click(optionSwitch);
  expect(ctx.setOptionEnabled).toHaveBeenCalledWith(42, true);
});
