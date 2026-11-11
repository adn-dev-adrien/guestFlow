// specs/hosting-h2-account-security.md rule 24 — a support session is refused the iCal export token:
// the card says so instead of showing an empty address.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getIcalToken: vi.fn() },
}));

import api from '../../api';
import IcalExportCard from '../IcalExportCard';

beforeEach(() => api.getIcalToken.mockReset());

test('rule 24 — a refused token shows the refusal, never an empty address field', async () => {
  api.getIcalToken.mockRejectedValueOnce(Object.assign(new Error('Identifiants et accès réservés au client.'), { status: 403 }));
  render(<IcalExportCard propertyId={3} propertyName="Gîte" />);
  expect(await screen.findByText('Identifiants et accès réservés au client.')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('rule 24 — the owner still sees the address', async () => {
  api.getIcalToken.mockResolvedValueOnce({ url: 'https://example.test/api/ical/export/abc.ics' });
  render(<IcalExportCard propertyId={3} propertyName="Gîte" />);
  expect(await screen.findByDisplayValue('https://example.test/api/ical/export/abc.ics')).toBeInTheDocument();
});
