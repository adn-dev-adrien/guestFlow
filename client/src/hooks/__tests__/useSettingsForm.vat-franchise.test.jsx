// specs/vat-optional-mode.md rule 36 — the settings draft edits the threshold as a field of its own and
// sends it only when it changed; the server's `franchise` block is never sent back.
import { __test } from '../useSettingsForm';

const { pickGroups, buildPayload } = __test;
const settings = (franchise) => ({ vat: { regime: 'not_subject', rate: 0, legalMention: 'art_293_b', franchise } });

test('the draft starts from the stored amount, or empty', () => {
  expect(pickGroups(settings({ applies: true, threshold: 30000, setAt: '2026-03-12' }), ['vat']).vat.franchiseThreshold).toBe(30000);
  expect(pickGroups(settings({ applies: true, threshold: null, setAt: null }), ['vat']).vat.franchiseThreshold).toBe('');
});

test('an unchanged page sends nothing; a typed amount is sent alone, the server block never', () => {
  const saved = pickGroups(settings({ applies: true, threshold: null, setAt: null }), ['vat']);
  expect(buildPayload(saved, saved, ['vat'])).toEqual({});
  const draft = { vat: { ...saved.vat, franchiseThreshold: '30 000' } };
  expect(buildPayload(draft, saved, ['vat'])).toEqual({ vat: { franchiseThreshold: '30 000' } });
});

test('emptying a stored amount is sent as an empty value', () => {
  const saved = pickGroups(settings({ applies: true, threshold: 30000, setAt: '2026-03-12' }), ['vat']);
  expect(buildPayload({ vat: { ...saved.vat, franchiseThreshold: '' } }, saved, ['vat'])).toEqual({ vat: { franchiseThreshold: '' } });
});
