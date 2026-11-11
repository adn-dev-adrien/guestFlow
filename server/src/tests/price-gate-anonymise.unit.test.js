// specs/pricing-components.md §3 rule 68 — `scripts/price-gate/anonymise.js` copies by allow-list: only the named tables
// and columns leave the source, free text is replaced, the guest of an intake becomes a placeholder.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  anonymise, ALLOW_LIST, INTAKE_TABLES, PLUGIN_SETTINGS_KEPT, makeLabeler, scrubJson, scrubIntakeParsed,
} = require('../../../scripts/price-gate/anonymise');

test('rule 68: the allow-list names no client, history, e-mail table nor a free-text or secret column', () => {
  for (const table of Object.keys(ALLOW_LIST)) {
    assert.ok(!/^(clients|reservation_history|email_|guest_email_sends|users|sessions)/.test(table), table);
    for (const column of ALLOW_LIST[table]) {
      assert.ok(!/(^|[a-z])(notes?|comment|message|reason|secret|token|password|passwordHash|iban|bic|apiKey|url|email|phone|firstName|lastName)$/i.test(column),
        `${table}.${column} looks like free text, a secret or an identity`);
    }
  }
  assert.deepEqual(INTAKE_TABLES, ['booking_intakes', 'airbnb_intakes', 'gdf_intakes']);
});

test('rule 68: a table or a column that is not on the list is never copied', () => {
  const copied = anonymise({
    clients: [{ id: 1, firstName: 'x', email: 'a@b.c' }],
    reservation_history: [{ id: 1, changes: 'x' }],
    reservations: [{ id: 7, propertyId: 1, clientId: 3, startDate: 'd1', notes: 'free text', breakfastNote: 'free text', publicToken: 'secret', totalPrice: 120.5 }],
  });
  assert.deepEqual(Object.keys(copied), ['reservations']);
  assert.deepEqual(copied.reservations, [{ id: 7, propertyId: 1, clientId: 3, startDate: 'd1', totalPrice: 120.5 }]);
});

test('rule 68: the copy follows the allow-list order and does not touch its input', () => {
  const source = { options: [{ price: 5, id: 2, description: 'text', title: 't' }] };
  const before = JSON.stringify(source);
  const copied = anonymise(source, { allowList: { options: ['id', 'title', 'price'] } });
  assert.deepEqual(Object.keys(copied.options[0]), ['id', 'title', 'price']);
  assert.equal(JSON.stringify(source), before);
});

test('rule 68: a custom line text becomes « Line N », the same everywhere the engine keys it by that text', () => {
  const copied = anonymise({
    reservation_custom_options: [
      { id: 1, reservationId: 9, description: 'Lit  supplémentaire', amount: 25 },
      { id: 2, reservationId: 9, description: 'Autre', amount: 5 },
      { id: 3, reservationId: 10, description: 'lit supplémentaire', amount: 25 },
    ],
    reservations: [{
      id: 9, arrivalExtrasBaseline: JSON.stringify({ 'opt:7': 80, 'custom:lit supplémentaire': 21 }),
      endOfStayComplementDetail: JSON.stringify([{ label: 'Lit supplémentaire', key: 'custom:lit supplémentaire', qty: 1, total: 25 }]),
    }],
  });
  const [first, second, third] = copied.reservation_custom_options.map((r) => r.description);
  assert.equal(first, 'Line 1');
  assert.equal(second, 'Line 2');
  assert.equal(third, 'Line 1', 'same normalised text, same placeholder');
  assert.deepEqual(JSON.parse(copied.reservations[0].arrivalExtrasBaseline), { 'opt:7': 80, 'custom:line 1': 21 });
  assert.deepEqual(JSON.parse(copied.reservations[0].endOfStayComplementDetail), [{ label: 'Line 1', key: 'custom:line 1', qty: 1, total: 25 }]);
});

test('rule 68: a refund line keeps its key as its label, an unparsable JSON column is dropped', () => {
  const copied = anonymise({
    reservation_refund_lines: [{ id: 1, refundId: 1, lineKey: 'accommodation', label: 'Hébergement de Mme X', bucket: 'accommodation', amountTtc: 10 }],
    reservations: [{ id: 1, tariffSnapshot: '{not json' }],
  });
  assert.equal(copied.reservation_refund_lines[0].label, 'accommodation');
  assert.equal(copied.reservations[0].tariffSnapshot, null);
});

test('rule 68: only the non-secret plugin settings are copied', () => {
  const rows = [
    { plugin_id: 'booking-intake', key: 'key', value: 'secret' },
    { plugin_id: 'booking-intake', key: 'hotelIds', value: '{"1":"2"}' },
    { plugin_id: 'google-calendar', key: 'refreshToken', value: 'secret' },
    { plugin_id: 'sas', key: 'extinguisherCheck', value: '1' },
  ];
  const copied = anonymise({ plugin_settings: rows }).plugin_settings;
  assert.deepEqual(copied.map((r) => `${r.plugin_id}.${r.key}`), ['booking-intake.hotelIds', 'sas.extinguisherCheck']);
  assert.ok(copied.every((r) => PLUGIN_SETTINGS_KEPT.includes(`${r.plugin_id}.${r.key}`)));
});

test('rule 68: the guest of a Booking intake becomes a placeholder with no @ and no phone', () => {
  const parsed = JSON.stringify({ booking: {
    resId: '123', guest: { firstName: 'Ada', lastName: 'Lovelace', country: 'fr', email: 'ada@example.org', phone: '+33 6 12 34 56 78' },
    emailLanguage: 'fr', total: 710.02, requests: ['a free request'], guestMessagePending: true,
  }, differences: [{ field: 'email', label: 'E-mail', from: 'old@example.org', to: 'ada@example.org' }, { field: 'adults', label: 'Adultes', from: 2, to: 3 }] });
  const copied = anonymise({ booking_intakes: [{ id: 4, resId: '123', hotelId: '9', reservationId: 1, status: 'applied', error: 'x@y.z', parsed }] });
  const row = copied.booking_intakes[0];
  assert.ok(!('error' in row));
  const out = JSON.parse(row.parsed);
  assert.deepEqual(out.booking.guest, { firstName: 'Guest', lastName: '4', email: 'guest4.invalid' });
  assert.equal(out.booking.emailLanguage, 'fr');
  assert.deepEqual(out.booking.requests, []);
  assert.equal(out.booking.total, 710.02);
  assert.deepEqual(out.differences, [{ field: 'email', label: 'E-mail', from: 'Guest', to: 'Guest' }, { field: 'adults', label: 'Adultes', from: 2, to: 3 }]);
  assert.ok(!row.parsed.includes('@'));
});

test('rule 68: an Airbnb intake loses its names, listing title, message, links and mail id', () => {
  const parsed = JSON.stringify({ code: 'ABC', firstName: 'Ada', lastName: 'Lovelace', listingId: '1', listingTitle: 'A nice flat', reservationUrl: 'https://x', threadUrl: 'https://y', message: 'hello', total: 99 });
  const copied = anonymise({ airbnb_intakes: [{ id: 2, messageId: '<abc@airbnb.com>', receivedAt: 'r', confirmationCode: 'ABC', parsed, status: 'applied', reservationId: 5 }] });
  const row = copied.airbnb_intakes[0];
  assert.equal(row.messageId, 'message-2');
  assert.deepEqual(JSON.parse(row.parsed), { code: 'ABC', firstName: 'Guest', lastName: '2', listingId: '1', listingTitle: 'Listing', reservationUrl: null, threadUrl: null, message: '', total: 99 });
});

test('rule 68: the labeler and the scrubbers are stable and total', () => {
  const labeler = makeLabeler();
  assert.equal(labeler.label('  A  B '), 'Line 1');
  assert.equal(labeler.label('a b'), 'Line 1');
  assert.equal(labeler.label(''), '');
  assert.equal(scrubJson(null, labeler), null);
  assert.equal(scrubJson('', labeler), '');
  assert.equal(scrubIntakeParsed(null, 1), null);
  assert.equal(scrubIntakeParsed('nope', 1), null);
});
