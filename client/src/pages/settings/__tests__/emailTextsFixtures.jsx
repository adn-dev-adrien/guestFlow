// Shared fixtures of the « Textes des emails » page suites (specs/guest-email-texts-made-simple.md §7).
// Not a test file: each suite mocks the API itself (vi.mock is hoisted per file).
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const chips = (variables = [], conditions = []) => ({ variables, conditions });

export const SECTIONS = [
  { id: 'confirmation', title: 'Confirmation', templates: [{ id: 3, stableKey: 'reservation_confirmation', name: 'Séquence — Confirmation' }], items: [
    { key: 'subject:reservation_confirmation', kind: 'subject', label: 'Objet', fr: 'Votre séjour {{propertyWithArticle}} est confirmé', en: '', chips: chips([{ name: 'propertyWithArticle', label: 'Logement avec article' }]) },
  ] },
  { id: 'j7', title: 'J-7', templates: [{ id: 1, stableKey: 'arrival_reminder_7d', name: 'Séquence — J-7' }], items: [
    { key: 'subject:arrival_reminder_7d', kind: 'subject', label: 'Objet', fr: 'Plus qu’une semaine', en: 'One week to go', chips: chips() },
    { key: 'hook:1', kind: 'hook', label: 'Accroche — Le Gîte', fr: '', en: '', chips: chips() },
    { key: 'text:offers.localIntro', kind: 'text', label: 'Produits locaux — introduction', fr: 'Nous proposons {{list}}.', en: 'We offer {{list}}.', defaultFr: 'Nous proposons {{list}}.', defaultEn: 'We offer {{list}}.', chips: chips([{ name: 'list', label: 'Liste' }]) },
  ] },
  { id: 'j2', title: 'J-2', templates: [{ id: 2, stableKey: 'arrival_reminder_1d', name: 'Séquence — J-2' }], items: [
    { key: 'subject:arrival_reminder_1d', kind: 'subject', label: 'Objet', fr: 'À bientôt', en: 'See you', chips: chips() },
    { key: 'text:house', kind: 'text', label: 'Dans le logement', fr: 'Café offert.', en: '', defaultFr: '', defaultEn: '', autoTranslated: false, chips: chips() },
    { key: 'access:1', kind: 'access', label: 'Accès — Le Gîte', fr: '', en: '', chips: chips() },
  ] },
];

export const TEXTS = { sections: SECTIONS, properties: [{ id: 1, name: 'Le Gîte' }], propertyId: 1, canTranslate: false };
export const PREVIEW = {
  subject: 'À bientôt', body: 'Bonjour Camille,\n\nCafé offert.', lang: 'fr', reservationId: 7, sample: false,
  reservations: [{ id: 7, label: 'Camille Martin · Le Gîte · 12/10/2026' }], englishNotice: null,
};

export function renderAt(Page, url = '/settings/emails/textes') {
  return render(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>);
}
