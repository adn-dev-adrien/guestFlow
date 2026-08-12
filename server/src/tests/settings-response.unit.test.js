const test = require('node:test');
const assert = require('node:assert/strict');

const settingsResponse = require('../utils/settingsResponse');
const { shapeResponse } = settingsResponse;
const { formatUpdatedAtLabel } = settingsResponse.__test;

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
test('shapeResponse: wraps under company / quote — googleCalendar group is gone (OAuth rework)', () => {
  const row = {
    companyName: 'Acme',
    companyAddress: '1 rue',
    companyEmail: 'a@b.com',
    companyPhone: '0102030405',
    companySiret: '12345678901234',
    companyTva: 'FR12345678901',
    companyIban: 'FR7630006000011234567890189',
    companyBic: 'BNPAFRPP',
    companyBankName: 'BNP',
    portalCode: 'PC-4290',
    quoteFooterText: 'Merci',
    quoteValidityDays: 45,
    companyLogoPath: '/uploads/x.png',
    updatedAt: '2026-05-24 12:32:00',
  };
  const out = shapeResponse(row);
  assert.equal(out.company.name, 'Acme');
  assert.equal(out.company.siret, '12345678901234');
  assert.equal(out.company.logoPath, '/uploads/x.png');
  // Non-regression: portalCode must round-trip through GET /settings so the Settings form
  // shows the saved code on load (fix/settings-portal-code-display). Was previously omitted
  // from the company block → the field always rendered empty.
  assert.equal(out.company.portalCode, 'PC-4290');
  assert.equal(out.quote.footerText, 'Merci');
  assert.equal(out.quote.validityDays, 45);
  // Google Calendar moved to GET /api/google-calendar/status
  // (specs/google-calendar-oauth-rework.md) — the settings payload must not carry it anymore.
  assert.equal(out.googleCalendar, undefined);
  assert.match(out.updatedAtLabel, /^\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/);
});

test('shapeResponse: empty row → empty wrapped payload + defaults', () => {
  const out = shapeResponse({});
  assert.equal(out.company.name, '');
  assert.equal(out.company.logoPath, '');
  assert.equal(out.company.portalCode, '');
  assert.equal(out.quote.validityDays, 30);
  assert.equal(out.googleCalendar, undefined);
  assert.equal(out.updatedAtLabel, null);
});

// Accounting block (specs/fiscal-year-and-nights-sold.md §4.3).
test('shapeResponse: accounting.fiscalYearEndMonth round-trips, defaulting to December', () => {
  assert.equal(shapeResponse({ fiscalYearEndMonth: 9 }).accounting.fiscalYearEndMonth, 9);
  // A pre-migration row (column NULL) reads as the calendar year, i.e. the pre-spec behaviour.
  assert.equal(shapeResponse({ fiscalYearEndMonth: null }).accounting.fiscalYearEndMonth, 12);
  assert.equal(shapeResponse({}).accounting.fiscalYearEndMonth, 12);
  // SQLite hands integers back as numbers, but be explicit: the client binds this to a Select value.
  assert.equal(typeof shapeResponse({ fiscalYearEndMonth: '9' }).accounting.fiscalYearEndMonth, 'number');
});
