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
  // The first switch belongs to the "Petit-déjeuner" option row.
  await user.click(screen.getAllByRole('checkbox')[0]);
  expect(ctx.setOptionEnabled).toHaveBeenCalledWith(10, true);
});

test('editing an enabled option quantity calls setOptionQuantity', () => {
  const ctx = renderExtras({
    form: { selectedOptions: [{ optionId: 10, quantity: 2, totalPrice: 20 }] },
  });
  fireEvent.change(screen.getByLabelText('Qté'), { target: { value: '5' } });
  expect(ctx.setOptionQuantity).toHaveBeenCalledWith(10, 5);
});

test('"Ajouter une ligne" calls addCustomOption', async () => {
  const user = userEvent.setup();
  const ctx = renderExtras();
  await user.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
  expect(ctx.addCustomOption).toHaveBeenCalled();
});

test('an auto-timed option renders the "Ajout automatique" hint', () => {
  renderExtras({
    propertyOptions: [{ id: 11, title: 'Check-in anticipé', price: 20, priceType: 'per_stay', autoOptionType: 'early_check_in' }],
  });
  expect(screen.getByText('Ajout automatique')).toBeInTheDocument();
});
