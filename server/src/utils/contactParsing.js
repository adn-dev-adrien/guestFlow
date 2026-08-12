/**
 * Contact parsing — turns what a user pastes or drags from a web page into clean client fields
 * (specs/client-contact-smart-input.md).
 *
 * Pure functions, no DB, no framework: the client ships the raw string and renders whatever comes back.
 *
 * - `parseAddressBlock(raw)` — splits a one-line French address into `{ streetNumber, street, postalCode, city }`.
 * - `extractEmail(raw)`      — pulls the address out of a `mailto:` link, a `Nom <mail>` pair or free text.
 * - `extractPhone(raw)`      — pulls a number out of a `tel:` link or free text and compacts it.
 */

const { sentenceCase } = require('./textFormatters');

// A trailing country word carries no information for a French-only address book.
const COUNTRY_TOKENS = new Set(['france', 'fr', 'french']);
// A house number is 1-4 digits with an optional letter ("12", "12b", "4A"). Five digits is a postal code.
const HOUSE_NUMBER = /^\d{1,4}[a-zA-Z]?$/;
const NUMBER_SUFFIXES = new Set(['bis', 'ter', 'quater']);
const POSTAL_CODE = /^\d{5}$/;

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// A plausible number run: at least 7 characters, digits possibly spaced by the usual separators.
const PHONE_RUN = /\+?\d[\d\s.\-()/]{5,}\d/;

function decodeMaybe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Commas, semicolons and line breaks are just separators here — the format is positional.
function tokenize(raw) {
  return String(raw || '')
    .replace(/[,;\n\r\t]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Split a one-line address, positionally: `<numéro> <nom de rue> <code postal> <ville>`.
 * Everything is optional except the city, which is the last thing left when no postal code anchors
 * the split.
 */
function parseAddressBlock(raw) {
  const tokens = tokenize(raw);
  while (tokens.length > 0 && COUNTRY_TOKENS.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }
  if (tokens.length === 0) {
    return { streetNumber: '', street: '', postalCode: '', city: '' };
  }

  let streetNumber = '';
  if (HOUSE_NUMBER.test(tokens[0])) {
    streetNumber = tokens.shift();
    if (tokens.length > 0 && NUMBER_SUFFIXES.has(tokens[0].toLowerCase())) {
      streetNumber += ` ${tokens.shift().toLowerCase()}`;
    }
  }

  const postalIndex = tokens.findIndex((token) => POSTAL_CODE.test(token));
  let postalCode = '';
  let streetTokens = [];
  let cityTokens = [];
  if (postalIndex !== -1) {
    postalCode = tokens[postalIndex];
    streetTokens = tokens.slice(0, postalIndex);
    cityTokens = tokens.slice(postalIndex + 1);
  } else if (tokens.length <= 1) {
    cityTokens = tokens;
  } else {
    // No postal code to anchor the split: the format is positional, so the last token is the city.
    streetTokens = tokens.slice(0, -1);
    cityTokens = tokens.slice(-1);
  }

  return {
    streetNumber,
    street: sentenceCase(streetTokens.join(' ')),
    postalCode,
    city: sentenceCase(cityTokens.join(' ')),
  };
}

/** Extract a single email address; returns '' when the input holds nothing email-shaped. */
function extractEmail(raw) {
  let text = decodeMaybe(String(raw || '').trim());
  if (!text) return '';

  const mailto = text.match(/mailto:([^?\s>]+)/i);
  if (mailto) text = mailto[1];

  const angled = text.match(/<([^>]+)>/);
  if (angled) text = angled[1];

  const match = text.match(EMAIL);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Extract a single phone number and compact it (no separators).
 *
 * Only the French prefix is turned back into a national `0`: `+33`/`0033` → `0…`. Every other country
 * code is preserved, so a foreign client never loses its prefix.
 */
function extractPhone(raw) {
  let text = decodeMaybe(String(raw || '').trim());
  if (!text) return '';

  text = text.replace(/^(?:tel|callto|sms|phone)\s*:/i, '').trim();
  const match = text.match(PHONE_RUN);
  if (!match) return '';

  const digitsOnly = match[0].replace(/[^\d]/g, '');
  let compact = match[0].trim().startsWith('+') ? `+${digitsOnly}` : digitsOnly;

  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;
  if (compact.startsWith('+33')) {
    // `+33 (0)6 …` is a common notation — the national trunk `0` must not be doubled.
    compact = `0${compact.slice(3).replace(/^0+/, '')}`;
  }
  return compact;
}

module.exports = {
  parseAddressBlock,
  extractEmail,
  extractPhone,
};
