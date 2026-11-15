// specs/gift-vouchers.md rules 33-35 — checking a code in public: the proof of work, the three limits, the mistyped code that
// is not counted, the cancelled code that answers unknown, and nothing typed kept.
const test = require('node:test');
const assert = require('node:assert/strict');

const code = require('../code');
const fx = require('./giftVoucherFixtures');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

async function withChecks(fn, over) {
  const fixture = fx.buildApi(undefined, over);
  const server = await fx.start(fixture);
  const check = (typed, { ip = '10.0.0.1', proof = fx.solvedProof({ ip }) } = {}) => server.call(
    'POST', '/public/v1/gift-vouchers/check', { code: typed, ...proof }, { 'x-test-ip': ip },
  );
  const unknownCode = () => code.generate();
  try {
    await fn({
      ...fixture, server, check, unknownCode,
    });
  } finally {
    await server.close();
  }
}

const failedRows = (db) => db.prepare("SELECT COUNT(*) AS n FROM gift_voucher_checks WHERE outcome = 'unknown'").get().n;

test('rule 33: a check without a solved proof-of-work is refused 403, a replayed proof too, and a proof of no work', () => withChecks(async ({ check, unknownCode }) => {
  const real = fx.solvedProof({ ip: '10.0.0.1' });
  assert.equal((await check(unknownCode(), { proof: {} })).status, 403);
  assert.equal((await check(unknownCode(), { proof: { challenge: real.challenge, nonce: 'wrong-nonce' } })).status, 403);
  assert.equal((await check(unknownCode(), { proof: real })).status, 404, 'the first spend passes');
  assert.equal((await check(unknownCode(), { proof: real })).status, 403, 'a solved challenge is spent once');
  assert.equal((await check(unknownCode(), { proof: fx.solvedProof({ difficulty: 4, ip: '10.0.0.1' }) })).status, 403, 'below the base difficulty');
  assert.equal((await check(unknownCode(), { ip: '10.0.0.2', proof: fx.solvedProof({ ip: '10.0.0.1' }) })).status, 403, 'bound to the visitor’s address');
}));

test('rule 34: a mistyped code answers 400 VOUCHER_CODE_MISTYPED before any lookup, and never counts as a failed check', () => withChecks(async ({
  check, db, unknownCode,
}) => {
  const good = unknownCode();
  const mistyped = `${good.slice(0, 5)}${good[5] === '0' ? '1' : '0'}${good.slice(6)}`;
  for (let i = 0; i < 12; i += 1) {
    const res = await check(mistyped);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VOUCHER_CODE_MISTYPED');
  }
  assert.equal(failedRows(db), 0);
  assert.equal((await check(good)).status, 404, 'after twelve typos the visitor still has all its tries');
}));

test('rule 34: too short, too long, non-text — all “mistyped”, none counted', () => withChecks(async ({ check, db }) => {
  for (const typed of ['', 'ABC', 'A'.repeat(17), 'U'.repeat(16), '!!!!']) {
    assert.equal((await check(typed)).status, 400, typed);
  }
  assert.equal((await check(12345)).status, 400);
  assert.equal(failedRows(db), 0);
}));

test('rule 34: a well-formed unknown code answers 404 VOUCHER_UNKNOWN and counts, with the tries left', () => withChecks(async ({ check, unknownCode }) => {
  const first = await check(unknownCode());
  assert.equal(first.status, 404);
  assert.equal(first.body.error.code, 'VOUCHER_UNKNOWN');
  assert.deepEqual(first.body.error.details, [{ triesLeft: 4 }]);
  assert.deepEqual((await check(unknownCode())).body.error.details, [{ triesLeft: 3 }]);
}));

test('rule 33: 5 failed checks per visitor per 15 minutes — the 6th is 429 with Retry-After, another visitor is untouched, the window slides', () => withChecks(async ({
  check, unknownCode, clock,
}) => {
  for (let i = 0; i < 5; i += 1) assert.equal((await check(unknownCode())).status, 404);
  const sixth = await check(unknownCode());
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error.code, 'VOUCHER_CHECKS_EXCEEDED');
  assert.equal(sixth.headers.get('retry-after'), '900');
  assert.equal((await check(unknownCode(), { ip: '10.0.0.2' })).status, 404, 'another visitor');
  clock.at = new Date(clock.at.getTime() + 16 * MIN);
  assert.equal((await check(unknownCode())).status, 404, '15 minutes later the visitor may try again');
}));

test('rule 33: 20 failed checks per visitor per day, even spread over several 15-minute windows', () => withChecks(async ({
  check, unknownCode, clock,
}) => {
  for (let window = 0; window < 5; window += 1) {
    for (let i = 0; i < 4; i += 1) assert.equal((await check(unknownCode())).status, 404);
    clock.at = new Date(clock.at.getTime() + 16 * MIN);
  }
  const blocked = await check(unknownCode());
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'VOUCHER_CHECKS_EXCEEDED');
  assert.equal(blocked.headers.get('retry-after'), '86400');
  clock.at = new Date(clock.at.getTime() + 25 * HOUR);
  assert.equal((await check(unknownCode())).status, 404);
}));

test('rule 33: more than 30 failed checks in an hour over the instance pauses every public check for 30 minutes, then lifts', () => withChecks(async ({
  check, unknownCode, clock, trips, api,
}) => {
  for (let visitor = 0; visitor < 8; visitor += 1) {
    for (let i = 0; i < (visitor === 7 ? 3 : 4); i += 1) assert.equal((await check(unknownCode(), { ip: `10.1.0.${visitor}` })).status, 404);
  }
  assert.equal(trips.length, 0, '31 failures: the breaker opens above 30, when the next check asks');
  const paused = await check(unknownCode(), { ip: '10.9.9.9' });
  assert.equal(paused.status, 429);
  assert.equal(paused.body.error.code, 'VOUCHER_CHECKS_PAUSED');
  assert.equal(paused.headers.get('retry-after'), '1800');
  assert.equal(trips.length, 1);
  assert.equal(trips[0].failed, 31);
  assert.equal((await check(unknownCode(), { ip: '10.1.0.0' })).status, 429, 'every visitor, whoever failed');
  assert.equal(trips.length, 1, 'raised once');
  const item = api.attention.summarize({ paused: api.checkLimits.isPaused() });
  assert.deepEqual([item.count, item.severity], [1, 'warning']);
  clock.at = new Date(clock.at.getTime() + 31 * MIN);
  const lifted = await check(unknownCode(), { ip: '10.9.9.9' });
  assert.equal(lifted.status, 404, `lifted after 30 minutes, the old failures no longer count ${JSON.stringify(lifted.body)}`);
  assert.equal(api.attention.summarize({ paused: api.checkLimits.isPaused() }), null);
  assert.equal(trips.length, 1);
}));

test('rule 33: a mistyped code is also refused while the checks are paused (no answer at all, whatever is typed)', () => withChecks(async ({
  check, unknownCode,
}) => {
  for (let visitor = 0; visitor < 8; visitor += 1) {
    for (let i = 0; i < 4; i += 1) await check(unknownCode(), { ip: `10.1.0.${visitor}` });
  }
  assert.equal((await check('mistyped-typo', { ip: '10.9.9.9' })).status, 429);
}));

test('rule 34: a known code answers its balance and expiry; a cancelled one answers like an unknown one, and counts', () => withChecks(async ({
  check, server, db,
}) => {
  const voucher = await fx.issueManual(server, { amountCents: 20000 });
  const plain = await fx.revealedCode(server, voucher.id);
  const typed = code.format(plain).toLowerCase();
  const ok = await check(typed);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data, { usable: true, balanceCents: 20000, expiresOn: '2028-05-15' });
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  await server.call('POST', `/api/gift-vouchers/${voucher.id}/cancel`, {});
  const gone = await check(plain);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.error.code, 'VOUCHER_UNKNOWN');
  assert.equal(failedRows(db), 1);
}));

test('rule 34: an expired voucher says « expiré le … », an exhausted one says used up — neither is a failed check', () => withChecks(async ({
  check, server, db, clock, api,
}) => {
  const a = await fx.issueManual(server);
  const b = await fx.issueManual(server);
  const codeA = await fx.revealedCode(server, a.id);
  const codeB = await fx.revealedCode(server, b.id);
  api.movements.append({
    voucherId: b.id, kind: 'redeem', amountCents: -15000, actor: 'system', idempotencyKey: 'all',
  });
  assert.deepEqual((await check(codeB)).body.data, { usable: false, reason: 'exhausted' });
  clock.at = new Date('2028-05-16T10:00:00Z');
  assert.deepEqual((await check(codeA)).body.data, { usable: false, reason: 'expired', expiresOn: '2028-05-15' });
  assert.equal(failedRows(db), 0);
}));

test('rule 35: a check changes nothing — no voucher, no movement, no balance', () => withChecks(async ({
  check, server, db,
}) => {
  const voucher = await fx.issueManual(server);
  const plain = await fx.revealedCode(server, voucher.id);
  const snapshot = () => JSON.stringify(['gift_vouchers', 'gift_voucher_movements', 'gift_voucher_orders'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
  const before = snapshot();
  await check(plain);
  await check(code.generate());
  assert.equal(snapshot(), before);
}));

test('rule 35: every check is recorded with its outcome — and never the typed code nor the address', () => withChecks(async ({
  check, server, db,
}) => {
  const voucher = await fx.issueManual(server);
  const plain = await fx.revealedCode(server, voucher.id);
  const typedUnknown = code.generate();
  await check(plain);
  await check(typedUnknown);
  await check('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  const rows = db.prepare('SELECT * FROM gift_voucher_checks ORDER BY id').all();
  assert.deepEqual(rows.map((r) => r.outcome), ['usable', 'unknown', 'mistyped']);
  const dump = JSON.stringify(rows);
  [plain, code.format(plain), typedUnknown, '10.0.0.1', 'ZZZZ'].forEach((secret) => assert.equal(dump.includes(secret), false, secret));
  assert.match(rows[0].visitorHash, /^[0-9a-f]{64}$/);
}));

test('rule 35: rows older than 30 days are purged', () => withChecks(async ({
  check, unknownCode, clock, api, db,
}) => {
  await check(unknownCode());
  clock.at = new Date(clock.at.getTime() + 29 * 24 * HOUR);
  await check(unknownCode());
  assert.equal(api.purgeOldChecks(), 0);
  clock.at = new Date(clock.at.getTime() + 2 * 24 * HOUR);
  assert.equal(api.purgeOldChecks(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_voucher_checks').get().n, 1);
}));

test('rule 33: a body that is not an object is a mistyped code, not a crash', () => withChecks(async ({ server }) => {
  for (const body of [[], 'text', null, 42]) {
    const res = await server.call('POST', '/public/v1/gift-vouchers/check', body);
    assert.ok([400, 403].includes(res.status), `${JSON.stringify(body)} → ${res.status}`);
  }
}));
