// The harness of the logement's leave-guard suites: a real BrowserRouter around the page. `vi.mock` of the api stays in each suite.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { vi } from 'vitest';

import DialogProvider from '../../components/DialogProvider';
import PropertyDetail from '../PropertyDetail';
import api from '../../api';
import { LIMITS } from '../../components/property/__tests__/propertyLimitsFixtures';

export const PROPERTY = {
  id: 5, name: 'Le Moulin', nameArticle: 'au', maxGuests: 3, maxBabies: 1, singleBeds: 1, doubleBeds: 2,
  depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7, defaultCautionAmount: 0,
  defaultCheckIn: '15:00', defaultCheckOut: '10:00', cleaningHours: 3, pricingRules: [], documents: [], photo: null,
  pendingFacts: '', cleaningIncluded: 1, towelsProvided: 1, poolSeasonStart: '', poolSeasonEnd: '',
};
export const FACTS = { address: '', mapUrl: '', accessFr: '', accessEn: '', wifiName: 'Moulin', hasAccessCode: false, hasWifiPassword: false };

export function renderApp() {
  window.history.replaceState(null, '', '/prev');
  render(
    <BrowserRouter>
      <DialogProvider>
        <Link to="/properties/5?tab=sejour">vers le logement</Link>
        <Link to="/clients">vers les clients</Link>
        <Routes>
          <Route path="/prev" element={<p>page précédente</p>} />
          <Route path="/properties" element={<p>liste des logements</p>} />
          <Route path="/properties/:id" element={<PropertyDetail />} />
          <Route path="/properties/:id/pricing-seasons" element={<p>gestion tarifaire</p>} />
          <Route path="/clients" element={<p>liste des clients</p>} />
        </Routes>
      </DialogProvider>
    </BrowserRouter>,
  );
  fireEvent.click(screen.getByText('vers le logement'));
}

export async function openDirty() {
  renderApp();
  const wifi = await screen.findByLabelText('Réseau Wi-Fi');
  await waitFor(() => expect(wifi).toHaveValue('Moulin'));
  fireEvent.change(wifi, { target: { value: 'Autre' } });
  await waitFor(() => expect(typeof window.__guestflowBeforeBack).toBe('function'));
}

export function resetLogementMocks() {
  vi.clearAllMocks();
  api.getPropertyLimits.mockResolvedValue(LIMITS);
  api.getOptions.mockResolvedValue([]);
  api.getProperty.mockResolvedValue({ ...PROPERTY });
  api.getPropertyArrivalFacts.mockResolvedValue({ ...FACTS });
  api.savePropertyArrivalFacts.mockResolvedValue({ ...FACTS, wifiName: 'Autre' });
  api.updateProperty.mockResolvedValue({});
  api.getPropertyPlatforms.mockResolvedValue({ platforms: [] });
  api.getPlatformSettings.mockResolvedValue({ platforms: [] });
}

export function clearLeaveGuards() {
  delete window.__guestflowBeforeBack;
  delete window.__guestflowBeforeNavigate;
  window.history.replaceState(null, '', '/');
}
