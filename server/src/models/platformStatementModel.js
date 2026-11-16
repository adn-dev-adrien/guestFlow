// The platform statement written outside the fiche save (specs/platform-statement-after-payout.md): on a received
// payout or a locked fiche, the brut, the tax the platform kept and the commissions are corrected in one
// transaction, the stay is never re-priced, and the correction is traced.

const db = require('../database');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { saleChannel } = require('../utils/saleChannel');
const { captureBucketSplit } = require('../utils/forceItemContribsCapture');
const correction = require('../utils/platformStatementCorrection');
const { formatEuros } = require('../utils/reservationLedger');

const HISTORY_LABELS = {
  platformGrossAmount: 'Montant total payé par le client',
  platformTouristTaxAmount: 'Taxe de séjour retenue',
  platformCommissionAmount: 'Commission solde',
  acompteCommissionAmount: 'Commission acompte',
  depositAmount: 'Acompte',
  balanceAmount: 'Solde',
  finalPrice: 'Prix final',
  platformPayoutAmount: 'Virement reçu',
};

const flag = (value) => Number(value || 0) === 1;
const blank = (value) => value === '' || value == null;
const sameMoney = (a, b) => (blank(a) && blank(b)) || (!blank(a) && !blank(b) && Math.abs(Number(a) - Number(b)) < 0.005);
// A commission never typed reads as none: the replay's 0 is not a change worth a write or a history line.
const COMMISSION_COLUMNS = new Set(['platformCommissionAmount', 'acompteCommissionAmount']);
const unchanged = (column, from, to) => sameMoney(from, to) || (COMMISSION_COLUMNS.has(column) && blank(from) && Number(to) === 0);
const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

function createPlatformStatementModel(database) {
  const balanceContribsCaptured = (row) => row.accommodationSoldeContribTtc != null;

  /**
   * @param {number} id
   * @param {object} body the « Paiement plateforme » fields (STATEMENT_FIELDS)
   * @param {{ dryRun?: boolean }} [opts] dryRun: every check and the net sentence, nothing written (the panel's preview)
   * @returns {{ ok: true, netGap: number, netLabel: object|null, changed: string[] } | { ok: false, status: number, error: string }}
   */
  function correct(id, body, { dryRun = false } = {}) {
    const stored = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
    if (!stored) return fail(404, 'Réservation non trouvée');
    if (stored.kind !== 'reservation' || stored.cancelledAt) {
      return fail(400, 'Séjour annulé ou hors réservation : aucun relevé à corriger.', { code: 'NOT_A_PLATFORM_STAY' });
    }
    if (!saleChannel(stored.platform).namedChannel) {
      return fail(400, 'Réservation directe : il n’y a pas de relevé de plateforme.', { code: 'NOT_A_PLATFORM_STAY' });
    }
    const parsed = correction.parseStatement(body, stored);
    if (!parsed.ok) return fail(400, parsed.error, { code: 'INVALID_STATEMENT' });

    const before = quoteStoredReservation(database, stored);
    const after = quoteStoredReservation(database, { ...stored, ...parsed.statement });
    if (!before || before.error || !after || after.error) {
      return fail(409, 'Le séjour ne peut pas être rejoué : déverrouiller la fiche pour corriger le relevé.', { code: 'STATEMENT_WOULD_REPRICE', moved: [] });
    }
    const moved = correction.movedFigures(before, after);
    if (moved.length > 0) {
      return fail(409, `Ce relevé modifierait aussi ${moved.join(', ')} : déverrouiller la fiche pour corriger le séjour.`, { code: 'STATEMENT_WOULD_REPRICE', moved });
    }

    const received = flag(stored.balancePaid) || flag(stored.balancePaidCash);
    const transfer = correction.netReceived(stored);
    const next = correction.nextColumns(stored, parsed.statement, after);
    // Rule 8 — the transfer as it came in is kept before the statement changes what the stored net reads.
    if (received && blank(stored.platformPayoutAmount)) next.platformPayoutAmount = transfer;

    const changes = Object.keys(next).filter((column) => !unchanged(column, stored[column], next[column]));
    const outcome = {
      ok: true,
      netGap: received ? correction.netGapOf(next, transfer) : 0,
      netLabel: correction.netLabelOf(next, received ? transfer : null, formatEuros),
      changed: changes,
    };
    if (dryRun || changes.length === 0) return outcome;

    database.transaction(() => {
      const assignments = changes.map((column) => `${column} = @${column}`).join(', ');
      database.prepare(`UPDATE reservations SET ${assignments}, updatedAt = CURRENT_TIMESTAMP WHERE id = @id`)
        .run({ ...Object.fromEntries(changes.map((column) => [column, next[column]])), id: stored.id });
      // The solde's split was frozen at its reception: re-captured on the corrected amount so it still sums to it.
      if (received && balanceContribsCaptured(stored) && changes.includes('balanceAmount')) {
        captureBucketSplit({ db: database, reservation: database.prepare('SELECT * FROM reservations WHERE id = ?').get(stored.id), bucket: 'balance' });
      }
      database.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)')
        .run(stored.id, 'platform_statement', JSON.stringify(changes.map((column) => ({
          field: column,
          label: HISTORY_LABELS[column] || column,
          from: blank(stored[column]) ? null : Number(stored[column]),
          to: blank(next[column]) ? null : Number(next[column]),
        }))));
    })();

    return outcome;
  }

  return { correct };
}

module.exports = { ...createPlatformStatementModel(db), createPlatformStatementModel };
