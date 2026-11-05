require('./isolatedDb');
// specs/public-api.md rule 23 and specs/wordpress-plugin.md rule 35 (Adrien's decision D13, 2026-11-05) — what the
// public form accepts in a name: letters of any script with their marks, space, hyphen, apostrophes and dot. The form
// sends no city and no address, so nothing judges them; an intake, the back office and a stored name are never judged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateGuest, withFieldMessages } = require('../publicInputValidation');
const { labels } = require('../../../utils/publicLabels');
const db = require('../../../database');
const settings = require('../settings');

settings.termsSettings = () => ({ requireTermsAcceptance: false });
const bookingCtl = require('../controllers/publicBookingRequestController');
const coreServices = require('../../sdk/coreServices');
const clientsController = require('../../../controllers/clientsController');

const pad = (n) => String(n).padStart(2, '0');
const localDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const guest = { firstName: 'Zoé', lastName: 'Martin', email: 'zoe@example.test', phone: '0612345678' };

const propertyId = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'An', 100, ?, 1)")
  .run(propertyId, JSON.stringify([{ startDate: localDay(0), endDate: localDay(400) }]));

let sent = 0;
function send(guestFields, query = {}) {
  sent += 1;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  bookingCtl.create({
    body: {
      propertyId,
      startDate: localDay(30),
      endDate: localDay(33),
      adults: 2,
      guest: { ...guest, email: `visitor${sent}@example.test`, ...guestFields },
    },
    headers: {},
    query,
  }, res);
  return res;
}
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

const ACCEPTED = [
  "O'Brien", 'N’Diaye', 'de la Fontaine', 'Jean-Pierre', 'St. Tropez', 'Zoé', 'Müller', 'Łukasz', 'Nguyễn',
  'Иван', 'Μαρία', 'محمد', 'سارا‌ی', '李小龙', 'さくら', '김민수', 'देवनागरी', 'कृष्ण‍', 'שרה', 'élodie',
];
const REFUSED = [
  'Jean123', '3', '٣ Ali', '<script>', '<script>alert(1)</script>', 'Jean@Dupont', 'jean@example.test', 'Jean_Pierre',
  '12 bis, rue de l\'Église', '3/5 avenue', 'Jean, Paul', 'Jean/Paul', 'Jean#', 'A+B', 'Zoé 😀', '[31mZoé',
  'ジョン・スミス', 'ד׳', 'Gal·la',
];

test('rule 23 — letters of any script, their marks, space, hyphen, both apostrophes and dot pass, unchanged', () => {
  for (const name of ACCEPTED) {
    for (const field of ['firstName', 'lastName']) {
      const out = validateGuest({ ...guest, [field]: name });
      assert.equal(out.ok, true, `${name}: ${JSON.stringify(out.errors)}`);
      assert.equal(out.value[field], name);
    }
  }
});

test('rule 23 — anything else is refused on that field, with reason nameInvalid', () => {
  for (const name of REFUSED) {
    for (const field of ['firstName', 'lastName']) {
      const out = validateGuest({ ...guest, [field]: name });
      assert.equal(out.ok, false, name);
      assert.deepEqual(out.errors.map((e) => [e.field, e.reason]), [[`guest.${field}`, 'nameInvalid']], name);
    }
  }
});

test('rule 23 — both names are judged, each on its own field; a long name still reads tooLong when its text is clean', () => {
  const both = validateGuest({ ...guest, firstName: 'Jean1', lastName: 'Du_pont' });
  assert.deepEqual(both.errors.map((e) => [e.field, e.reason]), [['guest.firstName', 'nameInvalid'], ['guest.lastName', 'nameInvalid']]);
  assert.equal(validateGuest({ ...guest, firstName: 'a'.repeat(101) }).errors[0].reason, 'tooLong');
  assert.equal(validateGuest({ ...guest, firstName: `${'a'.repeat(101)}1` }).errors[0].reason, 'nameInvalid');
});

test('rule 23 does not undo rule 20: no letter nor digit is still « required », control and format characters still go first', () => {
  for (const name of ['---', '...', "'", '_', '@', '<>', '\u0000', '⠀', '‍', '́', '  ']) {
    assert.equal(validateGuest({ ...guest, firstName: name }).errors[0].reason, 'required', JSON.stringify(name));
  }
  assert.equal(validateGuest({ ...guest, firstName: 'A\nB' }).value.firstName, 'A B');
  assert.equal(validateGuest({ ...guest, firstName: '\u0007Zoé' }).value.firstName, 'Zoé');
  assert.equal(validateGuest({ ...guest, firstName: 'Cl​aire' }).value.firstName, 'Claire');
});

test('rule 23 — email and phone keep their own rules', () => {
  const out = validateGuest({ ...guest, email: 'jean_123@example.test', phone: '+33 6 12 34 56 78' });
  assert.equal(out.ok, true);
});

test('rule 23 — the refusal carries its sentence in the page language and writes nothing', () => {
  const clients = count('clients');
  const stays = count('reservations');
  const details = (query) => send({ lastName: 'Jean123' }, query).body.error.details;
  assert.deepEqual(details({}), [{
    field: 'guest.lastName',
    issue: 'must hold only letters, marks, spaces, hyphens, apostrophes and dots',
    reason: 'nameInvalid',
    message: 'Caractères non acceptés.',
  }]);
  assert.equal(details({ lang: 'en' })[0].message, 'Characters not accepted.');
  const refused = send({ firstName: '<script>' });
  assert.equal(refused.statusCode, 422);
  assert.equal(refused.body.error.code, 'VALIDATION_FAILED');
  assert.equal(count('clients'), clients);
  assert.equal(count('reservations'), stays);
  assert.deepEqual(withFieldMessages([{ field: 'guest.firstName', reason: 'nameInvalid' }], labels('fr').fieldErrors)[0].message, 'Caractères non acceptés.');
});

test('rule 23 — the names pass the whole request, and reach the client as typed', () => {
  for (const firstName of ['N’Diaye', 'محمد', '李小龙']) {
    const res = send({ firstName, lastName: 'de la Fontaine' });
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const stored = db.prepare('SELECT c.firstName, c.lastName FROM reservations r JOIN clients c ON c.id = r.clientId WHERE r.id = ?').get(res.body.data.requestId);
    assert.equal(stored.firstName, firstName);
    assert.equal(stored.lastName, 'de la Fontaine');
  }
});

test('rule 23 — the form sends no city and no address: they are read by nobody, whatever they hold', () => {
  const res = send({ city: '<script>St. Tropez_1', address: '12 bis, rue de l\'Église @ 3/5 avenue', street: '<b>', postalCode: '<i>' });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(validateGuest({ ...guest, city: 'x', address: 'y' }).value), ['firstName', 'lastName', 'email', 'phone']);
  const row = db.prepare('SELECT c.city, c.address, c.street, c.postalCode, r.notes FROM reservations r JOIN clients c ON c.id = r.clientId WHERE r.id = ?')
    .get(res.body.data.requestId);
  assert.ok(!row.city && !row.address && !row.street && !row.postalCode, JSON.stringify(row));
  assert.doesNotMatch(row.notes || '', /script|avenue/);
  const form = fs.readFileSync(path.join(__dirname, '../../../../../integrations/wordpress/guestflow-booking/blocks/booking/view.js'), 'utf8');
  assert.match(form, /guest: \{ firstName: first, lastName: last, email: email, phone: phone \}/);
});

test('rule 23 — a stored client is never judged: a request by its e-mail neither refuses nor rewrites it', () => {
  const id = db.prepare("INSERT INTO clients (firstName, lastName, email, phone) VALUES ('Jean_2', 'SCI 1789', 'stored@example.test', '0612345678')").run().lastInsertRowid;
  const res = send({ firstName: 'Jean', lastName: 'Dupont', email: 'stored@example.test' });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(db.prepare('SELECT clientId FROM reservations WHERE id = ?').get(res.body.data.requestId).clientId, id);
  assert.deepEqual({ ...db.prepare('SELECT firstName, lastName FROM clients WHERE id = ?').get(id) }, { firstName: 'Jean_2', lastName: 'SCI 1789' });
});

test('specs/wordpress-plugin.md rule 35 — the site prints the server\'s sentence under the field: nothing to change in the WordPress form', () => {
  const form = fs.readFileSync(path.join(__dirname, '../../../../../integrations/wordpress/guestflow-booking/blocks/booking/view.js'), 'utf8');
  assert.match(form, /'guest\.firstName': 'firstName', 'guest\.lastName': 'lastName'/);
  assert.match(form, /showFieldError\(key, d\.message \|\| fallback\);/);
});

test('rule 23 — an intake writes its client through the core, unjudged', () => {
  const own = coreServices.clients.findOrCreate({ firstName: 'Jean123', lastName: 'Du_pont', email: 'intake@example.test' });
  const row = db.prepare('SELECT firstName, lastName FROM clients WHERE id = ?').get(own.id);
  assert.match(row.firstName, /123/);
  assert.match(row.lastName, /_/);
});

test('rule 23 — the back office creates a client, and saves a stored name sent back, unjudged', () => {
  const answer = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const created = answer();
  clientsController.create({ body: { firstName: 'Jean123', lastName: 'SCI <1789>', city: 'Paris 12', address: '3/5 avenue #2' } }, created);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const updated = answer();
  clientsController.update({ params: { id: created.body.id }, body: { ...created.body, notes: 'vu' } }, updated);
  assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  assert.match(updated.body.firstName, /123/);
  assert.match(updated.body.lastName, /<1789>/);
});

test('rule 23 — only the public booking request calls the validator', () => {
  const root = path.join(__dirname, '../../..');
  const callers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'tests') walk(full);
      } else if (/\.js$/.test(entry.name) && /\bvalidateGuest\(/.test(fs.readFileSync(full, 'utf8'))) {
        callers.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  assert.deepEqual(callers.sort(), [
    'plugins/website-booking/controllers/publicBookingRequestController.js',
    'plugins/website-booking/publicInputValidation.js',
  ]);
});

test('a space or a hyphen is read by its class, whatever the keyboard typed', () => {
  for (const name of ['Jean\u00A0Paul', '\u5C71\u7530\u3000\u592A\u90CE', 'Jean\u2003Paul', 'Anne\u2013Marie', 'Anne\u2011Marie', '\u05DB\u05D4\u05DF\u05BE\u05DC\u05D5\u05D9']) {
    const out = validateGuest({ firstName: name, lastName: 'Martin', email: 'a@example.invalid', phone: '0612345678' });
    assert.equal(out.ok, true, JSON.stringify(name));
  }
});
