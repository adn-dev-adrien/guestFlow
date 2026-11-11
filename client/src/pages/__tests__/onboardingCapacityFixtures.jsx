// Shared fixtures for OnboardingPage.default-capacity.test.jsx — a fresh instance, on step 2.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import OnboardingPage from '../OnboardingPage';

export const FRESH_ONBOARDING = {
  open: true,
  company: { name: 'Les Cabanes', email: 'contact@cabanes.fr' },
  property: { id: null, existing: 0, draft: null },
  emails: { phone: '', senderName: 'Les Cabanes', previewStableKey: 'arrival_reminder_1d', properties: [] },
  plugins: [],
  questions: [],
};

export async function openPropertyStep() {
  render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
  await screen.findByText('Étape 1 sur 5');
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  await screen.findByText('Étape 2 sur 5');
}

export const typeInto = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
