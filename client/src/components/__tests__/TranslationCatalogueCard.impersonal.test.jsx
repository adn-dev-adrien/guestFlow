// specs/translation-catalogue.md rule 20 (note 2026-10-18) — the card explains the loop impersonally,
// without « tu ».
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({
  default: { getTranslationSummary: vi.fn(), importTranslations: vi.fn(), downloadTranslations: vi.fn() },
}));

import api from '../../api';
import TranslationCatalogueCard from '../TranslationCatalogueCard';

test('rule 20: the explanation speaks to no one', async () => {
  api.getTranslationSummary.mockResolvedValue({ languages: ['fr', 'en'], total: 60, untranslated: { en: 12 }, needsReview: 3 });
  render(<TranslationCatalogueCard />);
  expect(await screen.findByText(/Traductions dans un fichier : le télécharger/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/télécharge-le|remplis|ajoute simplement/);
});
