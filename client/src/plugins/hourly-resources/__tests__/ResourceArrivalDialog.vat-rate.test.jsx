// specs/outside-booking-sas.md §6, rule 48 (loop t1 AV-10) — each line of the mini SAS names its VAT rate as the server serves it (`line.vatRate`): the session, a stored extra
// and a priced draft extra. The rate is printed, never chosen or computed here.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { visitPayload, sessionLine } from './arrivalVisitFixtures';

vi.mock('../../../api', () => ({
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const STORED_DRINK = {
  id: 12, ref: 'line:standalone_sale_lines:12', kind: 'extra', label: 'Limonade', detail: '1 × 4,00 €', components: [], quantity: 1, unitCents: 400, totalCents: 400, catalogueCents: 400,
  offered: false, status: 'due', statusLabel: 'À payer', settledCents: 0, vatRate: 5.5, legacy: false, draft: false,
};

test('the session reads « TVA 20 % », a stored drink « TVA 5,5 % »', async () => {
  api.getResourceVisit.mockResolvedValue(visitPayload({ lines: [sessionLine(), STORED_DRINK] }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('TVA 20 %')).toBeInTheDocument();
  expect(screen.getByText('1 × 4,00 € · TVA 5,5 % · À payer')).toBeInTheDocument();
});

test('a line served without a rate prints none', async () => {
  api.getResourceVisit.mockResolvedValue(visitPayload({ lines: [sessionLine({ vatRate: null })] }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  const session = (await screen.findByText('Sa séance')).parentElement;
  expect(within(session).queryByText(/TVA/)).toBeNull();
});
