// specs/plugins-phase-3b-neat.md rules 16, 22 — a plugin draws under the lines it applies to, from its
// own block; an option the catalogue hides but the stay carries is drawn read-only at its frozen price.
import React from 'react';
import { render, screen, within } from '@testing-library/react';

import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';
import DialogProvider from '../../DialogProvider';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

const INSURANCE = {
  id: 42, title: 'Assurance annulation', price: 4, priceType: 'percent_of_stay', isCancellationInsurance: 1,
};
const CLEANING = { id: 1, title: 'Ménage', price: 80, priceType: 'per_stay' };

function renderExtras(propertyOptions, pluginBlocks = {}) {
  render(
    <DialogProvider>
    <ReservationFormProvider value={makeMockContext({
      propertyOptions,
      displayableResources: [],
      form: {
        selectedOptions: [{ optionId: 42, quantity: 1, totalPrice: 23 }, { optionId: 1, quantity: 1, totalPrice: 80 }],
        customOptions: [],
        selectedResources: [],
      },
      pluginBlocks,
    })}
    >
      <ExtrasSection />
    </ReservationFormProvider>
    </DialogProvider>,
  );
}

const card = (title) => screen.getByText(title).closest('.MuiCard-root');

test('a contribution renders under the line it applies to, and only there', async () => {
  renderExtras([INSURANCE, CLEANING], { neat: { status: 'pending' } });
  expect(await within(card('Assurance annulation')).findByText('Neat : en attente')).toBeInTheDocument();
  expect(card('Ménage').textContent).not.toMatch(/Neat/);
});

test('a frozen option shows its price, a disabled switch and no quantity control', () => {
  renderExtras([CLEANING, { ...INSURANCE, readOnly: true, readOnlyReason: 'Lecture seule : plugin Neat inactif' }]);
  const insurance = card('Assurance annulation');
  expect(within(insurance).getByText('Prix figé : 23,00 €')).toBeInTheDocument();
  expect(within(insurance).getByText('Lecture seule : plugin Neat inactif')).toBeInTheDocument();
  expect(within(insurance).getAllByRole('switch')).toHaveLength(1);
  expect(within(insurance).getByRole('switch')).toBeDisabled();
  expect(within(insurance).queryByText(/Total/)).not.toBeInTheDocument();
  expect(within(card('Ménage')).getAllByRole('switch')[0]).not.toBeDisabled();
});
