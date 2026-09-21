/**
 * Settings response shaping — pure helpers that turn a flat DB row into the
 * wrapped { company, quote, smtp, … } payload returned by the API.
 * The Google Calendar block moved to its own endpoint (GET /api/google-calendar/status)
 * with the OAuth rework — see specs/google-calendar-oauth-rework.md.
 */

const { resolveEmailIdentity } = require('./emailIdentity');

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

function shapeResponse(row) {
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
    vat: {
      rate: row.vatRate == null ? 10 : Number(row.vatRate),
    },
    // Accounting block (specs/fiscal-year-and-nights-sold.md §4.3). `fiscalYearEndMonth` is the month
    // the books are closed on; 12 (calendar year) when unset. Every annual window of the Suivi
    // financier is derived from it server-side.
    accounting: {
      fiscalYearEndMonth: row.fiscalYearEndMonth == null ? 12 : Number(row.fiscalYearEndMonth),
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
      },
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
      poolSeasonStart: row.poolSeasonStart || '06-15',
      poolSeasonEnd: row.poolSeasonEnd || '08-31',
    },
    // Weather alerts block (specs/checkin-weather-alerts.md). The key itself is never returned; the
    // row comes from settingsModel.read() which substitutes the encrypted blob with the boolean flag.
    weather: {
      apiKeySet: Boolean(row.meteoFranceApiKeySet),
    },
    // Laundry block — weekly bed-linen tracking (specs/weekly-bed-linen-tracking.md). Surfaced
    // to the client as `weekday: 0..6` (Date.getDay() convention) so the SettingsLaundrySection
    // Select can map values directly to the WEEKDAY_OPTIONS constant.
    laundry: {
      weekday: row.laundryWeekday == null ? 2 : Number(row.laundryWeekday),
    },
    // Linen stock block — inventory & shortage tracking
    // (specs/linen-inventory-shortage-tracking.md §3.1). All six values surfaced as integers,
    // with 0 = "type not tracked" (the LinenStockPage form binds these directly).
    linenStock: {
      bedSingle:   Number(row.bedLinenStockSingle || 0),
      bedDouble:   Number(row.bedLinenStockDouble || 0),
      bedBaby:     Number(row.bedLinenStockBaby   || 0),
      towelLarge:  Number(row.towelStockLarge     || 0),
      towelMedium: Number(row.towelStockMedium    || 0),
      towelSmall:  Number(row.towelStockSmall     || 0),
      towelBathMat: Number(row.towelStockBathMat  || 0),
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
