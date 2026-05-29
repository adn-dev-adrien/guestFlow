/**
 * Settings response shaping — pure helpers that turn a flat DB row into the
 * wrapped { company, quote, googleCalendar } payload returned by the API.
 */

const crypto = require('crypto');

const PRIVATE_KEY_MASK = '••••••••••';

const STATUS_LABELS = Object.freeze({
  ACTIVE: 'Synchronisation active',
  IN_PROGRESS: 'Configuration en cours',
  MISSING: 'Synchronisation non configurée',
});

function maskEmail(email) {
  if (!email) return '';
  const str = String(email);
  if (str.length <= 20) return str;
  const atIndex = str.indexOf('@');
  if (atIndex === -1) return str;
  const local = str.slice(0, atIndex);
  const domain = str.slice(atIndex + 1);
  const localPart = local.length > 8 ? `${local.slice(0, 5)}…` : local;
  const domainPart = domain.length > 16 ? `${domain.slice(0, 6)}…${domain.slice(-8)}` : domain;
  return `${localPart}@${domainPart}`;
}

function fingerprintPrivateKey(key) {
  if (!key) return null;
  return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 6);
}

function computeConfigured(row) {
  return Boolean(
    String(row.googleCalendarId || '').trim()
    && String(row.googleServiceAccountEmail || '').trim()
    && String(row.googleServiceAccountPrivateKey || '').trim()
  );
}

function computeStatusLabel(row) {
  const hasId = Boolean(String(row.googleCalendarId || '').trim());
  const hasEmail = Boolean(String(row.googleServiceAccountEmail || '').trim());
  const hasKey = Boolean(String(row.googleServiceAccountPrivateKey || '').trim());
  const count = [hasId, hasEmail, hasKey].filter(Boolean).length;
  if (count === 3) return STATUS_LABELS.ACTIVE;
  if (count === 0) return STATUS_LABELS.MISSING;
  return STATUS_LABELS.IN_PROGRESS;
}

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

  const serviceAccountEmail = safeStr(row.googleServiceAccountEmail).trim();
  const privateKey = safeStr(row.googleServiceAccountPrivateKey);

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
    },
    quote: {
      footerText: safeStr(row.quoteFooterText),
      validityDays: Number(row.quoteValidityDays) || 30,
    },
    vat: {
      accommodationRate: row.vatRateAccommodation == null ? 10 : Number(row.vatRateAccommodation),
      standardRate: row.vatRateStandard == null ? 20 : Number(row.vatRateStandard),
    },
    googleCalendar: {
      calendarId: safeStr(row.googleCalendarId).trim(),
      serviceAccountEmail,
      serviceAccountEmailMasked: maskEmail(serviceAccountEmail),
      privateKeyMasked: privateKey ? PRIVATE_KEY_MASK : '',
      privateKeyFingerprint: fingerprintPrivateKey(privateKey),
      configured: computeConfigured(row),
      statusLabel: computeStatusLabel(row),
    },
    updatedAt: row.updatedAt || null,
    updatedAtLabel: formatUpdatedAtLabel(row.updatedAt),
  };
}

module.exports = {
  shapeResponse,
  PRIVATE_KEY_MASK,
  STATUS_LABELS,
  __test: {
    maskEmail,
    fingerprintPrivateKey,
    computeConfigured,
    computeStatusLabel,
    formatUpdatedAtLabel,
  },
};
