// specs/google-vacation-rentals-feed.md rules 18 and 19 — the landing link given to Google, and the
// WordPress booking block that opens with its dates and party size. The block is browser JavaScript:
// its two URL readers are lifted out of view.js and run here, against a stubbed address bar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { landingUrlTemplate } = require('../plugins/google-vacation-rentals/controller');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const view = fs.readFileSync(path.join(PLUGIN, 'blocks', 'booking', 'view.js'), 'utf8');

function slice(from, to) {
  const start = view.indexOf(from);
  const end = view.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to} is in view.js`);
  return view.slice(start, end);
}
const helpers = slice('  function pad(n)', '  function addDaysIso');
const readers = slice('  function queryParam(name)', '  function init(container)');

/** stayFromUrl() as the block runs it, on `search`, with today pinned. */
function stayFrom(search, today = '2026-10-26') {
  const sandbox = { window: { location: { search } }, URLSearchParams, Date };
  vm.createContext(sandbox);
  vm.runInContext(`${helpers}\n${readers}\nfunction todayIso() { return ${JSON.stringify(today)}; }\nthis.result = stayFromUrl();`, sandbox);
  return { ...sandbox.result };
}

test('rule 19 — the link of the spec opens the block on its dates and party size', () => {
  assert.deepEqual(stayFrom('?checkin=12%2F12%2F2026&checkout=14%2F12%2F2026&guests=4&utm_source=google'), {
    start: '2026-12-12', end: '2026-12-14', guests: 4,
  });
});

test('rule 19 — invalid or past dates are ignored silently; the party size stands on its own', () => {
  const empty = { start: null, end: null };
  assert.deepEqual(stayFrom('?checkin=31%2F02%2F2027&checkout=02%2F03%2F2027&guests=2'), { ...empty, guests: 2 }, 'no 31 February');
  assert.deepEqual(stayFrom('?checkin=20%2F10%2F2026&checkout=22%2F10%2F2026'), { ...empty, guests: null }, 'past');
  assert.deepEqual(stayFrom('?checkin=14%2F12%2F2026&checkout=12%2F12%2F2026'), { ...empty, guests: null }, 'checkout before checkin');
  assert.deepEqual(stayFrom('?checkin=2026-12-12&checkout=2026-12-14'), { ...empty, guests: null }, 'ISO is not the link format');
  assert.deepEqual(stayFrom('?checkin=12%2F12%2F2026'), { ...empty, guests: null }, 'no checkout');
  assert.deepEqual(stayFrom('?guests=0'), { ...empty, guests: null });
  assert.deepEqual(stayFrom('?guests=4x'), { ...empty, guests: null });
  assert.deepEqual(stayFrom(''), { ...empty, guests: null });
  assert.deepEqual(stayFrom('?checkin=26%2F10%2F2026&checkout=27%2F10%2F2026', '2026-10-26').start, '2026-10-26', 'today is not past');
});

test('rule 19 — the block applies them: party size within capacity, dates on the arrival month, no tracking event', () => {
  assert.match(view, /if \(stayInUrl\.guests && stayInUrl\.guests <= maxGuests\) state\.adults = stayInUrl\.guests;/);
  assert.match(view, /calBase = firstOfMonth\(new Date\(stayInUrl\.start \+ 'T00:00:00'\)\);/);
  const prefill = slice('    if (stayInUrl.start) {', '    renderBabyBeds();');
  assert.doesNotMatch(prefill, /track/, 'a link is not a visitor picking dates');
});

test('rule 19 — the WordPress plugin version moved, in its header, its constant and its readme', () => {
  const php = fs.readFileSync(path.join(PLUGIN, 'guestflow-booking.php'), 'utf8');
  const readme = fs.readFileSync(path.join(PLUGIN, 'readme.txt'), 'utf8');
  const version = (php.match(/\* Version:\s+(\S+)/) || [])[1];
  // 1.17.0 shipped the landing link; later versions keep it, so only the release note is pinned.
  assert.ok(version && version.localeCompare('1.17.0', undefined, { numeric: true }) >= 0, version);
  assert.match(php, new RegExp(`define\\('GF_BOOKING_VERSION', '${version}'\\)`));
  assert.match(readme, new RegExp(`Stable tag: ${version}`));
  assert.match(readme, /= 1\.17\.0 =\n\* Lien d'arrivée de Google Vacation Rentals/);
});

test('rule 18 — the landing link given to Google: the property page with the dates, the party size and the campaign', () => {
  assert.equal(
    landingUrlTemplate('https://domainesolio.com/', 'la-granja'),
    'https://domainesolio.com/la-granja/?checkin=(CHECKINDAY)%2F(CHECKINMONTH)%2F(CHECKINYEAR)'
      + '&checkout=(CHECKOUTDAY)%2F(CHECKOUTMONTH)%2F(CHECKOUTYEAR)&guests=(NUM-ADULTS)&utm_source=google&utm_medium=vacation-rentals',
  );
  assert.equal(landingUrlTemplate('', 'la-granja'), null, 'no website origin, no link');
});
