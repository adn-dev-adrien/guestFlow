/**
 * The HTML part of a guest email (specs/emails/guest-email-texts-made-simple.md rules 37–39, UI/UX review
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
 * - the sender's name heads the email, under the company logo when one is stored.
 * Everything else is escaped. The email is a white letter on the house's page colour
 * (specs/emails/guest-email-branding.md): the logo travels inside the message (`cid:`), nothing is loaded from
 * anywhere, a night variant answers the reader's dark mode and the column stays under 600 px.
 */

const { resolveEmailIdentity, DEFAULT_SENDER_NAME } = require('./emailIdentity');
const { resolveEmailColors, EMAIL_COLOR_DEFAULTS } = require('./emailColors');
const { emailLogoPng, emailLogoDataUri } = require('./emailLogo');

const FONT_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_SERIF = "Georgia, 'Times New Roman', serif";
const INK = '#22271F';
const MUTED = '#5C6153';
const CARD_LINE = '#DCD4C2';
const RULE = '#E4DFD3';
const DEFAULT_LINK = EMAIL_COLOR_DEFAULTS.link;
const CID_DAY = 'gf-logo-day@guestflow';
const CID_NIGHT = 'gf-logo-night@guestflow';

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

function link(href, label, color, { keepTogether = false } = {}) {
  const wrap = keepTogether ? 'white-space:nowrap' : 'overflow-wrap:anywhere;word-break:break-word';
  return `<a href="${escapeHtml(href)}" style="color:${color};text-decoration:underline;${wrap}">${escapeHtml(label)}</a>`;
}

// Escaped prose, where an amount never leaves its « € » alone on the next line.
function prose(value) {
  return escapeHtml(value).replace(/(\d) €/g, '$1&nbsp;€');
}

/** One line of text → escaped HTML with its links. */
function inline(line, color) {
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
    if (m[1]) out += link(match, match, color);
    else if (m[2]) out += link(`mailto:${match}`, match, color);
    else out += link(`tel:${match.replace(/[\s.]/g, '')}`, match, color, { keepTogether: true });
    out += prose(tail);
    last = m.index + m[0].length;
  }
  return out + prose(line.slice(last));
}

// A paragraph that introduces the list under it (« Récapitulatif de votre séjour : ») sits close to it.
function paragraph(lines, color, leadsList = false) {
  return `<p style="margin:0 0 ${leadsList ? 8 : 16}px">${lines.map((l) => inline(l.trim(), color)).join('<br>')}</p>`;
}

function list(items, color) {
  const recap = items.map((item) => RECAP_RE.exec(item));
  if (recap.every((m) => m && !/https?:/.test(m[1]))) {
    const cell = 'padding:8px 0;vertical-align:top;border-top:1px solid ' + RULE;
    const rows = recap.map(([, label, value]) => '<tr>'
      + `<td class="gf-muted gf-rule" style="${cell};padding-right:12px;width:40%;color:${MUTED}">${inline(label.trim(), color)}</td>`
      + `<td class="gf-rule" style="${cell}">${inline(value.trim(), color)}</td>`
      + '</tr>').join('');
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 16px;font-size:15px">${rows}</table>`;
  }
  return `<ul style="margin:0 0 16px;padding-left:20px">${items.map((i) => `<li style="margin:0 0 4px">${inline(i, color)}</li>`).join('')}</ul>`;
}

/** A block between blank lines → its paragraphs and lists, in order. */
function block(lines, color) {
  const out = [];
  let run = [];
  let bullets = null;
  const flush = (next = false) => {
    if (!run.length) return;
    out.push(bullets ? list(run, color) : paragraph(run, color, next));
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
function textToHtmlBody(text, color = DEFAULT_LINK) {
  const blocks = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((b) => b.split('\n').filter((l) => l.trim() !== ''))
    .filter((b) => b.length);
  return blocks.map((b) => block(b, color)).join('\n');
}


const NIGHT_LOGO_HIDDEN = 'display:none;max-height:0;overflow:hidden;mso-hide:all';

function logoImg({ src, alt, className, hidden = false }) {
  const style = hidden
    ? `${NIGHT_LOGO_HIDDEN};height:72px;width:auto;margin:0 auto 10px`
    : 'display:block;height:72px;width:auto;margin:0 auto 10px;box-sizing:content-box';
  return `<img class="${className}" src="${src}" alt="${escapeHtml(alt)}" height="72" style="${style}">`;
}

/**
 * The full HTML document of a guest email: the letter (specs/emails/guest-email-branding.md rules 1–5).
 * @param {{ text: string, subject?: string, heading?: string, lang?: string,
 *           colors?: { page: string, accent: string, link: string },
 *           logo?: { day: string, night?: string } | null }} input
 *   `logo` carries the `src` of each image — `cid:…` in a sent email, a `data:` URI in the preview.
 */
function renderGuestEmailHtml({ text, subject = '', heading = '', lang = 'fr', colors = EMAIL_COLOR_DEFAULTS, logo = null }) {
  const language = lang === 'en' ? 'en' : 'fr';
  const title = String(heading || '').trim();
  const dayLogo = logo && logo.day ? logo.day : '';
  const nightLogo = dayLogo && logo.night ? logo.night : '';
  const head = dayLogo || title
    ? '<div style="text-align:center;margin:0 0 22px">'
      + (dayLogo ? logoImg({ src: dayLogo, alt: title, className: nightLogo ? 'gf-logo gf-logo-day' : 'gf-logo gf-logo-tile' }) : '')
      + (nightLogo ? logoImg({ src: nightLogo, alt: title, className: 'gf-logo gf-logo-night', hidden: true }) : '')
      + (title ? `<h1 style="margin:0;font-family:${FONT_SERIF};font-size:21px;line-height:1.25;font-weight:400;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(title)}</h1>` : '')
      + `<div style="width:56px;height:2px;line-height:2px;font-size:2px;margin:14px auto 0;background:${colors.accent}">&nbsp;</div>`
      + '</div>\n'
    : '';
  return '<!doctype html>\n'
    + `<html lang="${language}"><head><meta charset="utf-8">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">'
    + `<title>${escapeHtml(subject)}</title>`
    + '<style>'
    + ':root{color-scheme:light dark;supported-color-schemes:light dark}'
    + 'body{margin:0;padding:0;-webkit-text-size-adjust:100%}'
    + '@media (max-width:600px){'
    + '.gf-page{padding:12px 6px 24px !important}'
    + '.gf-card{padding:20px !important}'
    + '.gf-logo{height:56px !important}'
    + '}'
    + '@media (prefers-color-scheme: dark){'
    + '.gf-body,.gf-page{background:#161C16 !important}'
    + '.gf-card{background:#1F261E !important;border-color:#2E3B2A !important;color:#ECE8DF !important}'
    + '.gf-muted{color:#B9B3A6 !important}'
    + '.gf-rule{border-color:#2E3B2A !important}'
    + '.gf-card a{color:#E2B46A !important}'
    + '.gf-logo-day{display:none !important;max-height:0 !important}'
    + '.gf-logo-night{display:block !important;max-height:none !important;overflow:visible !important}'
    + '.gf-logo-tile{background:#FFFFFF !important;border-radius:8px !important;padding:10px !important}'
    + '}'
    + '</style></head>'
    + `<body class="gf-body" style="margin:0;padding:0;background:${colors.page};color:${INK}">`
    + `<div class="gf-page" style="padding:28px 16px 36px;background:${colors.page}">`
    + `<div class="gf-card" role="article" aria-roledescription="email" lang="${language}" style="box-sizing:border-box;max-width:600px;margin:0 auto;padding:32px;background:#FFFFFF;border:1px solid ${CARD_LINE};border-radius:4px;color:${INK};font-family:${FONT_SANS};font-size:16px;line-height:1.55">`
    + head
    + textToHtmlBody(text, colors.link)
    + '</div></div></body></html>\n';
}

function renderForSettings({ text, subject, settings, lang, logo }) {
  const { fromName } = resolveEmailIdentity(settings || {});
  // No name of its own (the « GuestFlow » fallback): no heading rather than the software's name.
  const heading = fromName === DEFAULT_SENDER_NAME ? '' : fromName;
  return renderGuestEmailHtml({ text, subject, heading, lang, colors: resolveEmailColors(settings), logo });
}

/**
 * The message a guest email sends: the rendered text untouched, plus its HTML alternative with the company
 * logos as inline attachments (`cid:`). The logos are read here, so the call is async.
 * @param {{ to?: string, subject: string, text: string, settings?: object, lang?: string }} input
 */
async function guestEmailMessage({ to, subject, text, settings = {}, lang = 'fr' }) {
  const day = await emailLogoPng(settings && settings.companyLogoPath);
  const night = day ? await emailLogoPng(settings && settings.companyLogoDarkPath) : null;
  const images = [day && { cid: CID_DAY, bytes: day }, night && { cid: CID_NIGHT, bytes: night }].filter(Boolean);
  const logo = day ? { day: `cid:${CID_DAY}`, night: night ? `cid:${CID_NIGHT}` : undefined } : null;
  const attachments = images.map(({ cid, bytes }) => ({
    filename: `${cid.split('@')[0]}.png`, content: bytes, contentType: 'image/png', cid, contentDisposition: 'inline',
  }));
  return {
    ...(to !== undefined ? { to } : {}),
    subject,
    text,
    html: renderForSettings({ text, subject, settings, lang, logo }),
    ...(attachments.length ? { attachments } : {}),
  };
}

/** The same HTML for the preview: logos written in as `data:` URIs (guest-email-branding rule 8). */
function guestEmailPreviewHtml({ subject, text, settings = {}, lang = 'fr' }) {
  const day = emailLogoDataUri(settings && settings.companyLogoPath);
  const night = day ? emailLogoDataUri(settings && settings.companyLogoDarkPath) : null;
  return renderForSettings({ text, subject, settings, lang, logo: day ? { day, night: night || undefined } : null });
}

module.exports = { guestEmailMessage, guestEmailPreviewHtml, renderGuestEmailHtml, textToHtmlBody, escapeHtml };
