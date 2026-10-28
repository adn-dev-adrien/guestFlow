/**
 * Settings response shaping — pure helpers that turn a flat DB row into the
 * wrapped { company, quote, smtp, … } payload returned by the API.
 * The Google Calendar block moved to its own endpoint (GET /api/google-calendar/status)
 * with the OAuth rework — see specs/google-calendar-oauth-rework.md.
 */

const { resolveEmailIdentity } = require('./emailIdentity');
const { readRevenueGoals } = require('./revenueGoals');
const platformMail = require('./platformMail');

function formatUpdatedAtLabel(updatedAt) {
  if (!updatedAt) return null;
  // SQLite "datetime('now')" returns "YYYY-MM-DD HH:MM:SS" in UTC.
  const date = new Date(`${String(updatedAt).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return null;
  const dateFmt = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Europe/Paris',
  });
  const timeFmt = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
  return `${dateFmt.format(date)} à ${timeFmt.format(date)}`;
}

/**
 * @param {object} row  settingsModel.read()
 * @param {object} env
 * @param {{ regime, rate, legalMention }} [vat]  the regime in force (vatRegimeModel.inForceBlock); absent →
 *   the settings row's own rate, as a schema without periods holds it
 */
function shapeResponse(row, env = process.env, vat = null) {
  const identity = resolveEmailIdentity(row);
  const safeStr = (v) => String(v == null ? '' : v);

  return {
    company: {
      name: safeStr(row.companyName).trim(),
      address: safeStr(row.companyAddress),
      email: safeStr(row.companyEmail).trim(),
      phone: safeStr(row.companyPhone).trim(),
      siret: safeStr(row.companySiret).trim(),
      tva: safeStr(row.companyTva).trim(),
      iban: safeStr(row.companyIban).trim(),
      bic: safeStr(row.companyBic).trim(),
      bankName: safeStr(row.companyBankName).trim(),
      logoPath: safeStr(row.companyLogoPath),
      // Domain gate/access code shown on the arrival SAS (specs/arrival-departure-sas.md §3.5).
      // Must round-trip through GET /settings so the field is populated on page load, not just
      // writable — otherwise the client always shows it empty.
      portalCode: safeStr(row.portalCode).trim(),
    },
    quote: {
      footerText: safeStr(row.quoteFooterText),
      footerTextEn: safeStr(row.quoteFooterTextEn),
      validityDays: Number(row.quoteValidityDays) || 30,
    },
    vat: vat || { regime: 'subject', rate: row.vatRate == null ? 10 : Number(row.vatRate), legalMention: null },
    // Accounting block (specs/fiscal-year-and-nights-sold.md §4.3). `fiscalYearEndMonth` is the month
    // the books are closed on; 12 (calendar year) when unset. Every annual window of the Suivi
    // financier is derived from it server-side.
    accounting: {
      fiscalYearEndMonth: row.fiscalYearEndMonth == null ? 12 : Number(row.fiscalYearEndMonth),
      // specs/finance-dashboard-redesign.md §3.8 — `{ "<exercise key>": amount }`, {} when none.
      revenueGoals: readRevenueGoals(row.revenueGoals),
    },
    // SMTP block. The password is masked: the row comes from settingsModel.read(), which
    // substitutes smtpPasswordEncrypted with the boolean smtpPasswordSet. `fromEmail`, `username` and
    // `fromName` are the operator's OVERRIDES ('' = derived); `derived` is what each one falls back to
    // when left empty (specs/settings-rationalization.md rule 12) — the form shows it as « = … ».
    // No port: it follows `secure` (rule 11).
    smtp: {
      host: safeStr(row.smtpHost).trim(),
      secure: Number(row.smtpSecure) === 1,
      username: safeStr(row.smtpUsername).trim(),
      passwordSet: Boolean(row.smtpPasswordSet),
      fromEmail: safeStr(row.smtpFromEmail).trim(),
      fromName: safeStr(row.smtpFromName).trim(),
      publicUrl: safeStr(row.publicUrl).trim(),
      derived: {
        fromEmail: safeStr(row.companyEmail).trim(),
        username: identity.fromEmail,
        fromName: resolveEmailIdentity({ companyName: row.companyName }).fromName,
        // specs/hosting-h1-fleet-runtime.md rule 25 — the address the hosting gives the instance.
        publicUrl: safeStr(env.GUESTFLOW_PUBLIC_URL).trim(),
      },
      // specs/hosting-h1-fleet-runtime.md rule 19 — a hosted instance offers the platform's sender.
      // `active` while no host of its own is saved; `replyTo` is where the guests' answers go.
      platform: platformMail.available(env) ? {
        available: true,
        active: !safeStr(row.smtpHost).trim(),
        replyTo: identity.fromEmail,
      } : { available: false, active: false, replyTo: '' },
    },
    // Booking notifications block (specs/site-booking-notifications.md §4.3). `enabled` defaults ON
    // (only an explicit 0 turns it off). `recipientEmail` is the override; `derivedRecipient` is where
    // the emails go when it is left empty — the sending address.
    notifications: {
      enabled: Number(row.notificationsEnabled) !== 0,
      // Per-channel switch for the iCal/platform new-reservation email; default ON.
      icalReservationEnabled: Number(row.notifyIcalReservationEnabled) !== 0,
      recipientEmail: safeStr(row.notificationRecipientEmail).trim(),
      derivedRecipient: identity.fromEmail,
    },
    // Guest-email content (specs/guest-email-sequence.md §6.2). Automatic sending is decided per
    // template since specs/settings-rationalization.md rule 17b — there is no master switch here.
    emails: {
      // Read-only: set by the server when a sequence template first goes « auto ».
      sequenceStartDate: row.guestSequenceStartDate || null,
      googleReviewUrl: row.googleReviewUrl || '',
      instagramUrl: row.instagramUrl || '',
    },
    updatedAt: row.updatedAt || null,
    updatedAtLabel: formatUpdatedAtLabel(row.updatedAt),
  };
}

module.exports = {
  shapeResponse,
  __test: {
    formatUpdatedAtLabel,
  },
};
