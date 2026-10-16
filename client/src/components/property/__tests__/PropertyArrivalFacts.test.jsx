// specs/guest-email-texts-made-simple.md rules 1–2, 12 — the « Arrivée » block of a property: the facts
// saved on their own, the code and the Wi-Fi password masked and sent only when typed, and the link to
// « Textes des emails ».
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({ __esModule: true, default: { getPropertyArrivalFacts: vi.fn(), savePropertyArrivalFacts: vi.fn() } }));
vi.mock('../../DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import PropertyArrivalFacts from '../PropertyArrivalFacts';

const FACTS = { address: '12 chemin des Prés', mapUrl: '', accessFr: 'Porte bleue.', accessEn: '', hasAccessCode: true, wifiName: 'Gite', hasWifiPassword: false };

beforeEach(() => {
  vi.clearAllMocks();
  api.getPropertyArrivalFacts.mockResolvedValue(FACTS);
  api.savePropertyArrivalFacts.mockResolvedValue(FACTS);
});

const renderBlock = () => render(<MemoryRouter><PropertyArrivalFacts propertyId={1} /></MemoryRouter>);

test('rules 1–2: the facts are saved; a masked secret is not sent until typed', async () => {
  renderBlock();
  expect(await screen.findByDisplayValue('12 chemin des Prés')).toBeInTheDocument();
  expect(screen.getAllByText('••••••••••')).toHaveLength(1);
  const save = screen.getByRole('button', { name: 'Enregistrer l’arrivée' });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Réseau Wi-Fi'), { target: { value: 'Gite-Invites' } });
  fireEvent.click(save);
  await waitFor(() => expect(api.savePropertyArrivalFacts).toHaveBeenCalledWith(1, {
    address: '12 chemin des Prés', mapUrl: '', accessFr: 'Porte bleue.', accessEn: '', wifiName: 'Gite-Invites',
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
  fireEvent.change(screen.getByLabelText('Code de la boîte à clés'), { target: { value: '4521' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’arrivée' }));
  await waitFor(() => expect(api.savePropertyArrivalFacts).toHaveBeenLastCalledWith(1, expect.objectContaining({ accessCode: '4521' })));
});

test('rule 12: the property links to its texts on « Textes des emails »', async () => {
  renderBlock();
  expect(await screen.findByRole('link', { name: 'Textes des emails' })).toHaveAttribute('href', '/settings/emails/textes?propertyId=1#j2');
});
