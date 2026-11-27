/**
 * The three colours of a guest email (specs/emails/guest-email-branding.md rules 5–6).
 *
 * - `EMAIL_COLOR_DEFAULTS` → Maison's palette, used for every colour the operator left empty.
 * - `resolveEmailColors(settings)` → `{ page, accent, link }`, `#RRGGBB` upper-cased, defaults applied.
 * - `contrastOnWhite(hex)` → WCAG 2 contrast ratio of the colour on white (utils/colorContrast.js).
 * - `validateEmailColor(column, value)` → `''` when accepted (empty = default), else the French refusal
 *   shown under the field. The link colour must reach 4.5:1 on the white card, the accent rule 3:1.
 */

const { WHITE, contrastRatio } = require('./colorContrast');

const EMAIL_COLOR_DEFAULTS = { page: '#F8F5EF', accent: '#C99038', link: '#2F5D46' };

const COLUMN_TO_KEY = { emailColorPage: 'page', emailColorAccent: 'accent', emailColorLink: 'link' };
const MIN_CONTRAST = { emailColorLink: 4.5, emailColorAccent: 3 };
const MIN_LABEL = { emailColorLink: 'pour les liens', emailColorAccent: 'pour le filet' };

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function contrastOnWhite(hex) {
  return contrastRatio(hex, WHITE);
}

// Cut, never rounded up: a ratio shown as « 4,5 » must not belong to a colour the rule refused.
function formatRatio(ratio) {
  return (Math.floor(ratio * 10) / 10).toFixed(1).replace('.', ',');
}

function validateEmailColor(column, value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !HEX_RE.test(value.trim())) return 'Couleur au format #RRGGBB.';
  const min = MIN_CONTRAST[column];
  if (!min) return '';
  const ratio = contrastOnWhite(value.trim());
  if (ratio >= min) return '';
  return `Contraste ${formatRatio(ratio)}:1 sur fond blanc — ${String(min).replace('.', ',')}:1 minimum ${MIN_LABEL[column]}`;
}

function resolveEmailColors(settings = {}) {
  const out = {};
  for (const [column, key] of Object.entries(COLUMN_TO_KEY)) {
    const raw = String((settings && settings[column]) || '').trim();
    out[key] = HEX_RE.test(raw) ? raw.toUpperCase() : EMAIL_COLOR_DEFAULTS[key];
  }
  return out;
}

module.exports = { EMAIL_COLOR_DEFAULTS, EMAIL_COLUMNS: Object.keys(COLUMN_TO_KEY), contrastOnWhite, validateEmailColor, resolveEmailColors };
