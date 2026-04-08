function isValidEmail(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isValidPhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;

  const normalized = trimmed.replace(/[\s().-]/g, '');
  if (normalized.startsWith('+')) {
    return /^\+[0-9]{8,15}$/.test(normalized);
  }

  return /^[0-9]{10,15}$/.test(normalized);
}

function validateClientPayload(payload) {
  const email = String(payload?.email || '').trim();
  const phones = Array.isArray(payload?.phoneNumbers)
    ? payload.phoneNumbers
    : (payload?.phone ? [payload.phone] : []);

  if (!isValidEmail(email)) {
    return 'Adresse email invalide.';
  }

  const invalidPhone = phones.find((phone) => !isValidPhone(phone));
  if (invalidPhone) {
    return 'Numéro de téléphone invalide.';
  }

  return '';
}

module.exports = {
  isValidEmail,
  isValidPhone,
  validateClientPayload,
};