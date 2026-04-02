export function isValidEmail(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function isValidPhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;

  const normalized = trimmed.replace(/[\s().-]/g, '');
  if (normalized.startsWith('+')) {
    return /^\+[0-9]{8,15}$/.test(normalized);
  }

  return /^[0-9]{10,15}$/.test(normalized);
}