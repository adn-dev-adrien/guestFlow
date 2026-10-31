/**
 * The guest whose payment request lost its dates to another stay is told, once (specs/payment-link-lifecycle.md
 * rules 43-45, 47, 63-65).
 *
 * A stay is due a notice when a link of it (or of the devis it came from) was withdrawn `dates-taken` and the
 * provider then read that link unpaid: still `cancelled`, its deactivation no longer owed, no payment recorded on
 * it. A link found paid is rule 33's (booked in conflict), never a notice. Before anything leaves, the stay must
 * still be an open devis or a reservation, unpaid, not begun (Paris day) and on nights a stay holding its dates
 * covers. The `dates_taken_notices` row is claimed first (`ON CONFLICT DO NOTHING`): only the caller that inserted
 * it sends, so a stay is told once whatever runs at the same moment, and a stay seeded at the upgrade (rule 61) is
 * never mailed.
 *
 * The e-mail is the single exception to « no guest e-mail without validation » (rule 44): this module is the only
 * reader of `AUTO_SEND_EXCEPTIONS`, and it sends by name through `sendReservationTemplateEmail`, never through the
 * policy nor the queue. It fails closed (template off, no address, no English, no SMTP): nothing leaves and the push
 * and the card say « client non prévenu » with the reason.
 *
 *   buildDatesTakenNotice(deps) → { runDueNotices({ now }), notifyDatesTaken(stayId, { now }), idle() }
 *   runDueNotices({ now })      → the core scheduled pass (scheduledTasks.js), never a GET
 *   notifyDatesTaken(stayId)    → { status: 'sent' | 'not-sent' | 'already' | 'not-due', reason? }; also asked by
 *                                 the refused acompte reminder (rule 35)
 *   datesTakenCard(database, { today }) → the dashboard card's rows (rule 43), ready to render
 */

const { AUTO_SEND_EXCEPTIONS } = require('./autoSendPolicy');
const { LINK_REASONS } = require('../constants/paymentLinks');
const { localIsoDate } = require('./localDate');
const { ENGLISH_VERSION_MISSING } = require('./emailTemplateLanguage');

const NOTICE_STABLE_KEY = 'dates_unavailable_notice';
const occurrenceKeyOf = (stayId) => `dates-taken:${Number(stayId)}`;

// Why a stay was not told, as the push and the card write it.
const NOT_SENT_LABELS = Object.freeze({
  'no-template': 'modèle désactivé',
  'no-email': 'pas d’adresse e-mail',
  [ENGLISH_VERSION_MISSING]: 'version anglaise manquante',
  EMAIL_NOT_CONFIGURED: 'SMTP non configuré',
  upgrade: 'lien retiré à la mise à jour',
  'send-failed': 'échec de l’envoi',
});
const notSentLabel = (reason) => NOT_SENT_LABELS[reason] || NOT_SENT_LABELS['send-failed'];

const OPEN_DEVIS_STATUSES = new Set(['draft', 'sent', 'accepted']);

const ddmm = (iso) => {
  const [, m, d] = String(iso || '').slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : '';
};
const nameOf = (row) => [row && row.firstName, row && row.lastName].map((s) => String(s == null ? '' : s).trim()).filter(Boolean).join(' ');

function readStay(database, id) {
  return database.prepare(`
    SELECT r.id, r.kind, r.devisStatus, r.convertedReservationId, r.startDate, r.endDate, r.reservationNumber,
           c.firstName, c.lastName, p.name AS propertyName
      FROM reservations r
      LEFT JOIN clients c ON c.id = r.clientId
      LEFT JOIN properties p ON p.id = r.propertyId
     WHERE r.id = ?
  `).get(Number(id));
}

// The links that answer for a stay: its own, and those of the devis it came from.
function linksOfStay(database, stayId) {
  return database.prepare(`
    SELECT l.id, l.status, l.cancelReason, l.remoteCancelPendingAt, l.paidAt, l.providerPaymentId
      FROM payment_links l
     WHERE l.reservationId = ? OR l.reservationId IN (SELECT id FROM reservations WHERE convertedReservationId = ?)
  `).all(Number(stayId), Number(stayId));
}

const readUnpaid = (l) => l.status === 'cancelled' && !l.remoteCancelPendingAt && !l.paidAt && !l.providerPaymentId;

// Rules 43, 63 — due, or why not. `takenBy` is the stay holding the nights (datesTaken.takenByOf).
function dueness(database, stayId, now) {
  const { answeringStay, takenByOf } = require('./datesTaken');
  const found = answeringStay(database, stayId);
  if (!found || Number(found.stay.id) !== Number(stayId)) return { due: false, reason: 'not-a-stay' };
  const stay = readStay(database, stayId);
  if (!stay || !['devis', 'reservation'].includes(String(stay.kind))) return { due: false, reason: 'not-a-stay' };
  if (stay.kind === 'devis' && (stay.convertedReservationId || !OPEN_DEVIS_STATUSES.has(String(stay.devisStatus || 'draft')))) return { due: false, reason: 'devis-closed' };
  if (String(stay.startDate).slice(0, 10) <= localIsoDate(now)) return { due: false, reason: 'begun' };
  const takenLinks = linksOfStay(database, stayId).filter((l) => l.cancelReason === LINK_REASONS.DATES_TAKEN);
  if (!takenLinks.some(readUnpaid)) return { due: false, reason: 'no-withdrawn-link' };
  // A withdrawn link still unread may yet be paid (rule 33): the notice waits for every read.
  if (takenLinks.some((l) => l.status === 'cancelled' && !readUnpaid(l)) || takenLinks.some((l) => l.status === 'paid')) return { due: false, reason: 'unread-or-paid' };
  const holder = takenByOf(database, stayId);
  if (!holder) return { due: false, reason: 'dates-free' };
  return { due: true, stay, takenById: Number(holder.id) };
}

function takerLabel(database, takenById) {
  const taker = takenById ? readStay(database, takenById) : null;
  if (!taker) return 'une autre réservation';
  return `la réservation ${taker.reservationNumber || `#${taker.id}`}`;
}

function buildDatesTakenNotice({
  database = require('../database'),
  templatesModel = null,
  logModel = null,
  settingsModel = null,
  emailServiceFactory = null,
  push = null,
  logger = console,
} = {}) {
  const deps = () => ({
    templatesModel: templatesModel || require('../models/emailTemplatesModel'),
    logModel: logModel || require('../models/emailLogModel'),
    settingsModel: settingsModel || require('../models/settingsModel'),
    emailServiceFactory: emailServiceFactory || require('./emailService').createEmailService,
  });
  const pushOperators = push || ((payload) => require('./pushService').sendToPref('newReservation', payload));
  const inFlight = new Set();

  async function sendNotice(stay) {
    // Rule 44 — the exception is named, never inferred: without it in the list, nothing leaves.
    if (!AUTO_SEND_EXCEPTIONS.includes(NOTICE_STABLE_KEY)) return { sent: false, reason: 'no-template' };
    const { sendReservationTemplateEmail } = require('./reservationEmailSender');
    try {
      return await sendReservationTemplateEmail({
        database, ...deps(), reservationId: stay.id, stableKey: NOTICE_STABLE_KEY, occurrenceKey: occurrenceKeyOf(stay.id),
      });
    } catch (err) {
      logger.warn(`[dates-taken] notice for stay ${stay.id} failed: ${(err && err.message) || err}`);
      return { sent: false, reason: 'send-failed' };
    }
  }

  async function notify(stayId, { now = new Date() } = {}) {
    const verdict = dueness(database, stayId, now);
    if (!verdict.due) return { status: 'not-due', reason: verdict.reason };
    const { stay, takenById } = verdict;
    const claimed = database.prepare(`
      INSERT INTO dates_taken_notices (reservationId, takenByReservationId, noticeStatus, noticeReason, createdAt)
      VALUES (?, ?, 'not-sent', 'send-failed', ?)
      ON CONFLICT(reservationId) DO NOTHING
    `).run(stay.id, takenById, now.toISOString());
    if (Number(claimed.changes) === 0) return { status: 'already' };

    const outcome = await sendNotice(stay);
    const reason = outcome.sent ? null : (NOT_SENT_LABELS[outcome.reason] ? outcome.reason : 'send-failed');
    const logged = database.prepare('SELECT id FROM email_log WHERE reservationId = ? AND occurrenceKey = ? ORDER BY id DESC LIMIT 1')
      .get(stay.id, occurrenceKeyOf(stay.id));
    database.prepare('UPDATE dates_taken_notices SET noticeStatus = ?, noticeReason = ?, emailLogId = ? WHERE reservationId = ?')
      .run(outcome.sent ? 'sent' : 'not-sent', reason, logged ? logged.id : null, stay.id);
    logger.log(`[dates-taken] stay ${stay.id}: dates taken by stay ${takenById}, ${outcome.sent ? 'guest notice sent' : `guest not told (${reason})`}`);

    const told = outcome.sent ? 'client prévenu' : `client non prévenu : ${notSentLabel(reason)}`;
    try {
      await pushOperators({
        title: `Dates prises — ${nameOf(stay) || 'client'}`,
        body: `${[stay.propertyName, `${ddmm(stay.startDate)} → ${ddmm(stay.endDate)}`].filter(Boolean).join(', ')} : dates prises par ${takerLabel(database, takenById)}, ${told}.`,
        url: `/reservations/${stay.id}`,
      });
    } catch (err) {
      logger.warn(`[dates-taken] push for stay ${stay.id} failed: ${(err && err.message) || err}`);
    }
    return { status: outcome.sent ? 'sent' : 'not-sent', ...(reason ? { reason } : {}) };
  }

  function track(promise) {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise)).catch(() => {});
    return promise;
  }

  function notifyDatesTaken(stayId, options) {
    return track(notify(stayId, options));
  }

  // The stays with a link withdrawn for taken dates, read unpaid by the provider, not told yet.
  function candidates() {
    return database.prepare(`
      SELECT DISTINCT COALESCE(r.convertedReservationId, r.id) AS stayId
        FROM payment_links l
        JOIN reservations r ON r.id = l.reservationId
       WHERE l.status = 'cancelled' AND l.cancelReason = ? AND l.remoteCancelPendingAt IS NULL
         AND l.paidAt IS NULL AND l.providerPaymentId IS NULL
         AND NOT EXISTS (SELECT 1 FROM dates_taken_notices n WHERE n.reservationId = COALESCE(r.convertedReservationId, r.id))
       ORDER BY stayId
    `).all(LINK_REASONS.DATES_TAKEN).map((row) => Number(row.stayId));
  }

  async function runDueNotices({ now = new Date() } = {}) {
    const results = [];
    for (const stayId of candidates()) results.push({ stayId, ...(await notifyDatesTaken(stayId, { now })) });
    return results;
  }

  async function idle() {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
  }

  return { runDueNotices, notifyDatesTaken, idle };
}

// Rule 43 — the card « Dates prises »: one row per stay still to look at (not « Vu », not over, still a devis or a
// reservation), newest first, every word written here.
function datesTakenCard(database, { today = localIsoDate(new Date()) } = {}) {
  const rows = database.prepare(`
    SELECT n.id, n.reservationId, n.takenByReservationId, n.noticeStatus, n.noticeReason,
           r.startDate, r.endDate, c.firstName, c.lastName, p.name AS propertyName
      FROM dates_taken_notices n
      JOIN reservations r ON r.id = n.reservationId
      LEFT JOIN clients c ON c.id = r.clientId
      LEFT JOIN properties p ON p.id = r.propertyId
     WHERE n.acknowledgedAt IS NULL AND r.kind IN ('devis', 'reservation') AND date(r.endDate) >= date(?)
     ORDER BY n.createdAt DESC, n.id DESC
  `).all(today);
  return rows.map((row) => {
    const sent = row.noticeStatus === 'sent';
    const taker = row.takenByReservationId ? readStay(database, row.takenByReservationId) : null;
    const takenBy = taker
      ? `Prises par ${takerLabel(database, taker.id)}${nameOf(taker) ? ` · ${nameOf(taker)}` : ''}.`
      : 'Prises par une autre réservation.';
    return {
      id: Number(row.id),
      reservationId: Number(row.reservationId),
      url: `/reservations/${Number(row.reservationId)}`,
      title: [nameOf(row) || 'Client', row.propertyName, `${ddmm(row.startDate)} → ${ddmm(row.endDate)}`].filter(Boolean).join(' · '),
      notice: { sent, label: sent ? 'client prévenu' : 'client non prévenu' },
      detail: sent ? takenBy : `${takenBy} Client non prévenu : ${notSentLabel(row.noticeReason)}.`,
      takenBy: taker ? { id: Number(taker.id), url: `/reservations/${Number(taker.id)}` } : null,
    };
  });
}

function acknowledgeDatesTaken(database, id, { now = new Date() } = {}) {
  const info = database.prepare('UPDATE dates_taken_notices SET acknowledgedAt = ? WHERE id = ? AND acknowledgedAt IS NULL').run(now.toISOString(), Number(id));
  return Number(info.changes) > 0;
}

let defaultNotice = null;
const instance = () => {
  if (!defaultNotice) defaultNotice = buildDatesTakenNotice();
  return defaultNotice;
};

module.exports = {
  buildDatesTakenNotice,
  datesTakenCard,
  acknowledgeDatesTaken,
  runDueNotices: (options) => instance().runDueNotices(options),
  notifyDatesTaken: (stayId, options) => instance().notifyDatesTaken(stayId, options),
  NOTICE_STABLE_KEY,
  NOT_SENT_LABELS,
};
