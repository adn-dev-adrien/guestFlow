const test = require('node:test');
const assert = require('node:assert/strict');

const settingsResponse = require('../utils/settingsResponse');
const { shapeResponse, PRIVATE_KEY_MASK, STATUS_LABELS } = settingsResponse;
const {
  maskEmail,
  fingerprintPrivateKey,
  computeConfigured,
  computeStatusLabel,
  formatUpdatedAtLabel,
} = settingsResponse.__test;

const SAMPLE_PEM = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';

// --- maskEmail ---
test('maskEmail: empty → empty', () => assert.equal(maskEmail(''), ''));
test('maskEmail: short email not masked', () => assert.equal(maskEmail('a@b.co'), 'a@b.co'));
test('maskEmail: long email truncates middle', () => {
  const out = maskEmail('robot@projet.iam.gserviceaccount.com');
  assert.match(out, /^robot@/);
  assert.match(out, /…/);
  assert.match(out, /\.com$/);
});

// --- fingerprintPrivateKey ---
test('fingerprintPrivateKey: empty → null', () => assert.equal(fingerprintPrivateKey(''), null));
test('fingerprintPrivateKey: stable 6 hex chars', () => {
  const fp = fingerprintPrivateKey(SAMPLE_PEM);
  assert.match(fp, /^[0-9a-f]{6}$/);
  assert.equal(fp, fingerprintPrivateKey(SAMPLE_PEM));
});

// --- computeConfigured + computeStatusLabel ---
test('computeConfigured: all 3 present → true', () => {
  assert.equal(computeConfigured({
    googleCalendarId: 'a',
    googleServiceAccountEmail: 'b@c.fr',
    googleServiceAccountPrivateKey: SAMPLE_PEM,
  }), true);
});
test('computeConfigured: partial → false', () => {
  assert.equal(computeConfigured({
    googleCalendarId: 'a',
    googleServiceAccountEmail: '',
    googleServiceAccountPrivateKey: SAMPLE_PEM,
  }), false);
});
test('computeStatusLabel: 3 states', () => {
  assert.equal(computeStatusLabel({
    googleCalendarId: 'a', googleServiceAccountEmail: 'b@c.fr', googleServiceAccountPrivateKey: 'k',
  }), STATUS_LABELS.ACTIVE);
  assert.equal(computeStatusLabel({
    googleCalendarId: 'a', googleServiceAccountEmail: '', googleServiceAccountPrivateKey: '',
  }), STATUS_LABELS.IN_PROGRESS);
  assert.equal(computeStatusLabel({
    googleCalendarId: '', googleServiceAccountEmail: '', googleServiceAccountPrivateKey: '',
  }), STATUS_LABELS.MISSING);
});

// --- formatUpdatedAtLabel ---
test('formatUpdatedAtLabel: null / empty / invalid → null', () => {
  assert.equal(formatUpdatedAtLabel(null), null);
  assert.equal(formatUpdatedAtLabel(''), null);
  assert.equal(formatUpdatedAtLabel('not-a-date'), null);
});
test('formatUpdatedAtLabel: returns FR "DD/MM/YYYY à HH:MM"', () => {
  const label = formatUpdatedAtLabel('2026-05-24 12:32:00');
  assert.match(label, /^\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/);
});

// --- shapeResponse ---
test('shapeResponse: wraps under company / quote / googleCalendar', () => {
  const row = {
    googleCalendarId: 'cal',
    googleServiceAccountEmail: 'r@x.com',
    googleServiceAccountPrivateKey: SAMPLE_PEM,
    companyName: 'Acme',
    companyAddress: '1 rue',
    companyEmail: 'a@b.com',
    companyPhone: '0102030405',
    companySiret: '12345678901234',
    companyTva: 'FR12345678901',
    companyIban: 'FR7630006000011234567890189',
    companyBic: 'BNPAFRPP',
    companyBankName: 'BNP',
    quoteFooterText: 'Merci',
    quoteValidityDays: 45,
    companyLogoPath: '/uploads/x.png',
    updatedAt: '2026-05-24 12:32:00',
  };
  const out = shapeResponse(row);
  assert.equal(out.company.name, 'Acme');
  assert.equal(out.company.siret, '12345678901234');
  assert.equal(out.company.logoPath, '/uploads/x.png');
  assert.equal(out.quote.footerText, 'Merci');
  assert.equal(out.quote.validityDays, 45);
  assert.equal(out.googleCalendar.calendarId, 'cal');
  assert.equal(out.googleCalendar.serviceAccountEmail, 'r@x.com');
  assert.equal(out.googleCalendar.privateKeyMasked, PRIVATE_KEY_MASK);
  assert.match(out.googleCalendar.privateKeyFingerprint, /^[0-9a-f]{6}$/);
  assert.equal(out.googleCalendar.configured, true);
  assert.equal(out.googleCalendar.statusLabel, STATUS_LABELS.ACTIVE);
  assert.match(out.updatedAtLabel, /^\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/);
});

test('shapeResponse: empty row → empty wrapped payload + defaults', () => {
  const out = shapeResponse({});
  assert.equal(out.company.name, '');
  assert.equal(out.company.logoPath, '');
  assert.equal(out.quote.validityDays, 30);
  assert.equal(out.googleCalendar.calendarId, '');
  assert.equal(out.googleCalendar.privateKeyMasked, '');
  assert.equal(out.googleCalendar.privateKeyFingerprint, null);
  assert.equal(out.googleCalendar.configured, false);
  assert.equal(out.googleCalendar.statusLabel, STATUS_LABELS.MISSING);
  assert.equal(out.updatedAtLabel, null);
});
