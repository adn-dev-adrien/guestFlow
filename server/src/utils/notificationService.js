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

function euro(n) {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')} €`;
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
  logger = console,
} = {}) {
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
      SELECT o.title, ro.quantity, ro.totalPrice, ro.offered
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

  function buildDevisEmail(devis, publicUrl) {
    const client = `${String(devis.firstName || '').trim()} ${String(devis.lastName || '').trim()}`.trim();
    const ref = devis.devisNumber ? ` #${devis.devisNumber}` : '';
    const subject = `Nouvelle demande de devis${ref} — ${devis.propertyName || ''}`.trim();

    const lines = [
      'Nouvelle demande de devis reçue depuis le site.',
      '',
      `Logement : ${devis.propertyName || ''}`,
      `Client : ${client || '—'}`,
      `Email : ${devis.clientEmail || '—'}`,
      `Téléphone : ${devis.clientPhone || '—'}`,
      `Séjour : du ${devis.startDate} au ${devis.endDate}`,
      `Voyageurs : ${Number(devis.adults || 0)} adulte(s), ${Number(devis.teens || 0)} ado(s), ${Number(devis.children || 0)} enfant(s), ${Number(devis.babies || 0)} bébé(s)`,
    ];
    if (devis.options && devis.options.length) {
      lines.push('', 'Options :');
      for (const o of devis.options) lines.push(lineLabel(o.title, o.totalPrice, o.offered));
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
    const lines = [
      'Nouvelle réservation importée via iCal.',
      '',
      `Plateforme : ${platform || '—'}`,
      `Logement : ${resa.propertyName || ''}`,
      `Client : ${guest || '—'}`,
      `Séjour : du ${resa.startDate} au ${resa.endDate}`,
    ];
    const link = joinUrl(publicUrl, `/reservations/${Number(resa.id)}`);
    if (link) lines.push('', `Ouvrir la réservation : ${link}`);
    return { subject, text: lines.join('\n') };
  }

  async function notifyNewSiteDevis(devisId) {
    try {
      const ctx = resolveContext();
      if (ctx.skip) return { sent: false, skipped: ctx.skip };
      const devis = loadDevis(devisId);
      if (!devis) return { sent: false, skipped: 'not_found' };
      const { subject, text } = buildDevisEmail(devis, ctx.publicUrl);
      return await deliver({ recipient: ctx.recipient, subject, text });
    } catch (err) {
      logger.warn('[notificationService.notifyNewSiteDevis]', err && err.message ? err.message : err);
      return { sent: false, skipped: 'error' };
    }
  }

  async function notifyNewIcalReservation(reservationId) {
    try {
      // Per-channel switch (spec §3 rule 9b): when off, the platform new-reservation email is
      // suppressed even though the master toggle stays on. Checked first so a disabled channel
      // doesn't even read the reservation row.
      if (!settingsModel.notificationSettings().icalReservationEnabled) {
        return { sent: false, skipped: 'ical_disabled' };
      }
      const ctx = resolveContext();
      if (ctx.skip) return { sent: false, skipped: ctx.skip };
      const resa = loadReservation(reservationId);
      if (!resa) return { sent: false, skipped: 'not_found' };
      const { subject, text } = buildReservationEmail(resa, ctx.publicUrl);
      return await deliver({ recipient: ctx.recipient, subject, text });
    } catch (err) {
      logger.warn('[notificationService.notifyNewIcalReservation]', err && err.message ? err.message : err);
      return { sent: false, skipped: 'error' };
    }
  }

  return { notifyNewSiteDevis, notifyNewIcalReservation, __test: { buildDevisEmail, buildReservationEmail } };
}

const defaultService = buildNotificationService();
defaultService.buildNotificationService = buildNotificationService;

module.exports = defaultService;
