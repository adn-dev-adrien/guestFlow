/**
 * The one way a stay payment is recorded (specs/plugins-phase-3a-online-payment.md rules 1, 3).
 *
 * A payment ticked by hand on the fiche and a payment received through a provider's link used to be
 * two different writes: the online one flipped the flag with a raw UPDATE and skipped the contribs
 * capture the accounting reads. Both now go through `recordStayPayment`, so the same acompte leaves the
 * same rows whichever way it arrived.
 *
 * `bucket` ∈ deposit | balance | full (full = the deposit, then the balance). A bucket already paid is
 * left untouched, so a replayed webhook records nothing twice. Everything happens in one transaction:
 * a capture that breaks the conservation invariant throws and nothing is ticked — except for money
 * already received (`keepPaymentOnCaptureFailure`, the online path): the flag is ticked anyway, as it
 * always was, the capture is skipped and the failure is reported, because a payment the guest made must
 * never vanish from the stay.
 */

const { captureContribsOnFlip } = require('./forceItemContribsCapture');

const BUCKETS = { deposit: ['deposit'], balance: ['balance'], full: ['deposit', 'balance'] };
const COLUMNS = {
  deposit: { flag: 'depositPaid', date: 'depositPaidDate' },
  balance: { flag: 'balancePaid', date: 'balancePaidDate' },
};

// The day on the server's clock (Europe/Paris in production), not the UTC one: a payment at 00:30 is
// that day's.
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayIso = () => localDay(new Date());

// A provider's timestamp as the day it is in Paris; null when it cannot be read.
function paidDayOf(paidAt) {
  if (!paidAt) return null;
  const d = new Date(paidAt);
  return Number.isNaN(d.getTime()) ? null : localDay(d);
}

const BUCKET_LABELS = { deposit: 'acompte', balance: 'solde' };

/**
 * @param {object} deps
 * @param {object} deps.db                better-sqlite3 handle
 * @param {object} deps.reservationsModel getRow(id), releaseStayBucket(id, bucket)
 * @param {Function} [deps.emit]          plugin event bus emit (reservation.paid)
 * @param {{ reservationId: number, bucket: string, paidDate?: string, keepPaymentOnCaptureFailure?: boolean }} payment
 * @returns {{ flipped: string[], captureFailed: string[] }} the buckets this call ticked, and those
 *   ticked without their capture
 */
function recordStayPayment({ db, reservationsModel, emit }, { reservationId, bucket, paidDate, keepPaymentOnCaptureFailure = false }) {
  const buckets = BUCKETS[bucket];
  if (!buckets) throw new Error(`Unknown payment bucket: ${bucket}`);
  const id = Number(reservationId);
  const date = paidDate || todayIso();
  const flipped = [];
  const captureFailed = [];

  db.transaction(() => {
    buckets.forEach((b) => {
      const row = reservationsModel.getRow(id);
      if (!row) throw new Error(`Reservation ${id} not found`);
      if (Number(row[COLUMNS[b].flag] || 0) === 1) return;
      try {
        // A savepoint: a failed capture leaves no half-written contribs behind.
        db.transaction(() => captureContribsOnFlip({ db, reservation: row, bucket: b }))();
      } catch (err) {
        if (!keepPaymentOnCaptureFailure) throw err;
        // eslint-disable-next-line no-console
        console.error(`[payments] reservation ${id}: ${b} received but its contribs capture failed — ${err.message}`);
        captureFailed.push(b);
        // Said on the stay, where the operator looks: its accounting split is missing.
        db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'payment_capture_failed', ?)")
          .run(id, JSON.stringify([{ field: b, label: `Paiement en ligne (${BUCKET_LABELS[b]})`, from: null, to: 'reçu, répartition comptable non enregistrée' }]));
      }
      db.prepare(`UPDATE reservations SET ${COLUMNS[b].flag} = 1, ${COLUMNS[b].date} = ?, updatedAt = datetime('now') WHERE id = ?`)
        .run(date, id);
      reservationsModel.releaseStayBucket(id, b);
      flipped.push(b);
    });
  })();

  if (flipped.length) {
    if (emit) emit('reservation.paid', { reservationId: id, bucket });
  }
  return { flipped, captureFailed };
}

// The wiring the core uses, on the app's database or on a given one (the poll and webhook effects take
// theirs injected). Neat listens to `reservation.paid` (specs/plugins-phase-3b-neat.md rule 9).
function depsFor(database) {
  const appDb = require('../database');
  const reservationsModel = require('../models/reservationsModel');
  const onApp = !database || database === appDb;
  return {
    db: onApp ? appDb : database,
    reservationsModel: onApp ? reservationsModel : reservationsModel.create(database),
    emit: require('../plugins/sdk/eventBus').emit,
  };
}

const defaultDeps = () => depsFor(null);

module.exports = { paidDayOf, recordStayPayment, defaultDeps, depsFor, BUCKETS };
