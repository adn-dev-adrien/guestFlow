const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateEmail,
  validateHeaderSafeText,
  validateSiret,
  validateTvaIntracom,
  validateIban,
  validateBic,
  validateQuoteValidityDays,
  validateSmtpPort,
  validatePublicUrl,
  validateLaundryWeekday,
  validateFiscalYearEndMonth,
} = require('../utils/settingsValidation');

// --- email ---
test('validateEmail: empty is valid', () => {
  assert.equal(validateEmail(''), null);
  assert.equal(validateEmail(null), null);
});
test('validateEmail: valid', () => {
  assert.equal(validateEmail('a@b.com'), null);
  assert.equal(validateEmail('robot@projet.iam.gserviceaccount.com'), null);
});
test('validateEmail: invalid', () => {
  assert.match(validateEmail('no-at-sign'), /invalide/);
  assert.match(validateEmail('foo@'), /invalide/);
  assert.match(validateEmail('@bar.com'), /invalide/);
});
test('validateEmail: rejects the control characters an email header cannot carry', () => {
  // A CRLF here would end the `To:`/`From:` line and let the rest be read as a new header.
  assert.match(validateEmail('a@b.com\r\nBcc: pirate@evil.com'), /Caractère interdit/);
  assert.match(validateEmail('a\u0000b@c.com'), /Caractère interdit/);
  assert.match(validateEmail('a\u007Fb@c.com'), /Caractère interdit/);
});

// --- header-safe free text (SMTP display name) ---
test('validateHeaderSafeText: empty is valid', () => {
  assert.equal(validateHeaderSafeText(''), null);
  assert.equal(validateHeaderSafeText(null), null);
});
test('validateHeaderSafeText: ordinary display names pass, accents included', () => {
  assert.equal(validateHeaderSafeText('Domaine Solio'), null);
  assert.equal(validateHeaderSafeText('Gîte Solio — été'), null);
  assert.equal(validateHeaderSafeText('L\'Aventura "Lodge"'), null);
});
test('validateHeaderSafeText: rejects an interior control character', () => {
  assert.match(validateHeaderSafeText('GuestFlow\r\nBcc: pirate@evil.com'), /Caractère interdit/);
  assert.match(validateHeaderSafeText('Guest\nFlow'), /Caractère interdit/);
  assert.match(validateHeaderSafeText('Guest\u0000Flow'), /Caractère interdit/);
  assert.match(validateHeaderSafeText('Guest\u007FFlow'), /Caractère interdit/);
  assert.match(validateHeaderSafeText('Guest\tFlow'), /Caractère interdit/);
});
test('validateHeaderSafeText: tolerates surrounding whitespace — the controller trims it', () => {
  assert.equal(validateHeaderSafeText('Domaine Solio\r\n'), null);
  assert.equal(validateHeaderSafeText('  Domaine Solio  '), null);
});

// --- SIRET ---
test('validateSiret: empty is valid', () => assert.equal(validateSiret(''), null));
test('validateSiret: 14 digits passes', () => assert.equal(validateSiret('12345678901234'), null));
test('validateSiret: tolerant of spaces', () => assert.equal(validateSiret('123 456 789 00012'), null));
test('validateSiret: rejects wrong length', () => {
  assert.match(validateSiret('123'), /14 chiffres/);
  assert.match(validateSiret('123456789012345'), /14 chiffres/);
});
test('validateSiret: rejects non-digits', () => {
  assert.match(validateSiret('1234567890123A'), /14 chiffres/);
});

// --- TVA ---
test('validateTvaIntracom: empty is valid', () => assert.equal(validateTvaIntracom(''), null));
test('validateTvaIntracom: FR + 11 digits passes', () => {
  assert.equal(validateTvaIntracom('FR12345678901'), null);
});
test('validateTvaIntracom: rejects no country prefix', () => {
  assert.match(validateTvaIntracom('12345678901'), /TVA/);
});

// --- IBAN ---
test('validateIban: empty is valid', () => assert.equal(validateIban(''), null));
test('validateIban: valid FR IBAN passes mod-97', () => {
  // Known-good IBAN: GB82 WEST 1234 5698 7654 32 (canonical IBAN example).
  assert.equal(validateIban('GB82WEST12345698765432'), null);
});
test('validateIban: tolerant of spaces', () => {
  assert.equal(validateIban('GB82 WEST 1234 5698 7654 32'), null);
});
test('validateIban: rejects bad checksum', () => {
  assert.match(validateIban('GB00WEST12345698765432'), /IBAN/);
});
test('validateIban: rejects too short', () => {
  assert.match(validateIban('FR12'), /IBAN/);
});

// --- BIC ---
test('validateBic: empty is valid', () => assert.equal(validateBic(''), null));
test('validateBic: 8-char passes', () => assert.equal(validateBic('BNPAFRPP'), null));
test('validateBic: 11-char passes', () => assert.equal(validateBic('BNPAFRPPXXX'), null));
test('validateBic: rejects 7-char', () => assert.match(validateBic('BNPAFRP'), /BIC/));
test('validateBic: rejects 9-char', () => assert.match(validateBic('BNPAFRPPX'), /BIC/));

// (validatePrivateKey / validateCalendarId removed with the Google OAuth rework —
// specs/google-calendar-oauth-rework.md: no more manual service-account fields.)

// --- quote validity ---
test('validateQuoteValidityDays: empty / null is valid (controller defaults)', () => {
  assert.equal(validateQuoteValidityDays(''), null);
  assert.equal(validateQuoteValidityDays(null), null);
});
test('validateQuoteValidityDays: 1 and 365 pass', () => {
  assert.equal(validateQuoteValidityDays(1), null);
  assert.equal(validateQuoteValidityDays(365), null);
  assert.equal(validateQuoteValidityDays('30'), null);
});
test('validateQuoteValidityDays: 0, 366, non-int rejected', () => {
  assert.match(validateQuoteValidityDays(0), /entre 1 et 365/);
  assert.match(validateQuoteValidityDays(366), /entre 1 et 365/);
  assert.match(validateQuoteValidityDays(15.5), /entre 1 et 365/);
});

// SMTP-block validators (specs/admin-account-management.md M3).

test('validateSmtpPort: 1..65535 ints accepted, empty/null pass through', () => {
  assert.equal(validateSmtpPort(''), null);
  assert.equal(validateSmtpPort(null), null);
  assert.equal(validateSmtpPort(587), null);
  assert.equal(validateSmtpPort(465), null);
  assert.equal(validateSmtpPort(1), null);
  assert.equal(validateSmtpPort(65535), null);
});

test('validateSmtpPort: 0, 65536, non-integers rejected', () => {
  assert.match(validateSmtpPort(0), /entre 1 et 65535/);
  assert.match(validateSmtpPort(65536), /entre 1 et 65535/);
  assert.match(validateSmtpPort(587.5), /entre 1 et 65535/);
  assert.match(validateSmtpPort('not-a-number'), /entre 1 et 65535/);
});

test('validatePublicUrl: empty/null pass; http(s) URLs pass; bad scheme + invalid → error', () => {
  assert.equal(validatePublicUrl(''), null);
  assert.equal(validatePublicUrl(null), null);
  assert.equal(validatePublicUrl('https://guestflow.example.com'), null);
  assert.equal(validatePublicUrl('http://localhost:3000'), null);
  assert.match(validatePublicUrl('ftp://example.com'), /http/);
  assert.match(validatePublicUrl('not a url'), /URL invalide/);
});

// Weekly bed-linen tracking — laundry weekday validator (specs/weekly-bed-linen-tracking.md §4.3).
test('validateLaundryWeekday accepts 0..6 and null/empty as no-op', () => {
  for (let i = 0; i <= 6; i++) {
    assert.equal(validateLaundryWeekday(i), null, `weekday ${i} should be valid`);
  }
  assert.equal(validateLaundryWeekday(null), null);
  assert.equal(validateLaundryWeekday(''), null);
});

test('validateLaundryWeekday rejects out-of-range and non-integer values', () => {
  assert.match(validateLaundryWeekday(-1), /entre 0/);
  assert.match(validateLaundryWeekday(7), /entre 0/);
  assert.match(validateLaundryWeekday(2.5), /entre 0/);
  assert.match(validateLaundryWeekday('mardi'), /entre 0/);
});

// Accounting closing month (specs/fiscal-year-and-nights-sold.md §3.1).
test('validateFiscalYearEndMonth accepts 1..12; empty/null are a no-op (preserve semantics)', () => {
  for (let m = 1; m <= 12; m++) {
    assert.equal(validateFiscalYearEndMonth(m), null, `month ${m} should be valid`);
  }
  // The form sends the Select value, which may arrive as a string.
  assert.equal(validateFiscalYearEndMonth('9'), null);
  assert.equal(validateFiscalYearEndMonth(null), null);
  assert.equal(validateFiscalYearEndMonth(''), null);
  assert.equal(validateFiscalYearEndMonth(undefined), null);
});

test('validateFiscalYearEndMonth rejects out-of-range and non-integer months', () => {
  assert.match(validateFiscalYearEndMonth(0), /entre 1/);
  assert.match(validateFiscalYearEndMonth(13), /entre 1/);
  assert.match(validateFiscalYearEndMonth(-3), /entre 1/);
  assert.match(validateFiscalYearEndMonth(9.5), /entre 1/);
  assert.match(validateFiscalYearEndMonth('septembre'), /entre 1/);
});
