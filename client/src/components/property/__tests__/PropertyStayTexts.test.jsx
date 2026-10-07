// specs/plugins-phase-p-productisation.md rule 3 — « Textes propres à ce logement »: empty with the
// global text as placeholder, saved text by text with the property's id.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../api', () => ({ __esModule: true, default: { getStayTexts: vi.fn(), saveStayText: vi.fn() } }));
vi.mock('../../DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import PropertyStayTexts from '../PropertyStayTexts';

const ROW = { key: 'house', label: 'Dans le logement', tokens: [], flags: [], fr: '', en: '', globalFr: 'Café et thé à disposition.', globalEn: 'Coffee and tea provided.' };

test('the global text is the placeholder; a property text is saved with its id; a refusal shows', async () => {
  api.getStayTexts.mockResolvedValue({ texts: [ROW] });
  api.saveStayText.mockRejectedValueOnce(Object.assign(new Error('Variable inconnue : {{wifi}}'), { field: 'fr' }));
  render(<PropertyStayTexts propertyId={7} />);
  const fr = await screen.findByLabelText('Français');
  expect(api.getStayTexts).toHaveBeenCalledWith(7);
  expect(fr).toHaveAttribute('placeholder', 'Café et thé à disposition.');
  fireEvent.change(fr, { target: { value: 'Une cafetière italienne {{wifi}}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer ce texte' }));
  expect(await screen.findByText('Variable inconnue : {{wifi}}')).toBeInTheDocument();
  api.saveStayText.mockResolvedValueOnce({});
  fireEvent.change(fr, { target: { value: 'Une cafetière italienne.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer ce texte' }));
  await waitFor(() => expect(api.saveStayText).toHaveBeenLastCalledWith('house', { fr: 'Une cafetière italienne.', en: '', propertyId: 7 }));
});
