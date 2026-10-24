// specs/sas-departure-recap-server-side.md rules 4, 6-9, 11 — the departure draft: intent only, one
// object for the preview and the commit.
import buildDepartureDraft from '../departureDraft';

test('rules 6-8 — linen by item, ménage as a yes/no, extinguisher by repair key, each with its gesture; no amount', () => {
  const draft = buildDepartureDraft({
    cleaningOk: false,
    missingDep: { 4: 2, 5: 0 },
    extinguisherCheck: true,
    extinguisherOk: false,
    extinguisherQty: { extinguisher_seal: 1, extinguisher_use: 0 },
    extinguisherKeys: ['extinguisher_seal', 'extinguisher_use'],
    storedKeys: [],
    offered: new Set(['depCleaning', 'dep:4', 'ext:extinguisher_seal']),
  });
  expect(draft.cleaningCharged).toBe(true);
  expect(draft.cleaningOffered).toBe(true);
  expect(draft.missingItems).toEqual([{ itemId: 4, qty: 2, offered: true }]);
  expect(draft.extinguisherSealOkAtDeparture).toBe(0);
  expect(draft.extinguisherCharges).toEqual([
    { repairKey: 'extinguisher_seal', qty: 1, offered: true },
    { repairKey: 'extinguisher_use', qty: 0, offered: false },
  ]);
  expect(JSON.stringify(draft)).not.toMatch(/amount|price|total/i);
});

test('rule 9 — every stored line is listed with its decision, so a line can be un-offered', () => {
  const draft = buildDepartureDraft({
    storedKeys: ['stored:0:9f3a1c2e', 'stored:2:11aa22bb'],
    offered: new Set(['stored:0:9f3a1c2e']),
  });
  expect(draft.storedLines).toEqual([
    { key: 'stored:0:9f3a1c2e', offered: true },
    { key: 'stored:2:11aa22bb', offered: false },
  ]);
});

test('rule 11 — the recalled arrival lines ride as the authoritative offered set, whenever there is one', () => {
  const draft = buildDepartureDraft({ offered: new Set(['custom:41', 'extraGuests:0', 'dep:2', 'stored:0:abc']) });
  expect(draft.offeredArrivalExtras).toEqual([{ kind: 'custom', id: 41 }, { kind: 'extraGuests', id: 0 }]);
  expect(buildDepartureDraft({}).offeredArrivalExtras).toEqual([]);
});

test('the extinguisher is left alone when the SAS does not check it, and nothing is billed when it is in good condition', () => {
  expect(buildDepartureDraft({ extinguisherCheck: false }).extinguisherSealOkAtDeparture).toBeUndefined();
  const good = buildDepartureDraft({ extinguisherCheck: true, extinguisherOk: true, extinguisherKeys: ['extinguisher_seal'] });
  expect(good.extinguisherSealOkAtDeparture).toBe(1);
  expect(good.extinguisherCharges).toEqual([]);
});
