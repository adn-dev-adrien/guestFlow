// specs/guest-email-sequence.md §3.2 + §3.4 — who does NOT receive an email of the sequence, and why.

const test = require('node:test');
const assert = require('node:assert/strict');

const { MAIL, planStayMails, planSeasonMail, capReached } = require('../utils/guestEmailSequence');

const CLIENT = { id: 1, email: 'camille@example.fr' };
const STAY = { id: 42, clientId: 1, platform: 'direct', createdAt: '2027-03-02', startDate: '2027-07-10', endDate: '2027-07-17' };

function stay(overrides = {}, { client = CLIENT, startDate = '2026-01-01' } = {}) {
  const byKey = {};
  for (const entry of planStayMails({ reservation: { ...STAY, ...overrides }, client, startDate })) byKey[entry.stableKey] = entry;
  return byKey;
}

function season(stableKey, stays, { client = CLIENT, sendDate, startDate = '2026-01-01' } = {}) {
  return planSeasonMail({ stableKey, client, stays, sendDate, startDate });
}

// rule 1 — a cancelled stay leaves the sequence from the moment it is cancelled.
test('a cancelled stay receives nothing', () => {
  for (const entry of Object.values(stay({ kind: 'cancelled' }))) assert.equal(entry.blocked, 'cancelled', entry.stableKey);
});

// rule 2 — the confirmation is a direct-channel mail; the others serve every channel.
test('confirmation: direct channels only; the other mails go to every channel', () => {
  for (const platform of ['direct', 'Lodgify', '']) assert.equal(stay({ platform })[MAIL.CONFIRMATION].blocked, null, platform);
  for (const platform of ['Airbnb', 'Booking', 'GitesDeFrance']) {
    const p = stay({ platform });
    assert.equal(p[MAIL.CONFIRMATION].blocked, 'notDirect', platform);
    assert.equal(p[MAIL.J7].blocked, null, platform);
    assert.equal(p[MAIL.J1].blocked, null, platform);
  }
});

test('no email address: nothing leaves', () => {
  for (const entry of Object.values(stay({}, { client: { id: 1, email: '' } }))) assert.equal(entry.blocked, 'noEmail');
});

test('before activation: nothing is sent, and never retroactively', () => {
  assert.equal(stay({}, { startDate: null })[MAIL.J7].blocked, 'notActivated');
  const p = stay({}, { startDate: '2027-07-05' });
  assert.equal(p[MAIL.CONFIRMATION].blocked, 'beforeActivation');
  assert.equal(p[MAIL.J7].blocked, 'beforeActivation', 'J-7 due on 3 July, activation on 5 July');
  assert.equal(p[MAIL.J2].blocked, null, 'J-2 due on 8 July still leaves');
});

test('a stay that ended before activation is out of the sequence entirely (J+1 and season mails)', () => {
  assert.equal(stay({}, { startDate: '2027-07-20' })[MAIL.J1].blocked, 'stayBeforeActivation');
  const nov = season(MAIL.NOVEMBER, [STAY], { sendDate: '2027-11-15', startDate: '2027-07-20' });
  assert.equal(nov.blocked, 'stayBeforeActivation');
});

test('client flag « pas de mails après séjour »: blocks J+1, November and January, never 1-3', () => {
  const client = { ...CLIENT, postStayEmailsDisabled: 1 };
  const p = stay({}, { client });
  assert.equal(p[MAIL.J1].blocked, 'clientOptedOut');
  assert.equal(p[MAIL.CONFIRMATION].blocked, null);
  assert.equal(p[MAIL.J7].blocked, null);
  assert.equal(season(MAIL.NOVEMBER, [STAY], { client, sendDate: '2027-11-15' }).blocked, 'clientOptedOut');
  assert.equal(season(MAIL.JANUARY, [STAY], { client, sendDate: '2028-01-06' }).blocked, 'clientOptedOut');
});

test('unsubscribe blocks the season mails only, never the stay mails', () => {
  const client = { ...CLIENT, marketingUnsubscribedAt: '2027-08-01 10:00:00' };
  for (const entry of Object.values(stay({}, { client }))) assert.equal(entry.blocked, null, entry.stableKey);
  assert.equal(season(MAIL.NOVEMBER, [STAY], { client, sendDate: '2027-11-15' }).blocked, 'unsubscribed');
  assert.equal(season(MAIL.JANUARY, [STAY], { client, sendDate: '2028-01-06' }).blocked, 'unsubscribed');
});

// rules 6-7 — the November and January population: a past stay, and nothing coming up.
test('season mails: a client who never stayed is not a candidate at all', () => {
  assert.equal(season(MAIL.NOVEMBER, [{ ...STAY, startDate: '2027-12-20', endDate: '2027-12-27' }], { sendDate: '2027-11-15' }), null);
  assert.equal(season(MAIL.NOVEMBER, [], { sendDate: '2027-11-15' }), null);
});

test('season mails: Airbnb / Booking relay addresses are never prospected; one direct stay is enough', () => {
  const airbnb = { ...STAY, platform: 'Airbnb' };
  assert.equal(season(MAIL.NOVEMBER, [airbnb], { sendDate: '2027-11-15' }).blocked, 'relayAddress');
  assert.equal(season(MAIL.JANUARY, [{ ...airbnb, platform: 'Booking.com' }], { sendDate: '2028-01-06' }).blocked, 'relayAddress');
  assert.equal(season(MAIL.NOVEMBER, [airbnb, { ...STAY, id: 43, platform: 'GitesDeFrance', startDate: '2026-05-01', endDate: '2026-05-04' }], { sendDate: '2027-11-15' }).blocked, null);
});

test('season mails: a reservation in progress or upcoming holds them back', () => {
  const upcoming = { ...STAY, id: 44, startDate: '2028-04-10', endDate: '2028-04-14' };
  assert.equal(season(MAIL.NOVEMBER, [STAY, upcoming], { sendDate: '2027-11-15' }).blocked, 'upcomingStay');
  const inProgress = { ...STAY, id: 45, startDate: '2027-11-13', endDate: '2027-11-17' };
  assert.equal(season(MAIL.NOVEMBER, [STAY, inProgress], { sendDate: '2027-11-15' }).blocked, 'upcomingStay');
});

// rules 6-7 — the 30-day rule belongs to November alone.
test('November skips a stay that ended less than 30 days before; January does not apply that rule', () => {
  const recent = { ...STAY, startDate: '2027-10-20', endDate: '2027-10-25' };
  assert.equal(season(MAIL.NOVEMBER, [recent], { sendDate: '2027-11-15' }).blocked, 'recentStay');
  const thirtyDays = { ...STAY, startDate: '2027-10-10', endDate: '2027-10-16' };
  assert.equal(season(MAIL.NOVEMBER, [thirtyDays], { sendDate: '2027-11-15' }).blocked, null, 'exactly 30 days is fine');
  assert.equal(season(MAIL.JANUARY, [{ ...STAY, startDate: '2027-12-20', endDate: '2027-12-27' }], { sendDate: '2028-01-06' }).blocked, null);
});

test('season mails carry the latest past stay (for « Vous étiez venus … ») and ignore cancelled ones', () => {
  const older = { ...STAY, id: 40, startDate: '2026-05-01', endDate: '2026-05-04' };
  const cancelled = { ...STAY, id: 41, kind: 'cancelled', startDate: '2027-09-01', endDate: '2027-09-05' };
  const entry = season(MAIL.JANUARY, [older, STAY, cancelled], { sendDate: '2028-01-06' });
  assert.equal(entry.reservationId, 42);
  assert.equal(entry.dedupKey, 'season_new_year:c1:2028-01');
});

// rule 8 — at most three post-stay contacts over any rolling 365 days.
test('yearly cap: the 4th post-stay contact within 365 days is refused', () => {
  assert.equal(capReached(2), false);
  assert.equal(capReached(3), true);
});
