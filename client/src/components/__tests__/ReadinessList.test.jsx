// specs/guest-email-texts-made-simple.md rules 6–7 — « À compléter »: the server's items as links to
// where each is fixed; nothing when complete; the dashboard card counts what concerns a stay soon.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigate }));
vi.mock('../../api', () => ({ __esModule: true, default: { getEmailReadiness: vi.fn() } }));

import api from '../../api';
import ReadinessList from '../ReadinessList';
import EmailReadinessAlert from '../EmailReadinessAlert';

const ITEMS = [
  { id: 'company.phone', label: 'Téléphone de l’entreprise', target: { path: '/settings/etablissement' } },
  { id: 'property.address:1', label: 'Adresse — Le Gîte', target: { path: '/properties/1', search: 'tab=sejour' } },
  { id: 'english:text:house', label: 'Anglais manquant — Dans le logement', target: { path: '/settings/emails/textes', hash: 'j2' } },
];

beforeEach(() => vi.clearAllMocks());

test('rule 6: each item links to where it is fixed', () => {
  render(<MemoryRouter><ReadinessList items={ITEMS} /></MemoryRouter>);
  expect(screen.getByText('À compléter (3)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Adresse — Le Gîte' }));
  expect(navigate).toHaveBeenCalledWith('/properties/1?tab=sejour');
  fireEvent.click(screen.getByRole('button', { name: 'Anglais manquant — Dans le logement' }));
  expect(navigate).toHaveBeenCalledWith('/settings/emails/textes#j2');
});

test('rule 6: nothing when complete, or the done label when asked', () => {
  const { container, rerender } = render(<MemoryRouter><ReadinessList items={[]} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
  rerender(<MemoryRouter><ReadinessList items={[]} doneLabel="Emails prêts" /></MemoryRouter>);
  expect(screen.getByText('Emails prêts')).toBeInTheDocument();
});

test('rule 7: « Emails incomplets » on the dashboard only while a stay within 14 days is concerned', async () => {
  api.getEmailReadiness.mockResolvedValueOnce({ items: ITEMS, soonCount: 2 });
  const { unmount } = render(<MemoryRouter><EmailReadinessAlert /></MemoryRouter>);
  expect(await screen.findByText('Emails incomplets')).toBeInTheDocument();
  expect(screen.getByText('2 points à compléter avant les prochaines arrivées.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Emails incomplets'));
  expect(navigate).toHaveBeenCalledWith('/settings/emails/textes');
  unmount();
  api.getEmailReadiness.mockResolvedValueOnce({ items: ITEMS, soonCount: 0 });
  const { container } = render(<MemoryRouter><EmailReadinessAlert /></MemoryRouter>);
  await new Promise((r) => setTimeout(r, 0));
  expect(container).toBeEmptyDOMElement();
});
