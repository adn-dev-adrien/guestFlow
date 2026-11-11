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

test('rule 7: « Emails incomplets » on the dashboard only while a stay within 14 days is concerned', () => {
  // The 14-day count is the server's (soonCount → the home's subject, specs/shell-and-home-day-first.md
  // rule 6); the card draws what it is given and leads to « Textes des emails ».
  const attention = { key: 'email-readiness', severity: 'todo', count: 2, title: 'Emails incomplets', detail: '2 points à compléter avant les prochaines arrivées' };
  const { unmount } = render(<MemoryRouter><EmailReadinessAlert attention={attention} /></MemoryRouter>);
  expect(screen.getByText('Emails incomplets')).toBeInTheDocument();
  expect(screen.getByText('2 points à compléter avant les prochaines arrivées')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Compléter' }));
  expect(navigate).toHaveBeenCalledWith('/settings/emails/textes');
  unmount();
  const { container } = render(<MemoryRouter><EmailReadinessAlert attention={null} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
