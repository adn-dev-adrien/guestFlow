/**
 * The guest whose payment request lost its dates to another stay is told, once (specs/payment-link-lifecycle.md
 * rules 43-45, 47, 64-66).
 *
 * The notice answers a WITHDRAWAL, never a state (review of #912, B1). A link withdrawn `dates-taken` records the stay
 * that took the nights (`takenByReservationId`); it is ready to be judged once a read made after its deactivation (rule
 * 19's last look) found no payment, final or in flight (`unpaidReadAt`, M1). Each ready link is judged once
 * (`noticeJudgedAt`): due — the guest is told — only when the stay is still an open devis or a reservation, direct,
 * unpaid, not begun (Paris day), never told (nor the devis it came from), and the stay holding its nights is the one
 * that took them, for another client; any other answer closes it for good, so a later booking on freed nights mails
 * nobody. A link still unread waits, and so does every link of its stay.
 *
 * The `dates_taken_notices` row is claimed `sending` first (`ON CONFLICT DO NOTHING`, in one transaction with the
 * judgement): only the caller that inserted it sends. It turns `sent` in the transaction that writes the history row
 * on SMTP acceptance; a process that dies in between leaves `sending`, shown « envoi incertain » and never resent.
 *
 * The e-mail is the single exception to « no guest e-mail without validation » (rule 44): this module is the only
 * reader of `AUTO_SEND_EXCEPTIONS`, and it sends by name through `sendReservationTemplateEmail`, never through the
 * policy nor the queue; without the key in that list nothing leaves. It fails closed (template off, no address, no
 * English, no SMTP): nothing leaves and the push and the card say « client non prévenu » with the reason.
 *
 *   buildDatesTakenNotice(deps) → { runDueNotices({ now }), notifyDatesTaken(stayId, { now }), idle() }
 *   runDueNotices({ now })      → the core scheduled pass (scheduledTasks.js), never a GET
 *   notifyDatesTaken(stayId)    → { status: 'sent' | 'not-sent' | 'sending' | 'already' | 'not-due' | 'closed', reason? };
 *                                 also asked by the refused acompte reminder (rule 35)
 *   datesTakenCard(database, { today }) → the dashboard card's rows (rule 66), ready to render
 */

const { AUTO_SEND_EXCEPTIONS } = require('./autoSendPolicy');
const { LINK_REASONS } = require('../constants/paymentLinks');
const { localIsoDate } = require('./localDate');
const { ENGLISH_VERSION_MISSING } = require('./emailTemplateLanguage');
const { isDirectChannel } = require('./platformNameFormat');

const NOTICE_STABLE_KEY = 'dates_unavailable_notice';
const occurrenceKeyOf = (stayId) => `dates-taken:${Number(stayId)}`;

// Why a stay was not told, as the push and the card write it.
const NOT_SENT_LABELS = Object.freeze({
  'no-template': 'modèle désactivé',
  'no-email': 'pas d’adresse e-mail',
  [ENGLISH_VERSION_MISSING]: 'version anglaise manquante',
  EMAIL_NOT_CONFIGURED: 'SMTP non configuré',
  upgrade: 'lien retiré à la mise à jour',
  'not-allowed': 'envoi automatique non autorisé',
  'send-failed': 'échec de l’envoi',
});
const notSentLabel = (reason) => NOT_SENT_LABELS[reason] || NOT_SENT_LABELS['send-failed'];

const NOTICE_LABELS = Object.freeze({ sent: 'client prévenu', 'not-sent': 'client non prévenu', sending: 'envoi incertain' });
const UNCERTAIN_DETAIL = 'Envoi interrompu : vérifier l’historique des e-mails.';

const OPEN_DEVIS_STATUSES = new Set(['draft', 'sent', 'accepted']);

const ddmm = (iso) => {
  const [, m, d] = String(iso || '').slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : '';
};
const nameOf = (row) => [row && row.firstName, row && row.lastName].map((s) => String(s == null ? '' : s).trim()).filter(Boolean).join(' ');

function readStay(database, id) {
  return database.prepare(`
    SELECT r.id, r.kind, r.devisStatus, r.convertedReservationId, r.startDate, r.endDate, r.reservationNumber, r.platform,
           r.clientId, c.firstName, c.lastName, p.name AS propertyName
      FROM reservations r
      LEFT JOIN clients c ON c.id = r.clientId
      LEFT JOIN properties p ON p.id = r.propertyId
     WHERE r.id = ?
  `).get(Number(id));
}

// The `dates-taken` links that answer for a stay: its own, and those of the devis it came from.
function takenLinksOfStay(database, stayId) {
  return database.prepare(`
    SELECT l.id, l.status, l.providerLinkId, l.remoteCancelPendingAt, l.lastLookAt, l.unpaidReadAt, l.paidAt,
           l.providerPaymentId, l.takenByReservationId, l.noticeJudgedAt
      FROM payment_links l
     WHERE l.cancelReason = ?
       AND (l.reservationId = ? OR l.reservationId IN (SELECT id FROM reservations WHERE convertedReservationId = ?))
  `).all(LINK_REASONS.DATES_TAKEN, Number(stayId), Number(stayId));
}

const carriesPayment = (l) => l.status === 'paid' || Boolean(l.paidAt) || Boolean(l.providerPaymentId);
// Rule 64 — read unpaid AFTER its deactivation (a link the provider never held carries no payment).
const isReady = (l) => l.status === 'cancelled' && !l.noticeJudgedAt && !carriesPayment(l)
  && !l.remoteCancelPendingAt && !l.lastLookAt && (Boolean(l.unpaidReadAt) || !l.providerLinkId);
const isUnread = (l) => l.status === 'cancelled' && !l.noticeJudgedAt && !carriesPayment(l) && !isReady(l);

// The stay, or the devis converted into it, already has its row: told (or not) once, whatever its id now.
function alreadyClaimed(database, stayId) {
  return Boolean(database.prepare(`
    SELECT 1 FROM dates_taken_notices
     WHERE reservationId = ? OR reservationId IN (SELECT id FROM reservations WHERE convertedReservationId = ?) LIMIT 1
  `).get(Number(stayId), Number(stayId)));
}

// Rules 43, 64 — due, waiting, or closed for good (with why). `ready` are the links this judgement settles.
function judge(database, stayId, now) {
  const { answeringStay, heldOverlaps } = require('./datesTaken');
  const { carriesMoney } = require('./stayMoney');
  const links = takenLinksOfStay(database, stayId);
  const ready = links.filter(isReady);
  if (ready.length === 0) return { verdict: 'wait', reason: 'no-withdrawn-link', ready };
  // A withdrawn link still unread may yet be paid (rule 33): the whole stay waits for every read.
  if (links.some(isUnread)) return { verdict: 'wait', reason: 'unread', ready };
  const closed = (reason) => ({ verdict: 'closed', reason, ready });
  if (links.some(carriesPayment)) return closed('paid');
  const found = answeringStay(database, stayId);
  if (!found || Number(found.stay.id) !== Number(stayId)) return closed('not-a-stay');
  const stay = readStay(database, stayId);
  if (!stay || !['devis', 'reservation'].includes(String(stay.kind))) return closed('not-a-stay');
  if (stay.kind === 'devis' && (stay.convertedReservationId || !OPEN_DEVIS_STATUSES.has(String(stay.devisStatus || 'draft')))) return closed('devis-closed');
  if (String(stay.startDate).slice(0, 10) <= localIsoDate(now)) return closed('begun');
  // Review of #912 (M2) — a platform guest holds a booking at the platform: an overlap there is rule 39's over-booking.
  if (!isDirectChannel(stay.platform)) return closed('not-direct');
  if (alreadyClaimed(database, stayId)) return closed('already');
  if (carriesMoney(database, stayId)) return closed('paid-stay');
  const takers = new Set(ready.map((l) => Number(l.takenByReservationId)).filter((id) => id > 0));
  const holders = heldOverlaps(database, { ...found.stay, excludeIds: [found.row.id, found.stay.id] });
  if (holders.length === 0) return closed('dates-free');
  // Only the stay that took the nights at the withdrawal answers it: freed nights booked again by another stay do not.
  const holder = holders.find((h) => takers.has(Number(h.id)));
  if (!holder) return closed('taken-by-another');
  const takerClient = database.prepare('SELECT clientId FROM reservations WHERE id = ?').get(Number(holder.id));
  if (stay.clientId != null && takerClient && Number(takerClient.clientId) === Number(stay.clientId)) return closed('same-client');
  return { verdict: 'due', stay, takenById: Number(holder.id), ready };
}

function stampJudged(database, links, now) {
  const stamp = database.prepare('UPDATE payment_links SET noticeJudgedAt = ? WHERE id = ? AND noticeJudgedAt IS NULL');
  for (const link of links) stamp.run(now.toISOString(), Number(link.id));
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
  autoSendExceptions = AUTO_SEND_EXCEPTIONS,
} = {}) {
  const deps = () => ({
    templatesModel: templatesModel || require('../models/emailTemplatesModel'),
    logModel: logModel || require('../models/emailLogModel'),
    settingsModel: settingsModel || require('../models/settingsModel'),
    emailServiceFactory: emailServiceFactory || require('./emailService').createEmailService,
  });
  const pushOperators = push || ((payload) => require('./pushService').sendToPref('newReservation', payload));
  const inFlight = new Set();

  // Rule 44 — the exception is named in `autoSendPolicy`: without the key in that list, nothing leaves.
  async function sendNotice(stay) {
    if (!autoSendExceptions.includes(NOTICE_STABLE_KEY)) return { sent: false, reason: 'not-allowed' };
    const { sendReservationTemplateEmail } = require('./reservationEmailSender');
    const markSent = database.prepare("UPDATE dates_taken_notices SET noticeStatus = 'sent', noticeReason = NULL, emailLogId = ? WHERE reservationId = ? AND noticeStatus = 'sending'");
    try {
      return await sendReservationTemplateEmail({
        database, ...deps(), reservationId: stay.id, stableKey: NOTICE_STABLE_KEY, occurrenceKey: occurrenceKeyOf(stay.id),
        onAccepted: (row) => markSent.run(row && row.id != null ? Number(row.id) : null, stay.id),
      });
    } catch (err) {
      logger.warn(`[dates-taken] notice for stay ${stay.id} failed: ${(err && err.message) || err}`);
      return { sent: false, reason: 'send-failed' };
    }
  }

  async function notify(stayId, { now = new Date() } = {}) {
    const verdict = judge(database, stayId, now);
    if (verdict.verdict === 'wait') return { status: 'not-due', reason: verdict.reason };
    const claim = database.transaction(() => {
      if (verdict.verdict === 'closed') { stampJudged(database, verdict.ready, now); return verdict.reason === 'already' ? 'already' : 'closed'; }
      const inserted = database.prepare(`
        INSERT INTO dates_taken_notices (reservationId, takenByReservationId, noticeStatus, noticeReason, createdAt)
        VALUES (?, ?, 'sending', NULL, ?)
        ON CONFLICT(reservationId) DO NOTHING
      `).run(verdict.stay.id, verdict.takenById, now.toISOString());
      stampJudged(database, verdict.ready, now);
      return Number(inserted.changes) === 1 ? 'claimed' : 'already';
    })();
    if (claim === 'already') return { status: 'already' };
    if (claim === 'closed') {
      logger.log(`[dates-taken] stay ${stayId}: withdrawal closed without a guest notice (${verdict.reason})`);
      return { status: 'closed', reason: verdict.reason };
    }
    const { stay, takenById } = verdict;

    const outcome = await sendNotice(stay);
    let status = 'sent';
    let reason = null;
    if (outcome.accepted && !outcome.sent) {
      status = 'sending';
    } else if (!outcome.sent) {
      status = 'not-sent';
      reason = NOT_SENT_LABELS[outcome.reason] ? outcome.reason : 'send-failed';
      const logged = database.prepare('SELECT id FROM email_log WHERE reservationId = ? AND occurrenceKey = ? ORDER BY id DESC LIMIT 1')
        .get(stay.id, occurrenceKeyOf(stay.id));
      database.prepare("UPDATE dates_taken_notices SET noticeStatus = 'not-sent', noticeReason = ?, emailLogId = ? WHERE reservationId = ? AND noticeStatus = 'sending'")
        .run(reason, logged ? logged.id : null, stay.id);
    }
    logger.log(`[dates-taken] stay ${stay.id}: dates taken by stay ${takenById}, ${{ sent: 'guest notice sent', sending: 'guest notice uncertain', 'not-sent': `guest not told (${reason})` }[status]}`);

    const told = status === 'not-sent' ? `${NOTICE_LABELS['not-sent']} : ${notSentLabel(reason)}` : NOTICE_LABELS[status];
    try {
      await pushOperators({
        title: `Dates prises — ${nameOf(stay) || 'client'}`,
        body: `${[stay.propertyName, `${ddmm(stay.startDate)} → ${ddmm(stay.endDate)}`].filter(Boolean).join(', ')} : dates prises par ${takerLabel(database, takenById)}, ${told}.`,
        url: `/reservations/${stay.id}`,
      });
    } catch (err) {
      logger.warn(`[dates-taken] push for stay ${stay.id} failed: ${(err && err.message) || err}`);
    }
    return { status, ...(reason ? { reason } : {}) };
  }

  function track(promise) {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise)).catch(() => {});
    return promise;
  }

  function notifyDatesTaken(stayId, options) {
    return track(notify(stayId, options));
  }

  // The stays with a `dates-taken` link read unpaid after its deactivation and not judged yet.
  function candidates() {
    return database.prepare(`
      SELECT DISTINCT COALESCE(r.convertedReservationId, r.id) AS stayId
        FROM payment_links l
        JOIN reservations r ON r.id = l.reservationId
       WHERE l.status = 'cancelled' AND l.cancelReason = ? AND l.noticeJudgedAt IS NULL
         AND l.remoteCancelPendingAt IS NULL AND l.lastLookAt IS NULL AND l.paidAt IS NULL AND l.providerPaymentId IS NULL
         AND (l.unpaidReadAt IS NOT NULL OR COALESCE(l.providerLinkId, '') = '')
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

// Rule 66 — the card « Dates prises »: one row per stay still to look at (not « Vu », not over, still a devis or a
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
    const status = NOTICE_LABELS[row.noticeStatus] ? row.noticeStatus : 'not-sent';
    const taker = row.takenByReservationId ? readStay(database, row.takenByReservationId) : null;
    const detail = { sent: null, sending: UNCERTAIN_DETAIL, 'not-sent': `Raison : ${notSentLabel(row.noticeReason)}.` }[status];
    return {
      id: Number(row.id),
      reservationId: Number(row.reservationId),
      url: `/reservations/${Number(row.reservationId)}`,
      title: [nameOf(row) || 'Client', row.propertyName, `${ddmm(row.startDate)} → ${ddmm(row.endDate)}`].filter(Boolean).join(' · '),
      notice: { sent: status === 'sent', label: NOTICE_LABELS[status] },
      takenBy: taker
        ? { id: Number(taker.id), url: `/reservations/${Number(taker.id)}`, label: `Prises par ${takerLabel(database, taker.id)}${nameOf(taker) ? ` · ${nameOf(taker)}` : ''}` }
        : { id: null, url: null, label: 'Prises par une autre réservation' },
      detail,
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
