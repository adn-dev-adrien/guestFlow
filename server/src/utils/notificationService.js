/**
 * Booking-notification service (specs/site-booking-notifications.md §3 + §4.1).
 *
 * Sends a best-effort email when:
 *   - a new site-origin devis is created  → notifyNewSiteDevis(devisId)
 *   - a new iCal reservation is imported   → notifyNewIcalReservation(reservationId)
 *
 * Contract:
 *   - FROM the SMTP sender (smtpFromEmail); TO `notificationRecipientEmail` (empty → fall back to
 *     the sender). Gated by the `notificationsEnabled` master switch (default ON).
 *   - Best-effort: every failure (toggle off, SMTP not configured, send error, missing row) is
 *     swallowed and logged — it must NEVER break the booking-request response or the iCal sync.
 *   - The email link reuses the existing `publicUrl` setting; empty → no link.
 *
 * Pure-ish + injectable (db / settingsModel / email factory / logger) for unit tests.
 */

const realDb = require('../database');
const realSettingsModel = require('../models/settingsModel');
const { createEmailService } = require('./emailService');
const realPushService = require('./pushService');
const { buildNotificationDigest } = require('./notificationDigest');

// specs/public-request-abuse-and-grouping.md rule 9 — website requests are mailed one at a time only
// for the first of a 15-minute window; the following ones wait for one summary.
const SITE_DEVIS_DIGEST = 'site-devis';

function euro(n) {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')} €`;
}

// ISO (YYYY-MM-DD) → DD/MM/YYYY for human-facing notification copy; pass through anything else.
function frDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

// Whole nights between two ISO dates (UTC midnight diff); 0 when either is missing/invalid.
function nightsBetween(startDate, endDate) {
  const ms = new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.round(ms / 86400000));
}

function nightsLabel(n) {
  return `${n} nuit${n > 1 ? 's' : ''}`;
}

function joinUrl(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  return `${b}${path}`;
}

function buildNotificationService({
  db = realDb,
  settingsModel = realSettingsModel,
  emailServiceFactory = createEmailService,
  pushService = realPushService,
  logger = console,
  digest = null,
} = {}) {
  // Built lazily: a suite that injects a minimal database without the digest tables never reaches it.
  let digestStore = digest;
  // The summaries already pushed (by their first row id), so a retried e-mail never pushes again.
  const pushed = new Set();
  const siteDigest = () => {
    if (!digestStore) digestStore = buildNotificationDigest({ db });
    return digestStore;
  };
  // Fire a Web Push for a new booking, independently of the email settings (it's gated by the
  // per-user push preferences, not by SMTP/recipient). Fully isolated — never throws.
  async function pushNewReservation(payload) {
    try { await pushService.sendToPref('newReservation', payload); }
    catch (err) { logger.warn('[notificationService.push]', err && err.message ? err.message : err); }
  }
  // Resolve the common send context, or a reason to skip. Never throws.
  function resolveContext() {
    const notif = settingsModel.notificationSettings();
    if (!notif.enabled) return { skip: 'disabled' };
    if (!settingsModel.smtpConfigured()) return { skip: 'smtp_not_configured' };
    const recipient = notif.recipientEmail || notif.fromEmail;
    if (!recipient) return { skip: 'no_recipient' };
    return { recipient, publicUrl: notif.publicUrl };
  }

  async function deliver({ recipient, subject, text }) {
    const svc = emailServiceFactory(settingsModel.decryptedSmtpSettings());
    if (!svc.isConfigured) return { sent: false, skipped: 'smtp_not_configured' };
    await svc.send({ to: recipient, subject, text });
    return { sent: true };
  }

  function loadDevis(devisId) {
    const row = db.prepare(`
      SELECT r.*, c.firstName, c.lastName, c.email AS clientEmail, c.phone AS clientPhone,
             p.name AS propertyName
        FROM reservations r
        LEFT JOIN clients c    ON c.id = r.clientId
        LEFT JOIN properties p ON p.id = r.propertyId
       WHERE r.id = ? AND r.kind = 'devis'
    `).get(Number(devisId));
    if (!row) return null;
    row.options = db.prepare(`
      SELECT o.title, o.showsPlanningCard, ro.quantity, ro.totalPrice, ro.offered
        FROM reservation_options ro
        LEFT JOIN options o ON o.id = ro.optionId
       WHERE ro.reservationId = ?
    `).all(Number(devisId));
    row.resources = db.prepare(`
      SELECT r.name, rr.quantity, rr.totalPrice, rr.offered
        FROM reservation_resources rr
        LEFT JOIN resources r ON r.id = rr.resourceId
       WHERE rr.reservationId = ?
    `).all(Number(devisId));
    return row;
  }

  function lineLabel(name, totalPrice, offered) {
    const label = String(name || 'Élément');
    return `  - ${label} : ${Number(offered) === 1 ? 'offert (0 €)' : euro(totalPrice)}`;
  }

  function buildDevisEmail(devis, publicUrl, { updated = false, messageDropped = false } = {}) {
    const client = `${String(devis.firstName || '').trim()} ${String(devis.lastName || '').trim()}`.trim();
    const ref = devis.devisNumber ? ` #${devis.devisNumber}` : '';
    const subject = `${updated ? 'Demande de devis mise à jour' : 'Nouvelle demande de devis'}${ref} — ${devis.propertyName || ''}`.trim();

    const lines = [
      updated
        ? 'Le client a renvoyé sa demande depuis le site : le devis a été mis à jour.'
        : 'Nouvelle demande de devis reçue depuis le site.',
      // specs/public-request-abuse-and-grouping.md rule 22.
      ...(messageDropped ? ['Son message n’a pas été ajouté : 10 messages déjà ajoutés à ce devis.'] : []),
      '',
      `Logement : ${devis.propertyName || ''}`,
      `Client : ${client || '—'}`,
      `Email : ${devis.clientEmail || '—'}`,
      `Téléphone : ${devis.clientPhone || '—'}`,
      `Séjour : du ${frDate(devis.startDate)} au ${frDate(devis.endDate)}`,
      `Voyageurs : ${Number(devis.adults || 0)} adulte(s), ${Number(devis.teens || 0)} ado(s), ${Number(devis.children || 0)} enfant(s), ${Number(devis.babies || 0)} bébé(s)`,
    ];
    if (devis.options && devis.options.length) {
      lines.push('', 'Options :');
      for (const o of devis.options) lines.push(lineLabel(o.title, o.totalPrice, o.offered));
    }
    // Planning-card options booked from the site have no scheduled slot — the operator must contact the
    // guest to arrange the time (specs/public-planning-options.md §3 rule 5).
    const toSchedule = (devis.options || []).filter((o) => o.showsPlanningCard);
    if (toSchedule.length) {
      lines.push('', 'À planifier avec le client (horaire à convenir) :');
      for (const o of toSchedule) lines.push(`- ${o.title} ×${Number(o.quantity || 1)}`);
    }
    if (devis.resources && devis.resources.length) {
      lines.push('', 'Ressources :');
      for (const r of devis.resources) lines.push(lineLabel(r.name, r.totalPrice, r.offered));
    }
    lines.push('', `Montant du séjour : ${euro(devis.finalPrice)}`);
    if (Number(devis.touristTaxTotal || 0) > 0) lines.push(`Taxe de séjour : ${euro(devis.touristTaxTotal)}`);

    const link = joinUrl(publicUrl, `/reservations/new?mode=devis&devisId=${Number(devis.id)}`);
    if (link) lines.push('', `Ouvrir le devis : ${link}`);

    return { subject, text: lines.join('\n') };
  }

  function loadReservation(reservationId) {
    return db.prepare(`
      SELECT r.*, c.firstName, c.lastName, p.name AS propertyName, s.name AS sourceName
        FROM reservations r
        LEFT JOIN clients c       ON c.id = r.clientId
        LEFT JOIN properties p    ON p.id = r.propertyId
        LEFT JOIN ical_sources s  ON s.id = r.sourceIcalSourceId
       WHERE r.id = ?
    `).get(Number(reservationId));
  }

  function buildReservationEmail(resa, publicUrl) {
    const guest = String(resa.icalOriginalSummary || '').trim()
      || `${String(resa.firstName || '').trim()} ${String(resa.lastName || '').trim()}`.trim();
    const platform = String(resa.sourceName || '').trim() || String(resa.platform || resa.sourcePlatformKey || '').trim();
    const subject = `Nouvelle réservation ${platform} — ${resa.propertyName || ''}`.trim();
    const nights = nightsBetween(resa.startDate, resa.endDate);
    const lines = [
      'Nouvelle réservation importée via iCal.',
      '',
      `Plateforme : ${platform || '—'}`,
      `Logement : ${resa.propertyName || ''}`,
      `Client : ${guest || '—'}`,
      `Séjour : du ${resa.startDate} au ${resa.endDate}${nights ? ` (${nightsLabel(nights)})` : ''}`,
    ];
    const link = joinUrl(publicUrl, `/reservations/${Number(resa.id)}`);
    if (link) lines.push('', `Ouvrir la réservation : ${link}`);
    return { subject, text: lines.join('\n') };
  }

  /**
   * A website request, new or updated in place (`{ updated: true }`, rule 16). The first of a 15-minute
   * window is pushed and mailed at once; the following ones are kept for one summary at the end of the
   * window (rule 9), sent by `flushDueDigests`. Never refuses anything, never throws.
   */
  async function notifyNewSiteDevis(devisId, { updated = false, messageDropped = false } = {}) {
    try {
      const devis = loadDevis(devisId);
      if (!devis) return { sent: false, skipped: 'not_found' };
      await flushDueDigests();
      // The grouping is best effort too: a store it cannot read mails this request on its own.
      let admission = { immediate: true };
      try {
        admission = siteDigest().admit({ key: SITE_DEVIS_DIGEST, refId: devis.id, kind: updated ? (messageDropped ? 'updated-capped' : 'updated') : 'new' });
      } catch (err) {
        logger.warn('[notificationService.digest]', err && err.message ? err.message : err);
      }
      if (!admission.immediate) return { sent: false, queued: true };
      // Push (independent of email settings).
      const client = `${String(devis.firstName || '').trim()} ${String(devis.lastName || '').trim()}`.trim();
      const clientProperty = [client, devis.propertyName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
      await pushNewReservation({
        title: updated ? 'Demande de devis mise à jour' : 'Nouvelle demande de devis',
        body: clientProperty,
        url: `/reservations/new?mode=devis&devisId=${Number(devis.id)}`,
      });
      // Email (its own gating).
      const ctx = resolveContext();
      if (ctx.skip) return { sent: false, skipped: ctx.skip };
      const { subject, text } = buildDevisEmail(devis, ctx.publicUrl, { updated, messageDropped });
      return await deliver({ recipient: ctx.recipient, subject, text });
    } catch (err) {
      logger.warn('[notificationService.notifyNewSiteDevis]', err && err.message ? err.message : err);
      return { sent: false, skipped: 'error' };
    }
  }

  /**
   * One line per quote, not per request (fixed at the 2026-10-27 spec review: one stay sent 13 times
   * read as 13 lines). A quote counts as new when one of its requests created it in the window, as
   * updated otherwise; its line says how many requests it gathered.
   */
  function groupDigestItems(items) {
    const groups = [];
    const byRef = new Map();
    items.forEach((item) => {
      const key = item.refId ? Number(item.refId) : null;
      let group = key !== null ? byRef.get(key) : null;
      if (!group) {
        group = { refId: item.refId, created: false, updates: 0, capped: false };
        groups.push(group);
        if (key !== null) byRef.set(key, group);
      }
      if (String(item.kind).startsWith('updated')) group.updates += 1;
      else group.created = true;
      if (item.kind === 'updated-capped') group.capped = true;
    });
    return groups;
  }

  function digestTag(group) {
    const updates = `${group.updates} mise${group.updates > 1 ? 's' : ''} à jour`;
    let tag;
    if (group.created) tag = group.updates ? `nouvelle, puis ${updates}` : 'nouvelle';
    else tag = group.updates > 1 ? updates : 'mise à jour';
    return group.capped ? `${tag}, message non ajouté : limite atteinte` : tag;
  }

  function buildSiteDigestEmail(items, publicUrl) {
    const groups = groupDigestItems(items);
    const fresh = groups.filter((g) => g.created).length;
    const updatedCount = groups.length - fresh;
    const parts = [];
    if (fresh) parts.push(`${fresh} nouvelle${fresh > 1 ? 's' : ''} demande${fresh > 1 ? 's' : ''} du site`);
    if (updatedCount) parts.push(`${updatedCount} demande${updatedCount > 1 ? 's' : ''} mise${updatedCount > 1 ? 's' : ''} à jour`);
    const subject = parts.join(', ');
    const lines = [`${subject.charAt(0).toUpperCase()}${subject.slice(1)} depuis le dernier e-mail.`, ''];
    groups.forEach((group) => {
      const devis = group.refId ? loadDevis(group.refId) : null;
      const tag = digestTag(group);
      if (!devis) { lines.push(`- (${tag}) demande supprimée depuis`); return; }
      const client = `${String(devis.firstName || '').trim()} ${String(devis.lastName || '').trim()}`.trim() || '—';
      const ref = devis.devisNumber ? `#${devis.devisNumber} ` : '';
      lines.push(`- ${ref}(${tag}) ${client} — ${devis.propertyName || ''}, du ${frDate(devis.startDate)} au ${frDate(devis.endDate)}, ${euro(devis.finalPrice)}`);
    });
    const link = joinUrl(publicUrl, '/devis');
    if (link) lines.push('', `Voir les devis : ${link}`);
    return { subject: `${subject.charAt(0).toUpperCase()}${subject.slice(1)}`, text: lines.join('\n') };
  }

  /**
   * The summaries whose 15-minute window has ended (rule 9): one push and one e-mail each. Called by
   * the scheduler every minute and before every new notification. Best effort, never throws.
   */
  async function flushDueDigests() {
    let due = [];
    try { due = siteDigest().takeDue(); } catch (err) {
      logger.warn('[notificationService.flushDueDigests]', err && err.message ? err.message : err);
      return { sent: 0 };
    }
    let sent = 0;
    for (const { key, items, ids } of due) {
      if (key !== SITE_DEVIS_DIGEST) continue;
      // The rows go once the summary left — or when nothing could ever send it (notifications off, no
      // SMTP): a failed send keeps them for the next flush, a sent one is never sent twice.
      try {
        const ctx = resolveContext();
        const email = buildSiteDigestEmail(items, ctx.publicUrl || '');
        // The push has its own gating, as on the immediate path: an operator who reads pushes only
        // still gets the summary. Sent once, before the e-mail, which alone may be retried.
        if (!pushed.has(ids[0])) {
          if (pushed.size > 1000) pushed.clear();
          pushed.add(ids[0]);
          await pushNewReservation({ title: email.subject, body: 'Demandes de devis du site', url: '/devis' });
        }
        if (ctx.skip) { siteDigest().settle(ids, true); continue; }
        const result = await deliver({ recipient: ctx.recipient, subject: email.subject, text: email.text });
        siteDigest().settle(ids, true);
        if (result.sent) sent += 1;
      } catch (err) {
        try { siteDigest().settle(ids, false); } catch { /* the stale mark frees them later */ }
        logger.warn('[notificationService.flushDueDigests]', err && err.message ? err.message : err);
      }
    }
    return { sent };
  }

  async function notifyNewIcalReservation(reservationId) {
    try {
      const resa = loadReservation(reservationId);
      if (!resa) return { sent: false, skipped: 'not_found' };
      // Push (independent of the email settings + the iCal email channel toggle). Body shows the
      // guest + property + start date (specs/pwa-push-notifications.md §3.3 rule 11).
      const platform = String(resa.sourceName || '').trim() || String(resa.platform || resa.sourcePlatformKey || '').trim();
      const guest = String(resa.icalOriginalSummary || '').trim()
        || `${String(resa.firstName || '').trim()} ${String(resa.lastName || '').trim()}`.trim();
      const guestProperty = [guest, resa.propertyName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
      // Body shows the guest + property + the stay dates + the number of nights (request 2026-06-25).
      const nights = nightsBetween(resa.startDate, resa.endDate);
      const stay = resa.startDate
        ? ` — du ${frDate(resa.startDate)} au ${frDate(resa.endDate)}${nights ? ` · ${nightsLabel(nights)}` : ''}`
        : '';
      await pushNewReservation({
        title: `Nouvelle réservation${platform ? ` ${platform}` : ''}`,
        body: `${guestProperty}${stay}`.trim(),
        url: `/reservations/${Number(resa.id)}`,
      });
      // Email — per-channel switch (spec site-booking-notifications §3 rule 9b) + master gating.
      if (!settingsModel.notificationSettings().icalReservationEnabled) {
        return { sent: false, skipped: 'ical_disabled' };
      }
      const ctx = resolveContext();
      if (ctx.skip) return { sent: false, skipped: ctx.skip };
      const { subject, text } = buildReservationEmail(resa, ctx.publicUrl);
      return await deliver({ recipient: ctx.recipient, subject, text });
    } catch (err) {
      logger.warn('[notificationService.notifyNewIcalReservation]', err && err.message ? err.message : err);
      return { sent: false, skipped: 'error' };
    }
  }

  // `origin` — 'payment' (a paid online booking landed on taken dates) or 'ical' (a feed event overlaps
  // nights already held, specs/lodgify-decommission.md §3 rule 8, every feed since
  // specs/ical-import-hardening.md rule 3).
  const CONFLICT_COPY = {
    payment: {
      title: 'Conflit de dates — paiement en ligne',
      lines: [
        'Un paiement en ligne a été réglé pour un séjour dont les dates ne sont plus disponibles.',
        'La réservation a été créée (le client a payé) mais ses dates chevauchent une autre réservation.',
        'Action requise : remboursement ou relogement.',
      ],
    },
    // specs/ical-import-hardening.md rule 3 — any feed, not only Booking's: the platform is named.
    ical: (resa) => {
      const platform = String(resa.platform || resa.sourceName || '').trim() || 'iCal';
      return {
        title: `Conflit de dates — flux ${platform}`,
        lines: [
          `Le flux iCal ${platform} annonce un séjour qui chevauche des nuits déjà prises dans GuestFlow.`,
          'La réservation a été créée pour ne rien perdre : ce peut être deux séjours accolés ou un surbooking.',
          `Action requise : vérifier sur ${platform}, puis supprimer le doublon ou reloger.`,
        ],
      };
    },
  };
  const conflictCopy = (resa, origin) => {
    const copy = CONFLICT_COPY[origin] || CONFLICT_COPY.payment;
    return typeof copy === 'function' ? copy(resa) : copy;
  };

  function buildConflictEmail(resa, publicUrl, origin = 'payment') {
    const copy = conflictCopy(resa, origin);
    const guest = `${String(resa.firstName || '').trim()} ${String(resa.lastName || '').trim()}`.trim();
    const subject = `⚠️ ${copy.title} (${resa.propertyName || ''})`;
    const lines = [
      ...copy.lines,
      '',
      `Logement : ${resa.propertyName || ''}`,
      `Client : ${guest || '—'}`,
      `Séjour : du ${resa.startDate} au ${resa.endDate}`,
    ];
    const link = joinUrl(publicUrl, `/reservations/${Number(resa.id)}`);
    if (link) lines.push('', `Ouvrir la réservation : ${link}`);
    return { subject, text: lines.join('\n') };
  }

  // Admin alert when a paid online full-payment was converted onto now-unavailable dates
  // (specs/public-online-payment.md §3 rule 5). Best-effort: never throws.
  async function notifyBookingConflict(reservationId, { origin = 'payment' } = {}) {
    try {
      const resa = loadReservation(reservationId);
      if (!resa) return { sent: false, skipped: 'not_found' };
      await pushNewReservation({
        title: `⚠️ ${conflictCopy(resa, origin).title}`,
        body: [`${String(resa.firstName || '').trim()} ${String(resa.lastName || '').trim()}`.trim(), resa.propertyName].map((s) => String(s || '').trim()).filter(Boolean).join(' · '),
        url: `/reservations/${Number(resa.id)}`,
      });
      const ctx = resolveContext();
      if (ctx.skip) return { sent: false, skipped: ctx.skip };
      const { subject, text } = buildConflictEmail(resa, ctx.publicUrl, origin);
      return await deliver({ recipient: ctx.recipient, subject, text });
    } catch (err) {
      logger.warn('[notificationService.notifyBookingConflict]', err && err.message ? err.message : err);
      return { sent: false, skipped: 'error' };
    }
  }

  // specs/plugins-phase-3a-online-payment.md rule 8 — a link GuestFlow had abandoned (stay cancelled,
  // amount replaced) but could not deactivate was paid anyway. Nothing is recorded on the stay: the
  // admin refunds from the provider. Best-effort: never throws.
  // Rule 23 — `settledOn`: the link was retired because its amount was already settled another way on
  // that earlier day; the payment may be a second one, or the same money recorded by hand: to check.
  const PAID_AFTER_CANCEL_TITLE = '⚠️ Paiement reçu sur un lien annulé';
  const PAID_AFTER_SETTLED_TITLE = '⚠️ Paiement à vérifier sur un lien retiré';
  function buildPaidAfterCancelEmail(resa, link, publicUrl, { settledOn = null } = {}) {
    const amount = (Number(link.amountCents || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    const ref = resa.devisNumber || `#${Number(resa.id)}`;
    const subject = `${settledOn ? PAID_AFTER_SETTLED_TITLE : PAID_AFTER_CANCEL_TITLE} — ${ref} · ${amount}`;
    const intro = settledOn
      ? [
        `Un lien de paiement a été payé alors que ce montant était déjà noté réglé le ${settledOn.split('-').reverse().join('/')}.`,
        'Le paiement n’est pas enregistré une seconde fois sur le séjour.',
        'À vérifier : s’il s’agit d’un double paiement, le rembourser depuis l’espace du prestataire de paiement.',
      ]
      : [
        'Un client a payé un lien de paiement que GuestFlow avait annulé mais n’avait pas pu désactiver.',
        'Le paiement n’est pas enregistré sur le séjour.',
        'Action requise : rembourser ce paiement depuis votre espace du prestataire de paiement.',
      ];
    const lines = [
      ...intro,
      '',
      `Réservation : ${ref}`,
      `Montant : ${amount}`,
      `Logement : ${resa.propertyName || ''}`,
      `Séjour : du ${resa.startDate} au ${resa.endDate}`,
    ];
    const url = joinUrl(publicUrl, `/reservations/${Number(resa.id)}`);
    if (url) lines.push('', `Ouvrir la réservation : ${url}`);
    return { subject, text: lines.join('\n') };
  }

  async function notifyPaidAfterCancel(link, options = {}) {
    try {
      const resa = loadReservation(link.reservationId);
      if (!resa) return { sent: false, skipped: 'not_found' };
      const title = options.settledOn ? PAID_AFTER_SETTLED_TITLE : PAID_AFTER_CANCEL_TITLE;
      const { subject } = buildPaidAfterCancelEmail(resa, link, '', options);
      await pushNewReservation({ title, body: subject.slice(`${title} — `.length), url: `/reservations/${Number(resa.id)}` });
      const ctx = resolveContext();
      if (ctx.skip) return { sent: false, skipped: ctx.skip };
      const email = buildPaidAfterCancelEmail(resa, link, ctx.publicUrl, options);
      return await deliver({ recipient: ctx.recipient, subject: email.subject, text: email.text });
    } catch (err) {
      logger.warn('[notificationService.notifyPaidAfterCancel]', err && err.message ? err.message : err);
      return { sent: false, skipped: 'error' };
    }
  }

  return { notifyNewSiteDevis, flushDueDigests, notifyNewIcalReservation, notifyBookingConflict, notifyPaidAfterCancel, __test: { buildDevisEmail, buildSiteDigestEmail, buildReservationEmail, buildConflictEmail, buildPaidAfterCancelEmail } };
}

const defaultService = buildNotificationService();
defaultService.buildNotificationService = buildNotificationService;

module.exports = defaultService;
