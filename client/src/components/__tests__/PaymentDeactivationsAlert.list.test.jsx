// specs/payment-link-lifecycle.md rule 67 — the home card of withdrawn payment links still payable at the provider lists each
// link (kind, amount, reference, stay, reason, date) so the operator can find it at Qonto, and opens Paiements en ligne.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const navigate = vi.fn();
vi.mock('react-router', async () => ({ ...(await vi.importActual('react-router')), useNavigate: () => navigate }));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { id: 1, roles: ['admin'] } }) }));
vi.mock('../../constants/roles', () => ({ canSeeRoute: () => true }));
vi.mock('../../api', () => ({ __esModule: true, default: { getPaymentDeactivations: vi.fn() } }));

import api from '../../api';
import PaymentDeactivationsAlert from '../PaymentDeactivationsAlert';

const attention = { key: 'payment-deactivations', severity: 'urgent', count: 2, title: 'Liens de paiement encore actifs', detail: 'À désactiver depuis Qonto, ou en rétablissant la connexion' };
const LINKS = [
  { id: 13, kindLabel: 'Paiement total', amountLabel: '762,80 €', reference: 'pl_ref_13', providerLabel: 'Qonto', stayLabel: 'Fiche n° 22299', stayUrl: null, reasonLabel: 'Fiche supprimée', sinceLabel: 'lien retiré le 30/10/2026' },
  { id: 14, kindLabel: 'Acompte', amountLabel: '214,94 €', reference: 'pl_ref_14', providerLabel: 'Qonto', stayLabel: 'Séjour 202604014', stayUrl: '/reservations/14', reasonLabel: 'Validité dépassée', sinceLabel: 'fin de validité le 01/11/2026' },
];

const renderCard = () => render(<MemoryRouter><PaymentDeactivationsAlert attention={attention} /></MemoryRouter>);

beforeEach(() => { api.getPaymentDeactivations.mockReset(); navigate.mockReset(); });

test('lists each link with what is needed to find it at the provider, and links the stay that still exists', async () => {
  api.getPaymentDeactivations.mockResolvedValue({ links: LINKS });
  renderCard();
  expect(await screen.findByText('Paiement total · 762,80 €')).toBeInTheDocument();
  expect(screen.getByText('Référence Qonto : pl_ref_13')).toBeInTheDocument();
  expect(screen.getByText(/Fiche n° 22299 · Fiche supprimée · lien retiré le 30\/10\/2026/)).toBeInTheDocument();
  expect(screen.getByText('Acompte · 214,94 €')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Séjour 202604014' })).toHaveAttribute('href', '/reservations/14');
  expect(screen.getByText(/Validité dépassée · fin de validité le 01\/11\/2026/)).toBeInTheDocument();
});

test('the summary words come from the server and the button opens the Paiements en ligne page', async () => {
  api.getPaymentDeactivations.mockResolvedValue({ links: LINKS });
  renderCard();
  expect(screen.getByText(/À désactiver depuis Qonto, ou en rétablissant la connexion/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir les paiements en ligne' }));
  expect(navigate).toHaveBeenCalledWith('/parametres/paiements');
});

test('a list that cannot be read leaves the summary alone, no error', async () => {
  api.getPaymentDeactivations.mockRejectedValue(new Error('down'));
  renderCard();
  await waitFor(() => expect(api.getPaymentDeactivations).toHaveBeenCalled());
  expect(screen.getByText(/À désactiver depuis Qonto/)).toBeInTheDocument();
  expect(screen.queryByText(/Référence/)).toBeNull();
});

test('a converted devis shows both numbers and opens the stay it became; a devis with a deleted stay has no link', async () => {
  api.getPaymentDeactivations.mockResolvedValue({ links: [
    { ...LINKS[1], id: 21, stayLabel: 'Devis 2026-08-001 · séjour 202610001', stayUrl: '/reservations/22310' },
    { ...LINKS[1], id: 22, stayLabel: 'Devis 2026-09-001', stayUrl: null, reference: 'pl_ref_22' },
  ] });
  renderCard();
  expect(await screen.findByRole('link', { name: 'Devis 2026-08-001 · séjour 202610001' })).toHaveAttribute('href', '/reservations/22310');
  expect(screen.getByText(/Devis 2026-09-001/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Devis 2026-09-001' })).toBeNull();
});
