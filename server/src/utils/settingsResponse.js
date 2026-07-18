/**
 * Settings response shaping — pure helpers that turn a flat DB row into the
 * wrapped { company, quote, smtp, … } payload returned by the API.
 * The Google Calendar block moved to its own endpoint (GET /api/google-calendar/status)
 * with the OAuth rework — see specs/google-calendar-oauth-rework.md.
 */

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
      validityDays: Number(row.quoteValidityDays) || 30,
    },
    vat: {
      rate: row.vatRate == null ? 10 : Number(row.vatRate),
      rateCommission: row.vatRateCommission == null ? 20 : Number(row.vatRateCommission),
    },
    // SMTP block for the account-management flow (specs/admin-account-management.md). The password
    // is masked: the row already comes from settingsModel.read() which substitutes
    // smtpPasswordEncrypted with the boolean smtpPasswordSet. We never echo cleartext or ciphertext.
    smtp: {
      host: safeStr(row.smtpHost).trim(),
      port: row.smtpPort == null ? 587 : Number(row.smtpPort),
      secure: Number(row.smtpSecure) === 1,
      username: safeStr(row.smtpUsername).trim(),
      passwordSet: Boolean(row.smtpPasswordSet),
      fromEmail: safeStr(row.smtpFromEmail).trim(),
      fromName: safeStr(row.smtpFromName).trim() || 'GuestFlow',
      publicUrl: safeStr(row.publicUrl).trim(),
    },
    // Booking notifications block (specs/site-booking-notifications.md §4.3). `enabled` defaults ON
    // (only an explicit 0 turns it off). `recipientEmail` empty → the service falls back to the SMTP
    // sender. The email link reuses `smtp.publicUrl`.
    notifications: {
      enabled: Number(row.notificationsEnabled) !== 0,
      // Per-channel switch for the iCal/platform new-reservation email; default ON.
      icalReservationEnabled: Number(row.notifyIcalReservationEnabled) !== 0,
      recipientEmail: safeStr(row.notificationRecipientEmail).trim(),
    },
    // Reservations block — admin escape hatch for past-reservation editing.
    // See specs/admin-unlock-past-reservations.md.
    reservations: {
      allowEditPastReservations: Number(row.allowEditPastReservations) === 1,
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
