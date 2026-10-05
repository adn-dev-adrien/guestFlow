// specs/neat-cancellation-insurance-subscription.md §3.3 rules 13-16, drawn by the neat plugin in the
// `reservation.optionLine` slot (specs/plugins-phase-3b-neat.md rule 16). The block is server-shaped:
// the plugin renders it, calls its two endpoints and hands the answer back to the fiche.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ReservationFormProvider } from '../../../components/reservation/ReservationFormContext';
import ExtrasSection from '../../../components/reservation/ExtrasSection';
import { makeMockContext } from '../../../components/reservation/mockReservationForm';
import DialogProvider from '../../../components/DialogProvider';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    retryNeatSubscription: vi.fn(),
    voidNeatSubscription: vi.fn(),
  },
}));

import api from '../../../api';

const INSURANCE = {
  id: 42, title: 'Assurance annulation', price: 3, priceType: 'per_night', isCancellationInsurance: 1,
};
const CLEANING = { id: 1, title: 'Ménage', price: 80, priceType: 'per_night' };

function renderExtras({ neat = null, selectedOptions = [{ optionId: 42, quantity: 1, totalPrice: 23 }] } = {}) {
  const context = makeMockContext({
    propertyOptions: [INSURANCE, CLEANING],
    displayableResources: [],
    form: { selectedOptions, customOptions: [], selectedResources: [] },
    pluginBlocks: { neat },
    pluginLineContext: { reservationId: 71, guestName: 'Jean Dupont' },
  });
  render(
    <DialogProvider>
      <ReservationFormProvider value={context}>
        <ExtrasSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  return context;
}

beforeEach(() => vi.clearAllMocks());

test('no Neat block → nothing under the line (plugin off, or nothing to show yet)', async () => {
  renderExtras({ neat: null });
  await screen.findByText('Assurance annulation');
  expect(screen.queryByText(/Neat/)).not.toBeInTheDocument();
});

test('active → « Neat : souscrite » + the premium derivation; voiding asks first, then hands the answer back', async () => {
  api.voidNeatSubscription.mockResolvedValue({ neat: { status: 'voided' } });
  const context = renderExtras({
    neat: { status: 'active', neatId: 'sub-1', premiumAmount: 17.5, billedAmount: 23, marginPercent: 30, lastError: null },
  });
  expect(await screen.findByText('Neat : souscrite')).toBeInTheDocument();
  expect(screen.getByText(/Prime Neat 17,50\s*€ • marge \+30 % • arrondi €↑/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Résilier chez Neat' }));
  expect(await screen.findByText(/Résilier la souscription Neat de Jean Dupont/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Résilier' }));
  await waitFor(() => expect(api.voidNeatSubscription).toHaveBeenCalledWith(71));
  await waitFor(() => expect(context.setPluginBlock).toHaveBeenCalledWith('neat', { status: 'voided' }));
});

test('pending → « Neat : en attente », no action button', async () => {
  renderExtras({ neat: { status: 'pending', premiumAmount: null, lastError: null } });
  expect(await screen.findByText('Neat : en attente')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Réessayer|Résilier/ })).not.toBeInTheDocument();
});

test('failed → « Neat : en échec » + « Réessayer maintenant » calls the plugin endpoint', async () => {
  api.retryNeatSubscription.mockResolvedValue({ neat: { status: 'active' } });
  const context = renderExtras({
    neat: { status: 'failed', premiumAmount: null, lastError: 'Neat indisponible', errorKind: 'unavailable' },
  });
  expect(await screen.findByText('Neat : en échec')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer maintenant' }));
  await waitFor(() => expect(api.retryNeatSubscription).toHaveBeenCalledWith(71));
  await waitFor(() => expect(context.setPluginBlock).toHaveBeenCalledWith('neat', { status: 'active' }));
});

test('line removed while active → warning chip + guidance + « Résilier chez Neat » still offered', async () => {
  renderExtras({
    neat: { status: 'line_removed_active', neatId: 'sub-1', premiumAmount: 17.5, marginPercent: 30 },
    selectedOptions: [],
  });
  expect(await screen.findByText('Ligne retirée — souscription active')).toBeInTheDocument();
  expect(screen.getByText(/toujours active/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Résilier chez Neat' })).toBeInTheDocument();
});

test('the chip never leaks onto an ordinary option card', async () => {
  renderExtras({
    neat: { status: 'active', premiumAmount: 17.5, marginPercent: 30 },
    selectedOptions: [{ optionId: 1, quantity: 1, totalPrice: 320 }],
  });
  await screen.findByText('Neat : souscrite');
  const cleaningCard = screen.getByText('Ménage').closest('.MuiCard-root');
  expect(cleaningCard.textContent).not.toMatch(/Neat/);
});
