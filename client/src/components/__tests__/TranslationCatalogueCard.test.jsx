import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// specs/translation-catalogue.md rules 12, 20 — the card is the whole of the loop: what is still
// missing, one file down, one file up. The behaviour worth guarding is the refusal: a file that
// REMOVES translations must be confirmed, and cancelling must send nothing.

vi.mock('../../api', () => ({
  default: {
    getTranslationSummary: vi.fn(),
    importTranslations: vi.fn(),
    downloadTranslations: vi.fn(),
  },
}));

import api from '../../api';
import TranslationCatalogueCard from '../TranslationCatalogueCard';

const SUMMARY = { languages: ['fr', 'en'], total: 60, untranslated: { en: 12 }, needsReview: 3 };

/** A picked file, as the browser hands it to the component. */
function csvFile(contents = 'clé,où,français,english,à revérifier\n') {
  return new File([contents], 'traductions.csv', { type: 'text/csv' });
}

async function renderCard(summary = SUMMARY) {
  api.getTranslationSummary.mockResolvedValue(summary);
  render(<TranslationCatalogueCard />);
  await screen.findByText(/60 textes/);
}

beforeEach(() => {
  vi.clearAllMocks();
});

test('shows what is translatable, what is missing and what is owed a second look (rule 20)', async () => {
  await renderCard();
  expect(screen.getByText(/60 textes · 12 sans anglais · 3 à revérifier/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Télécharger le fichier/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Envoyer un fichier/ })).toBeInTheDocument();
});

test('a nothing-missing catalogue says so without inventing a count', async () => {
  await renderCard({ languages: ['fr', 'en'], total: 60, untranslated: { en: 0 }, needsReview: 0 });
  expect(screen.getByText('60 textes')).toBeInTheDocument();
});

test('an import that removes translations asks first, and cancelling sends nothing (rule 12)', async () => {
  const user = userEvent.setup();
  await renderCard();
  api.importTranslations.mockRejectedValueOnce(Object.assign(new Error('Ce fichier retire 4 traduction(s).'), {
    error: 'REMOVALS_NOT_CONFIRMED', removals: 4,
  }));

  await user.upload(document.querySelector('input[type="file"]'), csvFile());

  await screen.findByText(/Ce fichier retire 4 traduction/);
  expect(api.importTranslations).toHaveBeenCalledTimes(1);
  expect(api.importTranslations).toHaveBeenLastCalledWith(expect.any(String), { confirmRemovals: false });

  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  await screen.findByText(/Envoi annulé/);
  // The whole point: cancelling must not send a second, confirmed request.
  expect(api.importTranslations).toHaveBeenCalledTimes(1);
});

test('confirming sends the same file back, this time with the removals accepted (rule 12)', async () => {
  const user = userEvent.setup();
  await renderCard();
  api.importTranslations
    .mockRejectedValueOnce(Object.assign(new Error('retire'), { error: 'REMOVALS_NOT_CONFIRMED', removals: 4 }))
    .mockResolvedValueOnce({ updated: 43, cleared: 4, reviewCleared: 0, ignoredUnknown: 2 });

  await user.upload(document.querySelector('input[type="file"]'), csvFile('clé,où,français,english\nk,Option · titre,Jus,\n'));
  await screen.findByText(/Ce fichier retire 4 traduction/);
  await user.click(screen.getByRole('button', { name: /Appliquer quand même/ }));

  await waitFor(() => expect(api.importTranslations).toHaveBeenCalledTimes(2));
  expect(api.importTranslations).toHaveBeenLastCalledWith(expect.any(String), { confirmRemovals: true });
  await screen.findByText(/43 traduction\(s\) mises à jour · 4 retirée\(s\) · 2 clé\(s\) inconnue\(s\) ignorée\(s\)\./);
});

test('a malformed file is reported with its line, and nothing is claimed to have changed (rule 11)', async () => {
  const user = userEvent.setup();
  await renderCard();
  api.importTranslations.mockRejectedValueOnce(Object.assign(
    new Error("Ligne 18 : la colonne « clé » est absente. Rien n'a été modifié."),
    { error: 'MALFORMED_CSV', line: 18 },
  ));
  await user.upload(document.querySelector('input[type="file"]'), csvFile());
  await screen.findByText(/Ligne 18/);
  expect(screen.getByText(/Rien n'a été modifié/)).toBeInTheDocument();
});
