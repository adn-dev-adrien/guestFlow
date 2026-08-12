const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAddressBlock, extractEmail, extractPhone } = require('../utils/contactParsing');
const clientsController = require('../controllers/clientsController');

// ---------------------------------------------------------------------------------------------
// parseAddressBlock — positional split: <numéro> <rue> <code postal> <ville>
// ---------------------------------------------------------------------------------------------

test('address: full line splits into the four fields', () => {
  assert.deepEqual(parseAddressBlock('12 rue des Lilas 07000 Privas'), {
    streetNumber: '12',
    street: 'Rue des lilas',
    postalCode: '07000',
    city: 'Privas',
  });
});

test('address: commas are separators, a trailing country is dropped', () => {
  assert.deepEqual(parseAddressBlock('12, rue des Lilas, 07000 Privas, France'), {
    streetNumber: '12',
    street: 'Rue des lilas',
    postalCode: '07000',
    city: 'Privas',
  });
});

test('address: "bis" is absorbed into the street number', () => {
  const parsed = parseAddressBlock('12 bis avenue de la Gare 07200 Aubenas');
  assert.equal(parsed.streetNumber, '12 bis');
  assert.equal(parsed.street, 'Avenue de la gare');
  assert.equal(parsed.city, 'Aubenas');
});

test('address: a letter suffix on the number is kept', () => {
  assert.equal(parseAddressBlock('4A rue Neuve 07000 Privas').streetNumber, '4A');
});

test('address: postal code + city only', () => {
  assert.deepEqual(parseAddressBlock('07000 Privas'), {
    streetNumber: '',
    street: '',
    postalCode: '07000',
    city: 'Privas',
  });
});

test('address: a five-digit first token is a postal code, never a street number', () => {
  assert.equal(parseAddressBlock('07000 Privas').streetNumber, '');
});

test('address: city alone', () => {
  assert.deepEqual(parseAddressBlock('Privas'), {
    streetNumber: '',
    street: '',
    postalCode: '',
    city: 'Privas',
  });
});

test('address: without a postal code the last token is the city', () => {
  assert.deepEqual(parseAddressBlock('12 rue des Lilas Privas'), {
    streetNumber: '12',
    street: 'Rue des lilas',
    postalCode: '',
    city: 'Privas',
  });
});

test('address: multi-word city after a postal code stays whole', () => {
  assert.equal(parseAddressBlock('07510 Sainte Eulalie du Lac').city, 'Sainte eulalie du lac');
});

test('address: empty or whitespace-only input clears everything', () => {
  const empty = { streetNumber: '', street: '', postalCode: '', city: '' };
  assert.deepEqual(parseAddressBlock(''), empty);
  assert.deepEqual(parseAddressBlock('   \n  '), empty);
  assert.deepEqual(parseAddressBlock(null), empty);
});

test('address: street and city are sentence-cased like a manual entry', () => {
  const parsed = parseAddressBlock('12 RUE DES LILAS 07000 PRIVAS');
  assert.equal(parsed.street, 'Rue des lilas');
  assert.equal(parsed.city, 'Privas');
});

// ---------------------------------------------------------------------------------------------
// extractEmail
// ---------------------------------------------------------------------------------------------

test('email: mailto link with a query string', () => {
  assert.equal(
    extractEmail('mailto:Jean.Dupont@Example.com?subject=Contact%20site'),
    'jean.dupont@example.com',
  );
});

test('email: percent-encoded mailto', () => {
  assert.equal(extractEmail('mailto:jean.dupont%40example.com'), 'jean.dupont@example.com');
});

test('email: "Nom <adresse>" pair', () => {
  assert.equal(extractEmail('Jean Dupont <jean.dupont@example.com>'), 'jean.dupont@example.com');
});

test('email: first address found in free text, trailing punctuation excluded', () => {
  assert.equal(
    extractEmail('Contactez-nous : jean.dupont@example.com. Merci !'),
    'jean.dupont@example.com',
  );
});

test('email: subdomains and plus-addressing survive', () => {
  assert.equal(extractEmail('resa+web@mail.domainesolio.fr'), 'resa+web@mail.domainesolio.fr');
});

test('email: nothing email-shaped → empty string', () => {
  assert.equal(extractEmail('Jean Dupont'), '');
  assert.equal(extractEmail(''), '');
});

// ---------------------------------------------------------------------------------------------
// extractPhone — only +33 collapses to 0
// ---------------------------------------------------------------------------------------------

test('phone: tel: link with the French prefix becomes a national number', () => {
  assert.equal(extractPhone('tel:+33627753922'), '0627753922');
});

test('phone: spaced French international form', () => {
  assert.equal(extractPhone('+33 6 27 75 39 22'), '0627753922');
});

test('phone: 0033 is the same as +33', () => {
  assert.equal(extractPhone('0033627753922'), '0627753922');
});

test('phone: "+33 (0)6 …" does not produce a doubled trunk zero', () => {
  assert.equal(extractPhone('+33 (0)6 27 75 39 22'), '0627753922');
});

test('phone: a French number with dots is compacted', () => {
  assert.equal(extractPhone('04.75.64.12.34'), '0475641234');
});

test('phone: number picked out of free text', () => {
  assert.equal(extractPhone('Tél. : 04 75 64 12 34 (accueil)'), '0475641234');
});

test('phone: foreign numbers keep their country code', () => {
  assert.equal(extractPhone('+32 475 12 34 56'), '+32475123456');
  assert.equal(extractPhone('tel:+41791234567'), '+41791234567');
  assert.equal(extractPhone('+44 7911 123456'), '+447911123456');
  assert.equal(extractPhone('+49 151 12345678'), '+4915112345678');
  assert.equal(extractPhone('+1 (415) 555-0132'), '+14155550132');
});

test('phone: 0032 becomes +32, not 0', () => {
  assert.equal(extractPhone('0032475123456'), '+32475123456');
});

test('phone: a prefix-less foreign number is left alone — no country code is invented', () => {
  assert.equal(extractPhone('0475 12 34 56'), '0475123456');
});

// Regression guard for the whole point of rule 10: only France loses its prefix.
test('phone: no international number other than +33 ever comes back starting with 0', () => {
  const foreign = ['+32475123456', '+41791234567', '+447911123456', '+4915112345678', '+14155550132', '+352621123456'];
  for (const input of foreign) {
    const out = extractPhone(input);
    assert.equal(out.startsWith('+'), true, `${input} lost its prefix → ${out}`);
    assert.equal(out, input.replace(/[^\d+]/g, ''));
  }
});

test('phone: nothing phone-shaped → empty string', () => {
  assert.equal(extractPhone('+33'), '');
  assert.equal(extractPhone('12'), '');
  assert.equal(extractPhone('appelez-nous'), '');
  assert.equal(extractPhone(''), '');
});

// ---------------------------------------------------------------------------------------------
// Controller — POST /clients/parse-contact
// ---------------------------------------------------------------------------------------------

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

test('parse-contact: returns only the requested keys', () => {
  const c = clientsController.buildController({});
  const res = fakeRes();
  c.parseContact({ body: { email: 'mailto:a.b@example.com' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { email: 'a.b@example.com' });
});

test('parse-contact: handles the three keys at once', () => {
  const c = clientsController.buildController({});
  const res = fakeRes();
  c.parseContact({
    body: { address: '12 rue des Lilas 07000 Privas', email: 'A@B.FR', phone: 'tel:+33627753922' },
  }, res);
  assert.deepEqual(res.body, {
    address: { streetNumber: '12', street: 'Rue des lilas', postalCode: '07000', city: 'Privas' },
    email: 'a@b.fr',
    phone: '0627753922',
  });
});

test('parse-contact: empty string is a legitimate request (clears the fields)', () => {
  const c = clientsController.buildController({});
  const res = fakeRes();
  c.parseContact({ body: { address: '' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.address, { streetNumber: '', street: '', postalCode: '', city: '' });
});

test('parse-contact: unparseable email/phone is echoed back, never swallowed', () => {
  const c = clientsController.buildController({});
  const res = fakeRes();
  c.parseContact({ body: { email: '  Jean Dupont  ', phone: 'appelez-nous' } }, res);
  assert.deepEqual(res.body, { email: 'Jean Dupont', phone: 'appelez-nous' });
});

test('parse-contact: no usable key → 400 INVALID_PAYLOAD', () => {
  const c = clientsController.buildController({});
  for (const body of [{}, { notes: 'x' }, { email: 42 }, undefined]) {
    const res = fakeRes();
    c.parseContact({ body }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'INVALID_PAYLOAD');
  }
});
