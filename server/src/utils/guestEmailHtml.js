/**
 * The HTML part of a guest email (specs/guest-email-texts-made-simple.md rules 37–39, UI/UX review
 * 2026-10-18, decision 15). The text the operator writes stays the one source: it is rendered as
 * today, sent unchanged as the `text/plain` part, and this module derives a sober `text/html`
 * alternative from that same rendered text — never from the template, so the two parts cannot say
 * different things.
 *
 * What the derivation does, and nothing more:
 * - a blank line separates paragraphs, a single line break stays a line break;
 * - a run of « - » / « • » lines is a list; when every line of it reads « Libellé : valeur », it is a
 *   two-column recap;
 * - a web address, an email address or a French phone number is a plain link (its own text, no button,
 *   no tracking, no rewriting);
 * - the sender's name heads the email in the Maison serif.
 * Everything else is escaped. No image, no remote stylesheet or font, nothing loaded from anywhere:
 * the colours carry a dark-mode variant and the column stays under 600 px.
 */

const { resolveEmailIdentity, DEFAULT_SENDER_NAME } = require('./emailIdentity');

const FONT_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_SERIF = "'Iowan Old Style', 'Source Serif 4', Charter, Georgia, 'Times New Roman', serif";
const INK = '#27251F';
const MUTED = '#6E6A5E';
const PAPER = '#F8F5EF';
const RULE = '#E4DFD3';
const FIR = '#2F5D46';

// One pass over a line finds every link: a web address, an email address (an apostrophe may sit in
// its local part, « jean.o'brien@… »), a French phone number. A number glued to a letter, a slash or a
// dash (« HA-0123456789 », « 2026-0412345678 ») is a reference, never a phone.
const PHONE = '(?:(?:\\+33[\\s.]?[1-9]|0[1-9])(?:[\\s.]\\d{2}){4}|\\+33[1-9]\\d{8}|0[1-9]\\d{8})';
const LINK_RE = new RegExp(
  '(https?:\\/\\/[^\\s<>"]+)'
  + "|([A-Za-z0-9._%+-][A-Za-z0-9._%+'’-]*@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})"
  + `|((?<![\\w/+-])${PHONE}(?![\\w/-]))`,
  'g',
);
// Ten digits in a row are a phone only after a word that says so (« appelez-nous au 0612345678 »):
// alone they may be a Wi-Fi code or a key-box code.
const CALL_CONTEXT_RE = /(?:(?:appel|t[ée]l[ée]phon|\bt[ée]l\b|\bphone\b|\bcall\b|joindre)[^\n]{0,24}|\bau\s+)$/i;
// Punctuation that ends a sentence, not the address it follows.
const URL_TRAIL_CHARS = '.,;:!?)]»’\'"';
const BULLET_RE = /^\s*[-•–]\s+(.*\S)\s*$/;
const RECAP_RE = /^([^:]{1,40}?)\s*:\s+(\S.*)$/;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function link(href, label, { keepTogether = false } = {}) {
  const wrap = keepTogether ? 'white-space:nowrap' : 'overflow-wrap:anywhere;word-break:break-word';
  return `<a href="${escapeHtml(href)}" style="color:${FIR};text-decoration:underline;${wrap}">${escapeHtml(label)}</a>`;
}

// Escaped prose, where an amount never leaves its « € » alone on the next line.
function prose(value) {
  return escapeHtml(value).replace(/(\d) €/g, '$1&nbsp;€');
}

/** One line of text → escaped HTML with its links. */
function inline(line) {
  let out = '';
  let last = 0;
  for (const m of String(line).matchAll(LINK_RE)) {
    let [match] = m;
    let tail = '';
    if (m[1]) {
      // A closing parenthesis stays when it closes one opened inside the address (Wikipedia-style).
      // Counted once, then trimmed by index: a long run of trailing punctuation stays linear.
      let opens = 0;
      let closes = 0;
      for (const ch of match) {
        if (ch === '(') opens += 1;
        else if (ch === ')') closes += 1;
      }
      let end = match.length;
      while (end > 0 && URL_TRAIL_CHARS.includes(match[end - 1])) {
        if (match[end - 1] === ')') {
          if (opens >= closes) break;
          closes -= 1;
        }
        end -= 1;
      }
      tail = match.slice(end);
      match = match.slice(0, end);
    }
    if (m[3] && /^0\d{9}$/.test(match) && !CALL_CONTEXT_RE.test(line.slice(0, m.index))) continue;
    out += prose(line.slice(last, m.index));
    if (m[1]) out += link(match, match);
    else if (m[2]) out += link(`mailto:${match}`, match);
    else out += link(`tel:${match.replace(/[\s.]/g, '')}`, match, { keepTogether: true });
    out += prose(tail);
    last = m.index + m[0].length;
  }
  return out + prose(line.slice(last));
}

// A paragraph that introduces the list under it (« Récapitulatif de votre séjour : ») sits close to it.
function paragraph(lines, leadsList = false) {
  return `<p style="margin:0 0 ${leadsList ? 8 : 16}px">${lines.map((l) => inline(l.trim())).join('<br>')}</p>`;
}

function list(items) {
  const recap = items.map((item) => RECAP_RE.exec(item));
  if (recap.every((m) => m && !/https?:/.test(m[1]))) {
    const cell = 'padding:8px 0;vertical-align:top;border-top:1px solid ' + RULE;
    const rows = recap.map(([, label, value]) => '<tr>'
      + `<td class="gf-muted gf-rule" style="${cell};padding-right:12px;width:40%;color:${MUTED}">${inline(label.trim())}</td>`
      + `<td class="gf-rule" style="${cell}">${inline(value.trim())}</td>`
      + '</tr>').join('');
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 16px;font-size:15px">${rows}</table>`;
  }
  return `<ul style="margin:0 0 16px;padding-left:20px">${items.map((i) => `<li style="margin:0 0 4px">${inline(i)}</li>`).join('')}</ul>`;
}

/** A block between blank lines → its paragraphs and lists, in order. */
function block(lines) {
  const out = [];
  let run = [];
  let bullets = null;
  const flush = (next = false) => {
    if (!run.length) return;
    out.push(bullets ? list(run) : paragraph(run, next));
    run = [];
  };
  for (const line of lines) {
    const bullet = BULLET_RE.exec(line);
    if (Boolean(bullet) !== bullets) {
      flush(Boolean(bullet));
      bullets = Boolean(bullet);
    }
    run.push(bullet ? bullet[1] : line);
  }
  flush();
  return out.join('');
}

/** The rendered text of an email → its HTML body (no document around it). */
function textToHtmlBody(text) {
  const blocks = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((b) => b.split('\n').filter((l) => l.trim() !== ''))
    .filter((b) => b.length);
  return blocks.map(block).join('\n');
}

/**
 * The full HTML document of a guest email.
 * @param {{ text: string, subject?: string, heading?: string, lang?: string }} input
 */
function renderGuestEmailHtml({ text, subject = '', heading = '', lang = 'fr' }) {
  const language = lang === 'en' ? 'en' : 'fr';
  const title = String(heading || '').trim();
  return '<!doctype html>\n'
    + `<html lang="${language}"><head><meta charset="utf-8">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">'
    + `<title>${escapeHtml(subject)}</title>`
    + '<style>'
    + 'body{margin:0;padding:0;-webkit-text-size-adjust:100%}'
    + '@media (prefers-color-scheme: dark){'
    + '.gf-body{background:#1E1D1A !important;color:#ECE8DF !important}'
    + '.gf-muted{color:#B9B3A6 !important}'
    + '.gf-rule{border-color:#3B3934 !important}'
    + '.gf-body a{color:#9CC7AE !important}'
    + '}'
    + '</style></head>'
    + `<body class="gf-body" style="margin:0;padding:0;background:${PAPER};color:${INK}">`
    + `<div class="gf-body" role="article" aria-roledescription="email" lang="${language}" style="max-width:600px;margin:0 auto;padding:28px 20px 32px;background:${PAPER};color:${INK};font-family:${FONT_SANS};font-size:16px;line-height:1.55">`
    + (title ? `<h1 class="gf-rule" style="margin:0 0 24px;padding:0 0 14px;border-bottom:1px solid ${RULE};font-family:${FONT_SERIF};font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-0.01em">${escapeHtml(title)}</h1>\n` : '')
    + textToHtmlBody(text)
    + '</div></body></html>\n';
}

/**
 * The message a guest email sends: the rendered text untouched, plus its HTML alternative.
 * @param {{ to?: string, subject: string, text: string, settings?: object, lang?: string }} input
 */
function guestEmailMessage({ to, subject, text, settings = {}, lang = 'fr' }) {
  const { fromName } = resolveEmailIdentity(settings || {});
  // No name of its own (the « GuestFlow » fallback): no heading rather than the software's name.
  const heading = fromName === DEFAULT_SENDER_NAME ? '' : fromName;
  return {
    ...(to !== undefined ? { to } : {}),
    subject,
    text,
    html: renderGuestEmailHtml({ text, subject, heading, lang }),
  };
}

module.exports = { guestEmailMessage, renderGuestEmailHtml, textToHtmlBody, escapeHtml };
