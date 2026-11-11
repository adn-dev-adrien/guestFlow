// specs/ical-export-guest-privacy.md (amended 2026-10-18) — the export card's title and line: no emoji,
// no « vous », and it says only the dates leave GuestFlow.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const api = vi.hoisted(() => ({ getIcalToken: vi.fn() }));
vi.mock('../../api', () => ({ default: api }));

import IcalExportCard from '../IcalExportCard';

test('the card reads « Lien d’export iCal » and shows the link', async () => {
  api.getIcalToken.mockResolvedValue({ url: 'https://gf.example/api/ical/export/abc' });
  render(<IcalExportCard propertyId={1} propertyName="La Granja" />);
  expect(await screen.findByDisplayValue('https://gf.example/api/ical/export/abc')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Lien d’export iCal' })).toBeInTheDocument();
  expect(screen.getByText(/bloquer les dates prises ici\. Seules les dates sont transmises\./)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/📅|Utilisez|vos réservations/);
});
