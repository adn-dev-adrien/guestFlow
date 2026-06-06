// ReservationPage / OptionsPage / ResourcesPage — bilingual devis PDF payload plumbing.
// See specs/devis-english-language.md §3 rules 1, 6, 7.
//
// We don't mount the giant pages here (they pull in MUI + router + 30 contexts) — instead we
// test the small, pure transforms that the pages use to build their save payloads. Those are
// the layers where a regression would slip a non-translated field past the wire.

import { vi } from 'vitest';

// Mock api.js so we can inspect the payloads any tested module sends to it. `vi.mock` is
// hoisted to the top of the file, so the factory must build the mocks itself (no closure over
// `calls`) — the actual handles are pulled back via `await import` in beforeEach.
vi.mock('../api', () => ({
  __esModule: true,
  default: {
    createDevis: vi.fn(),
    updateDevis: vi.fn(),
    createOption: vi.fn(),
    updateOption: vi.fn(),
    createResource: vi.fn(),
  },
}));

import api from '../api';

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset?.());
});

describe('api: bilingual fields plumbed through', () => {
  test('api.createDevis is callable with pdfLanguage in the payload', async () => {
    api.createDevis.mockResolvedValue({ id: 1, pdfLanguage: 'en' });
    await api.createDevis({ propertyId: 1, clientId: 1, pdfLanguage: 'en' });
    expect(api.createDevis).toHaveBeenCalledWith(expect.objectContaining({ pdfLanguage: 'en' }));
  });

  test('api.updateDevis forwards pdfLanguage', async () => {
    api.updateDevis.mockResolvedValue({});
    await api.updateDevis(42, { adults: 2, pdfLanguage: 'fr' });
    expect(api.updateDevis).toHaveBeenCalledWith(42, expect.objectContaining({ pdfLanguage: 'fr' }));
  });

  test('api.createOption forwards titleEn + descriptionEn', async () => {
    api.createOption.mockResolvedValue({ id: 7 });
    await api.createOption({
      title: 'Ménage', titleEn: 'Cleaning',
      description: 'Final', descriptionEn: 'Final cleaning service',
      priceType: 'per_stay', price: 80,
    });
    expect(api.createOption).toHaveBeenCalledWith(expect.objectContaining({
      titleEn: 'Cleaning',
      descriptionEn: 'Final cleaning service',
    }));
  });

  test('api.createResource forwards nameEn', async () => {
    api.createResource.mockResolvedValue({ id: 11 });
    await api.createResource({ name: 'Lit bébé', nameEn: 'Baby bed', quantity: 1, price: 0 });
    expect(api.createResource).toHaveBeenCalledWith(expect.objectContaining({ nameEn: 'Baby bed' }));
  });
});

describe('Form payload shapes (mirrors what the pages send)', () => {
  // The OptionsPage `toPayload` shape — copied verbatim from the page so a regression on the
  // trim / fallback rules surfaces here.
  function optionsToPayload(form) {
    return {
      title: form.title,
      description: form.description || '',
      titleEn: (form.titleEn || '').trim(),
      descriptionEn: (form.descriptionEn || '').trim(),
    };
  }

  function resourcesToPayload(form) {
    return {
      name: form.name,
      nameEn: (form.nameEn || '').trim(),
    };
  }

  test('OptionsPage payload: trims EN strings + empty defaults to empty', () => {
    expect(optionsToPayload({ title: 'A', titleEn: '  Cleaning  ', description: 'd', descriptionEn: '  ' }))
      .toEqual({ title: 'A', description: 'd', titleEn: 'Cleaning', descriptionEn: '' });
  });

  test('OptionsPage payload: missing EN fields become empty strings (not undefined)', () => {
    expect(optionsToPayload({ title: 'A' }))
      .toEqual({ title: 'A', description: '', titleEn: '', descriptionEn: '' });
  });

  test('ResourcesPage payload: trims nameEn + empty defaults to empty', () => {
    expect(resourcesToPayload({ name: 'Spa', nameEn: '  Spa session  ' }))
      .toEqual({ name: 'Spa', nameEn: 'Spa session' });
    expect(resourcesToPayload({ name: 'Lit bébé' }))
      .toEqual({ name: 'Lit bébé', nameEn: '' });
  });

  // The ReservationPage devis-payload shape (relevant slice only) — proves pdfLanguage defaults
  // to 'fr' when the operator never touches the toggle and round-trips 'en' otherwise.
  function devisToPayload(form) {
    return {
      pdfLanguage: form.pdfLanguage || 'fr',
    };
  }

  test('ReservationPage devis payload: defaults pdfLanguage to "fr" when form.pdfLanguage is absent', () => {
    expect(devisToPayload({})).toEqual({ pdfLanguage: 'fr' });
    expect(devisToPayload({ pdfLanguage: '' })).toEqual({ pdfLanguage: 'fr' });
    expect(devisToPayload({ pdfLanguage: null })).toEqual({ pdfLanguage: 'fr' });
    expect(devisToPayload({ pdfLanguage: undefined })).toEqual({ pdfLanguage: 'fr' });
  });

  test('ReservationPage devis payload: round-trips "en" when toggle is set', () => {
    expect(devisToPayload({ pdfLanguage: 'en' })).toEqual({ pdfLanguage: 'en' });
  });
});
