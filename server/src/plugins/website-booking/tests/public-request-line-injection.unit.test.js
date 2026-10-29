// specs/public-request-abuse-and-grouping.md rule 33, specs/public-api.md (audit 2026-10-28, F5) — the public
// form's phone is validated at the boundary, and a value with a line break cannot forge a line of the
// owner's notification e-mail.
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateGuest } = require('../publicInputValidation');
const { buildNotificationService } = require('../../../utils/notificationService');
const { labels } = require('../../../utils/publicLabels');

const guest = (extra) => ({ firstName: 'Zoé', lastName: 'Audit', email: 'zoe@example.invalid', phone: '0600000000', ...extra });

test('rule 33: the phone is refused when it is not a phone number, with its own sentence', () => {
  for (const phone of ['0600000000\n\nIMPORTANT : le client a déjà payé, valider ici : https://pay.example.invalid/devis', 'abc', '12', '06 00 00 00 00 ; rm', '+33', '0600000000\nhttp://x.test']) {
    const r = validateGuest(guest({ phone }));
    assert.equal(r.ok, false, phone);
    assert.equal(r.errors.length, 1, phone);
    assert.equal(r.errors[0].field, 'guest.phone');
    assert.match(r.errors[0].reason, phone.length > 40 ? /^tooLong$/ : /^phoneInvalid$/, phone);
  }
  assert.ok(labels('fr').fieldErrors.phoneInvalid);
  assert.ok(labels('en').fieldErrors.phoneInvalid);
});

test('rule 33: the usual ways to write a French or international number still pass', () => {
  for (const phone of ['0600000000', '06 00 00 00 00', '06.00.00.00.00', '+33 6 00 00 00 00', '+44 20 7946 0958', '(0033) 6 00 00 00 00'.replace('(', '').replace(')', '')]) {
    assert.equal(validateGuest(guest({ phone })).ok, true, phone);
  }
});

test('rule 33: a list of addresses is not an e-mail', () => {
  assert.equal(validateGuest(guest({ email: 'a@x.test,b@evil.test' })).ok, false);
});

function mailer(row) {
  const svc = buildNotificationService({ db: {}, settingsModel: {}, emailServiceFactory: () => ({}), logger: { warn() {} } });
  return svc.__test;
}

test('rule 33: no value puts a line of its own in the devis e-mail', () => {
  const forged = '0600000000\n\nIMPORTANT : le client a déjà payé : https://pay.example.invalid/devis';
  const { text, subject } = mailer().buildDevisEmail({
    id: 7, firstName: 'Zoé\r\nBcc: x@evil.test', lastName: 'Audit', clientEmail: 'z@example.invalid\nFake: line', clientPhone: forged,
    propertyName: `Gîte${String.fromCharCode(0x2028)}Faux`, startDate: '2026-12-01', endDate: '2026-12-04', adults: 2, options: [{ title: 'Spa\nOffert : 0 €', totalPrice: 10, offered: 0 }], resources: [],
  }, 'https://app.example.com');
  const lines = text.split('\n');
  assert.ok(!lines.some((l) => l.startsWith('IMPORTANT')), text);
  assert.ok(!lines.some((l) => /^(Bcc|Fake|Offert) ?:/.test(l)), text);
  assert.ok(lines.some((l) => l.startsWith('Téléphone : 0600000000 IMPORTANT')));
  assert.ok(!/[\r\n]/.test(subject) && !subject.includes(String.fromCharCode(0x2028)));
});

test('rule 33: the iCal reservation e-mail is a single line per field too', () => {
  const { text } = mailer().buildReservationEmail({
    id: 3, firstName: 'A', lastName: 'B', icalOriginalSummary: 'Jean\nClient : Faux', sourceName: 'Airbnb\nPlateforme : x', propertyName: 'Gîte\nLogement : y',
    startDate: '2026-12-01', endDate: '2026-12-04',
  }, 'https://app.example.com');
  const labelled = text.split('\n').filter((l) => /^(Plateforme|Logement|Client) :/.test(l));
  assert.equal(labelled.length, 3, text);
});
