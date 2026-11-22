/**
 * `gift_voucher_checks` — the footprint of the public code checks (specs/gift-vouchers.md rule 35): a visitor hash, an
 * outcome and a time. Never the typed code, never an address. Rows older than 30 days are purged.
 */

const KEPT_DAYS = 30;
const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function createChecksModel(db, { now = () => new Date() } = {}) {
  const record = ({ visitorHash, outcome }) => db.prepare('INSERT INTO gift_voucher_checks (visitorHash, outcome, createdAt) VALUES (?, ?, ?)')
    .run(String(visitorHash), outcome, iso(now()));

  /**
   * The failed checks (a well-formed code that is unknown) since `sinceMs` ago, of one visitor or of everyone. `notBefore`
   * (a timestamp in ms) leaves out what the breaker already answered for.
   */
  function failedSince(sinceMs, visitorHash = null, notBefore = 0) {
    const since = new Date(Math.max(now().getTime() - sinceMs, notBefore)).toISOString();
    const sql = `SELECT COUNT(*) AS n FROM gift_voucher_checks WHERE outcome = 'unknown' AND createdAt >= ?${visitorHash ? ' AND visitorHash = ?' : ''}`;
    return db.prepare(sql).get(...(visitorHash ? [since, String(visitorHash)] : [since])).n;
  }

  const purgeOld = () => db.prepare('DELETE FROM gift_voucher_checks WHERE createdAt < ?')
    .run(new Date(now().getTime() - KEPT_DAYS * 24 * 60 * 60 * 1000).toISOString()).changes;

  return { record, failedSince, purgeOld };
}

module.exports = createChecksModel;
