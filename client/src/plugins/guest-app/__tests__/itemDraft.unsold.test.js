// specs/guest-app.md rules 22, 39 — the article's quantity bound and lead time are judged only while it is sold: an
// unsold article (fields hidden) never blocks the save on them, nor sends them invalid.
import { draftErrors, patchOf } from '../itemDraft';

const SAVED = {
  sold: true, mediaId: null, shortDescriptionFr: '', shortDescriptionEn: '', needsStaff: true, leadMinutes: '30', maxQuantity: '10', stockTracked: false, stockQuantity: '', stockAlertBelow: '', soldOut: false,
};

test('sold: a bound outside 1-50 and a lead time over 240 are refused', () => {
  const errors = draftErrors({ ...SAVED, maxQuantity: '0', leadMinutes: '300' }, { kind: 'option', saved: SAVED });
  expect(errors).toEqual({ maxQuantity: 'Un entier de 1 à 50.', leadMinutes: 'Un nombre de minutes, de 0 à 240.' });
});

test('unsold: the hidden bound and lead time block nothing and are not sent invalid', () => {
  const draft = { ...SAVED, sold: false, maxQuantity: '', leadMinutes: 'abc' };
  expect(draftErrors(draft, { kind: 'option', saved: SAVED })).toEqual({});
  expect(patchOf(SAVED, draft, { kind: 'option' })).toEqual({ sold: false });
});

test('unsold: a valid bound changed is still written', () => {
  expect(patchOf(SAVED, { ...SAVED, sold: false, maxQuantity: '12' }, { kind: 'option' })).toEqual({ sold: false, maxQuantity: 12 });
});
