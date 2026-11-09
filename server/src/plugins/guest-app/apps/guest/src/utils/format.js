/**
 * Presentational formatting only (CLAUDE.md §6.0): a clock time the server sends as `HH:MM` or an instant,
 * printed the way the guest reads it (« 20 h 30 » / « 20:30 », Europe/Paris). No date arithmetic, no price.
 */

/** `'20:00'` → « 20 h » / « 20:00 »; `'20:30'` → « 20 h 30 » / « 20:30 ». */
export function clockLabel(hhmm, lang = 'fr') {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  if (lang === 'en') return `${m[1].padStart(2, '0')}:${m[2]}`;
  return m[2] === '00' ? `${Number(m[1])} h` : `${Number(m[1])} h ${m[2]}`;
}

const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** An ISO instant → its Paris clock, as `clockLabel` prints it. */
export function instantClock(iso, lang = 'fr') {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return clockLabel(PARIS.format(new Date(ms)), lang);
}

const DAY = { fr: new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric' }), en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: 'numeric' }) };
const DAY_MONTH = { fr: new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' }), en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' }) };

/** The stay card's « 6 → 9 nov. » from the server's two instants (same month: the month once). */
export function stayDatesLabel(arrival, departure, lang = 'fr') {
  const a = Date.parse(arrival);
  const d = Date.parse(departure);
  if (Number.isNaN(a) || Number.isNaN(d)) return '';
  const fmt = DAY_MONTH[lang] || DAY_MONTH.fr;
  const sameMonth = fmt.formatToParts(new Date(a)).find((p) => p.type === 'month').value === fmt.formatToParts(new Date(d)).find((p) => p.type === 'month').value;
  const left = sameMonth ? (DAY[lang] || DAY.fr).format(new Date(a)) : fmt.format(new Date(a));
  return `${left} → ${fmt.format(new Date(d))}`;
}

/** Copy a text, falling back to a hidden field where the Clipboard API is missing (older iOS, http). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    field.remove();
    return ok;
  }
}
