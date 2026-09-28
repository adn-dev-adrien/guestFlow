const test = require('node:test');
const assert = require('node:assert/strict');

// specs/site-traffic-analytics.md §3.C — the source of a website booking request: the validator that
// never refuses (rule 15), the channel classification (rule 16), the ready-to-render origin (rule 19)
// and the row of the « Canaux de réservation » card a reservation belongs to (rule 21).
const { validateAttribution } = require('../utils/publicInputValidation');
const { classifyAttribution, originDisplay, bookingChannelOf, platformDisplayName } = require('../utils/attributionChannel');
const { isDirectChannel } = require('../utils/platformNameFormat');

// ── rule 15 — validateAttribution ─────────────────────────────────────────────────────────

test('validateAttribution keeps the known keys, trimmed', () => {
  assert.deepEqual(validateAttribution({
    referrer: ' L.Instagram.com ', utmSource: ' instagram ', utmCampaign: 'lancement-2026',
    landingPath: '/la-granja/', firstSeenAt: '2026-09-28T12:00:00.000Z', extra: 'dropped',
  }), {
    referrer: 'l.instagram.com', utmSource: 'instagram', utmCampaign: 'lancement-2026',
    landingPath: '/la-granja/', firstSeenAt: '2026-09-28T12:00:00.000Z',
  });
});

test('validateAttribution caps every text at 200 characters', () => {
  const out = validateAttribution({ utmCampaign: 'x'.repeat(5000) });
  assert.equal(out.utmCampaign.length, 200);
});

test('validateAttribution drops a malformed field and keeps the rest', () => {
  assert.deepEqual(validateAttribution({
    referrer: 'pas un site !!', landingPath: 'https://evil.example/', firstSeenAt: 'hier', utmMedium: 42, utmSource: 'google',
  }), { utmSource: 'google' });
});

test('validateAttribution never throws and turns hopeless input into null', () => {
  for (const raw of [undefined, null, 'instagram', 42, [], ['a'], {}, { referrer: '' }, { utmSource: { $gt: 1 } }]) {
    assert.equal(validateAttribution(raw), null);
  }
});

// ── rule 16 — classifyAttribution ─────────────────────────────────────────────────────────

test('classifyAttribution: one case per rule, first match wins', () => {
  const cases = [
    [{ utmSource: 'instagram', utmCampaign: 'lancement-2026', referrer: 'www.google.fr' }, 'campaign', 'lancement-2026'],
    [{ utmSource: 'instagram' }, 'campaign', 'Instagram'],
    [{ utmSource: 'newsletter' }, 'campaign', 'newsletter'],
    [{ referrer: 'chatgpt.com' }, 'ai', 'ChatGPT'],
    [{ referrer: 'www.perplexity.ai' }, 'ai', 'Perplexity'],
    [{ referrer: 'gemini.google.com' }, 'ai', 'Gemini'],
    [{ referrer: 'www.google.fr' }, 'search', 'Google'],
    [{ referrer: 'www.google.co.uk' }, 'search', 'Google'],
    [{ referrer: 'duckduckgo.com' }, 'search', 'DuckDuckGo'],
    [{ referrer: 'www.qwant.com' }, 'search', 'Qwant'],
    [{ referrer: 'l.instagram.com' }, 'social', 'Instagram'],
    [{ referrer: 'm.facebook.com' }, 'social', 'Facebook'],
    [{ referrer: 't.co' }, 'social', 'X'],
    [{ referrer: 'www.ardeche-insolite.fr' }, 'referral', 'ardeche-insolite.fr'],
    [{ landingPath: '/' }, 'direct', null],
  ];
  for (const [rec, channel, label] of cases) {
    assert.deepEqual(classifyAttribution(rec), { channel, label }, JSON.stringify(rec));
  }
});

test('classifyAttribution: no record at all is unknown, not direct', () => {
  assert.deepEqual(classifyAttribution(null), { channel: null, label: null });
});

// ── rule 19 — originDisplay ───────────────────────────────────────────────────────────────

test('originDisplay labels a website request with its channel and detail', () => {
  const row = {
    requestOrigin: 'public', attributionChannel: 'campaign', attributionLabel: 'lancement-2026',
    attribution: JSON.stringify({ landingPath: '/la-granja/', utmSource: 'instagram', utmMedium: 'story', utmCampaign: 'lancement-2026' }),
  };
  assert.deepEqual(originDisplay(row), {
    originLabel: 'Campagne · lancement-2026',
    originDetail: 'Arrivé sur /la-granja/ · utm_source=instagram · utm_medium=story · utm_campaign=lancement-2026',
  });
});

test('originDisplay: direct has no detail label, unknown says so, a non-website row says nothing', () => {
  assert.equal(originDisplay({ requestOrigin: 'public', attributionChannel: 'direct', attribution: '{"landingPath":"/"}' }).originLabel, 'Accès direct');
  assert.deepEqual(originDisplay({ requestOrigin: 'public' }), { originLabel: 'Origine inconnue', originDetail: null });
  assert.deepEqual(originDisplay({ requestOrigin: null, attributionChannel: 'search' }), { originLabel: null, originDetail: null });
  assert.deepEqual(originDisplay({ requestOrigin: 'public', attributionChannel: 'search', attributionLabel: 'Google', attribution: '{broken' }),
    { originLabel: 'Recherche · Google', originDetail: null });
});

// ── rule 21 — bookingChannelOf ────────────────────────────────────────────────────────────

test('bookingChannelOf: a website request is a website row whatever its platform', () => {
  assert.equal(bookingChannelOf({ requestOrigin: 'public', platform: 'direct', attributionChannel: 'social' }, isDirectChannel).key, 'site:social');
  assert.equal(bookingChannelOf({ requestOrigin: 'public', platform: 'direct' }, isDirectChannel).key, 'site:unknown');
});

test('bookingChannelOf: Lodgify is direct, never a platform row', () => {
  for (const platform of ['direct', 'Lodgify', 'lodgify', null]) {
    assert.deepEqual(bookingChannelOf({ platform }, isDirectChannel), { key: 'direct', group: 'direct', channel: null, label: 'Direct (saisie)' });
  }
  assert.deepEqual(bookingChannelOf({ platform: 'GitesDeFrance' }, isDirectChannel),
    { key: 'platform:gîtes de france', group: 'platform', channel: null, label: 'Gîtes de France' });
  assert.equal(platformDisplayName('Airbnb'), 'Airbnb');
});
