// Pure iCal parsing/normalization helpers, extracted verbatim from routes/properties.js.
// No DB, no network — text in, structured events out. The anti-overbooking sync engine
// (propertyIcalModel) builds on these.

const crypto = require('crypto');
const { sentenceCase } = require('./textFormatters');

function normalizePlatformKey(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toIsoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIcalDate(rawValue, isDateOnly) {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  const compact = value.replace(/[-:]/g, '');
  if (/^\d{8}$/.test(compact)) {
    const y = Number(compact.slice(0, 4));
    const m = Number(compact.slice(4, 6));
    const d = Number(compact.slice(6, 8));
    return toIsoDate(y, m, d);
  }

  if (/^\d{8}T\d{6}Z$/.test(compact)) {
    const y = Number(compact.slice(0, 4));
    const m = Number(compact.slice(4, 6));
    const d = Number(compact.slice(6, 8));
    const hh = Number(compact.slice(9, 11));
    const mm = Number(compact.slice(11, 13));
    const ss = Number(compact.slice(13, 15));
    const date = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
    return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  if (/^\d{8}T\d{6}$/.test(compact)) {
    const y = Number(compact.slice(0, 4));
    const m = Number(compact.slice(4, 6));
    const d = Number(compact.slice(6, 8));
    return toIsoDate(y, m, d);
  }

  if (!isDateOnly) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return toIsoDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
    }
  }

  return '';
}

function addIsoDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function unfoldIcsLines(icsText) {
  const raw = String(icsText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeIcalText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function normalizeIcalSummary(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSummaryFromIcalReservationNotes(notes) {
  const match = String(notes || '').match(/(?:^|\n)Résumé:\s*(.+)$/m);
  return match ? String(match[1] || '').trim() : '';
}

function parseAdultsFromText(summary, description) {
  const haystack = `${summary || ''}\n${description || ''}`;
  const regexes = [
    /(?:adultes?|adults?|guests?|voyageurs?)\s*[:=-]?\s*(\d{1,2})/i,
    /(\d{1,2})\s*(?:adultes?|adults?|guests?|voyageurs?)/i,
  ];
  for (const regex of regexes) {
    const match = haystack.match(regex);
    if (match) {
      const count = Number(match[1]);
      if (Number.isFinite(count) && count > 0) return Math.min(20, count);
    }
  }
  return 1;
}

function parseGuestName(summary, description) {
  const candidate = String(summary || '').trim() || String(description || '').split('\n')[0].trim();
  const cleaned = candidate
    .replace(/\b(airbnb|booking|abritel|greengo|direct|reservation|r[eé]servation|blocked|bloqu[eé]|indisponible)\b/gi, ' ')
    .replace(/[()\[\]{}:_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return { firstName: '', lastName: '', isFallback: true };
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: 'iCal', isFallback: false };
  return { firstName: parts[0], lastName: parts.slice(1).join(' '), isFallback: false };
}

function resolveIcalClientIdentity(guestName, platformLabel) {
  const fallbackPlatformLabel = String(platformLabel || '').trim() || 'Plateforme';

  if (guestName?.isFallback) {
    return {
      firstName: 'Ical',
      lastName: fallbackPlatformLabel,
    };
  }

  return {
    firstName: sentenceCase(guestName?.firstName || 'Ical'),
    lastName: sentenceCase(guestName?.lastName || 'iCal'),
  };
}

function isUnavailableIcalEvent(summary, description) {
  const text = `${String(summary || '')}\n${String(description || '')}`
    .replace(/ /g, ' ')
    .toLowerCase();
  return /(blocked|not\s*available|unavailable|indisponible|non\s*disponible|\(\s*not\s*available\s*\))/i.test(text);
}

function parseIcsEvents(icsText) {
  const lines = unfoldIcsLines(icsText);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex < 0) continue;
    const left = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);
    const [propNameRaw, ...paramParts] = left.split(';');
    const propName = String(propNameRaw || '').toUpperCase();
    const params = {};
    paramParts.forEach((part) => {
      const [k, v] = part.split('=');
      if (k && v) params[String(k).toUpperCase()] = v;
    });
    current[propName] = { value, params };
  }

  return events
    .map((event) => {
      const dtStartRaw = event.DTSTART?.value || '';
      const dtEndRaw = event.DTEND?.value || '';
      const startDate = parseIcalDate(dtStartRaw, event.DTSTART?.params?.VALUE === 'DATE');
      let endDate = parseIcalDate(dtEndRaw, event.DTEND?.params?.VALUE === 'DATE');
      if (!endDate && startDate) endDate = addIsoDays(startDate, 1);
      if (startDate && endDate && endDate <= startDate) endDate = addIsoDays(startDate, 1);

      const summary = unescapeIcalText(event.SUMMARY?.value || '');
      const description = unescapeIcalText(event.DESCRIPTION?.value || '');
      const status = String(event.STATUS?.value || '').toUpperCase();
      const uidBase = unescapeIcalText(event.UID?.value || '') || `${startDate}|${endDate}|${summary}`;
      const uid = uidBase || crypto.createHash('sha1').update(JSON.stringify(event)).digest('hex');
      const adults = parseAdultsFromText(summary, description);

      return {
        uid,
        startDate,
        endDate,
        summary,
        description,
        adults,
        status,
      };
    })
    .filter((event) => event.startDate && event.endDate && event.status !== 'CANCELLED' && !isUnavailableIcalEvent(event.summary, event.description));
}

function buildEventHash(event) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
      startDate: event.startDate,
      endDate: event.endDate,
      summary: event.summary,
      description: event.description,
      adults: event.adults,
    }))
    .digest('hex');
}

function shouldSkipIcalReservationUpdate(mappedReservation) {
  return String(mappedReservation?.sourceType || '') === 'ical'
    && Number(mappedReservation?.icalSyncLocked || 0) === 1;
}

function buildIcalCreationHistoryChanges(source, eventUid) {
  return [
    { field: 'sourceType', label: 'Origine', from: null, to: `Import iCal (${source?.platformLabel || source?.name || 'Source inconnue'})` },
    { field: 'sourceIcalEventUid', label: 'UID iCal', from: null, to: eventUid || '' },
  ];
}

module.exports = {
  normalizePlatformKey,
  toIsoDate,
  parseIcalDate,
  addIsoDays,
  unfoldIcsLines,
  unescapeIcalText,
  normalizeIcalSummary,
  extractSummaryFromIcalReservationNotes,
  parseAdultsFromText,
  parseGuestName,
  resolveIcalClientIdentity,
  isUnavailableIcalEvent,
  parseIcsEvents,
  buildEventHash,
  shouldSkipIcalReservationUpdate,
  buildIcalCreationHistoryChanges,
};
