// Shared wrapper for the console's component tests: GuestFlow's theme, the dialog provider and a
// router at the given path.
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@gf/theme';
import DialogProvider from '@gf/components/DialogProvider';

export function renderAt(ui, { path = '/', route = '/' } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <DialogProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </DialogProvider>
    </ThemeProvider>,
  );
}

export function setWidth(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
  };
}

// A customer page payload as the server sends it (CustomerPage suites).
export const customerFixture = {
  id: 3, slug: 'moulin', url: 'https://moulin.guestflow.fr', companyName: 'Le Moulin', contactName: 'Jo', contactEmail: 'jo@moulin.fr',
  state: 'grace', stateLabel: 'Grâce', stateNote: null, planCode: 'pro', planName: 'Pro', billing: 'monthly', billingLabel: 'mensuel',
  priceLabel: '59,00 € HT / mois', catalogueVersion: 1, endsAt: '2026-09-24', endsAtLabel: '24/09/2026', trialEndsAtLabel: null, daysLeft: -5,
  addons: [], grandfathered: [{ id: 'neat', name: 'Assurance annulation Neat' }], archivedAt: null, eraseAtLabel: null,
  plans: [
    { code: 'pro', name: 'Pro', addonChoices: [{ pluginId: 'neat', name: 'Assurance annulation Neat', priceLabel: '9,00 € HT / mois', included: false }] },
    { code: 'premium', name: 'Premium', addonChoices: [{ pluginId: 'neat', name: 'Assurance annulation Neat', priceLabel: '9,00 € HT / mois', included: true }] },
  ],
  steps: [
    { step: 'licence', label: 'Licence signée', kind: 'auto', status: 'failed', detail: 'Dossier de l’instance introuvable.', action: 'retry' },
    { step: 'instance', label: 'Dossier, clé de chiffrement et base', kind: 'manual', status: 'todo', detail: '', action: 'done' },
  ],
  deprovisionSteps: [], history: [{ day: '29/09/2026', text: 'Client créé', operator: 'adrien@adn-dev.fr' }], invoices: [], emails: [],
  billingIdentity: {
    street: '1 rue du Moulin', postcode: '07140', city: 'Les Vans', country: 'FR', vatNumber: '',
    lines: [{ label: 'Adresse', value: '1 rue du Moulin, 07140 Les Vans, France' }, { label: 'N° de TVA', value: '—' }, { label: 'Client Qonto', value: 'créé à la première facture' }],
  },
  countries: [{ code: 'FR', name: 'France' }, { code: 'BE', name: 'Belgique' }],
  paymentPreview: [
    { months: 1, amount: '59,00 € HT', text: 'Nouvelle échéance : 29/10/2026 (l’échéance est passée : la période part d’aujourd’hui). État : Actif.' },
    { months: 12, amount: '708,00 € HT', text: 'Nouvelle échéance : 29/09/2027 (l’échéance est passée : la période part d’aujourd’hui). État : Actif.' },
  ],
  defaults: { paymentMonths: 1, extendTo: '2026-10-09', forceActiveUntil: '2026-10-06' },
  actions: {
    pay: true, extend: true, forceActive: true, changePlan: true, downloadLicence: true, deprovision: true, reactivate: false, cancelErase: false, eraseNow: false,
    editBilling: true, remind: false, remindHint: 'Aucune facture ouverte à relancer.', checkPayment: false,
  },
};
