/**
 * Reads the mails of one sender from an IMAP mailbox, for the intake plugins
 * (specs/gites-de-france-mail-intake.md rule 1, specs/airbnb-mail-intake.md rule 4). Read-only: the
 * mailbox is opened with `readOnly`, nothing is flagged, moved or deleted — the operator's mail client
 * still sees every message as it was.
 *
 * Rule 30 (audit r3, external N5): the caller may pass `seen(messageId)` — a known mail is skipped before its
 * body is downloaded —, `onMail(mail)` — each mail is handed over as it is read and none is kept, the
 * function then returns `[]` — and `limit` (default 200) — at most that many UNAUTHENTICATED bodies per pass, newest first (rule 31: a mail with
 * a good DKIM verdict is read whatever the cap).
 * Without `onMail` it returns `[{ messageId, receivedAt, sentAt, subject, text, authenticated, authReason }]`, the text being
 * the plain-text part, or the HTML part reduced to text when the mail has no plain part.
 *
 * A mail is returned only when its header From address IS the sender (the IMAP search is a
 * substring match over the display name too). `authenticated` is true only when the receiving server's
 * `Authentication-Results` reports `dkim=pass` for the sender's domain (or `allowedDomains`); an
 * unauthenticated mail is still returned, flagged, for the caller to propose and never auto-apply
 * (specs/airbnb-mail-intake.md rule 22). `trustedAuthservId` names the mailbox server whose header counts
 * (default: the provider's own name when the SMTP host is known, e.g. Gmail; otherwise nothing is
 * authenticated).
 *
 * The host is pinned here, whatever the caller passes (see `resolveImapHost`): the SMTP account's password
 * only ever reaches a host of the SMTP server's domain, for any version of any plugin.
 */

const { ImapFlow } = require('imapflow');
const { addressMatches, verifyDkim, defaultAuthservId, domainOf, toList } = require('./mailAuthentication');

// Rendered the way a browser shows the HTML (specs/gites-de-france-mail-intake.md rule 27): whitespace of the
// source is one space inside a text run, and only block-level tags (tr, td, br, p, div, li…) start a new line, so a
// label and its value split over source lines, or every cell in one row, read the same. Linear in the size of the
// mail: tags are cut with indexOf, never with a pattern that backtracks across `>` (airbnb-mail-intake rule 26).
// The `alt` of an image is kept, the rest of the tag dropped.
const ALT_RE = /\balt="([^"]{0,500})"/i;
const STYLE_END = /<\/style/gi;
const MAX_TAG = 2000;
const BLOCK = new Set(['tr', 'td', 'th', 'br', 'p', 'div', 'li', 'ul', 'ol', 'table', 'tbody', 'thead', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const ENTITIES = { nbsp: '\u00a0', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', icirc: 'î', ocirc: 'ô', ugrave: 'ù', euro: '€', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', laquo: '«', raquo: '»' };

const decodeEntities = (text) => text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi, (m, dec, hex, name) => {
  if (name) return ENTITIES[name.toLowerCase()] ?? m;
  const code = dec ? Number(dec) : parseInt(hex, 16);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
});

function stripTags(html) {
  let out = '';
  let i = 0;
  // The next `>` is the same for every `<` before it: looked up once, so a flood of `<` stays linear.
  let gtAt = -2;
  const nextGt = (from) => { if (gtAt !== -1 && gtAt < from) gtAt = html.indexOf('>', from); return gtAt; };
  const text = (run) => { out += decodeEntities(run).replace(/[ \t\r\n\f]+/g, ' '); };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { text(html.slice(i)); break; }
    text(html.slice(i, lt));
    const gt = nextGt(lt);
    if (gt < 0) { text(html.slice(lt)); break; }
    if (gt - lt > MAX_TAG) { out += '<'; i = lt + 1; continue; }
    const tag = html.slice(lt + 1, gt);
    const lower = ((/^\/?([a-z][a-z0-9]*)/i.exec(tag) || [])[1] || '').toLowerCase();
    if (lower === 'style' && tag[0] !== '/') {
      STYLE_END.lastIndex = gt;
      const close = STYLE_END.exec(html);
      i = close ? (html.indexOf('>', close.index) + 1 || html.length) : html.length;
      continue;
    }
    if (lower === 'img') {
      const alt = ALT_RE.exec(tag);
      if (alt) out += ` ${alt[1]} `;
    } else if (BLOCK.has(lower)) out += '\n';
    i = gt + 1;
  }
  return out;
}

function htmlToText(html) {
  return stripTags(String(html || '')).split('\n').map((l) => l.replace(/[ \u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
}

function findPart(node, type) {
  if (!node) return null;
  if (node.type === type && node.part) return node.part;
  if (node.type === type && !node.childNodes) return '1';
  for (const child of node.childNodes || []) {
    const found = findPart(child, type);
    if (found) return found;
  }
  return null;
}

// Rule 26 — a part past this size is not read: no genuine booking mail comes near it, and a forged one must not
// cost the server memory or time. Returns `{ tooLarge: <bytes read so far> }` for an oversized part.
const MAX_PART_BYTES = 256 * 1024;

async function readPart(client, uid, part, maxBytes = MAX_PART_BYTES) {
  const { content } = await client.download(String(uid), part, { uid: true });
  const chunks = [];
  let size = 0;
  for await (const chunk of content) {
    size += chunk.length;
    if (size > maxBytes) { if (typeof content.destroy === 'function') content.destroy(); return { tooLarge: size }; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// The password never travels in clear (specs/airbnb-mail-intake.md rule 23): implicit TLS on 993, and on
// any other port the connection must upgrade with STARTTLS or it is refused.
function connectionOptions({ host, port = 993, user, password }) {
  const implicit = Number(port) === 993;
  return { host, port: Number(port), secure: implicit, doSTARTTLS: implicit ? undefined : true, auth: { user, pass: password }, logger: false };
}

const MULTI_LABEL_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.mx', 'co.za', 'co.in', 'com.tr', 'com.pl', 'com.es']);
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-f:]*:[0-9a-f:]*\]?)$/i;

// The password of the SMTP account is only ever offered to the SMTP host itself, its imap. counterpart, or a
// host one label away from it under the same parent (smtp.example.com → imap.example.com, mail.example.com,
// example.com). Two labels away is another machine of a shared domain (ssl0.ovh.net must not accept
// vps-x.vps.ovh.net); a public suffix is never a parent; an IP address only matches itself. A configured
// host elsewhere is ignored: the derived one is used.
function resolveImapHost(smtpHost, configured) {
  const smtp = String(smtpHost || '').trim().toLowerCase();
  const wanted = String(configured || '').trim().toLowerCase();
  const derived = imapHostFor(smtp);
  if (!wanted) return derived;
  if (wanted === smtp || wanted === derived) return wanted;
  if (IP_LITERAL.test(smtp) || IP_LITERAL.test(wanted)) return derived;
  const labels = smtp.split('.');
  const parent = labels.length >= 3 ? labels.slice(1).join('.') : '';
  if (!parent || MULTI_LABEL_SUFFIXES.has(parent)) return derived;
  const sibling = wanted.endsWith(`.${parent}`) && !wanted.slice(0, -parent.length - 1).includes('.');
  return wanted === parent || sibling ? wanted : derived;
}

const coreSmtpHost = () => require('./coreServices').settings.mailbox().host;

// Rule 30 (audit r3, external N5) — a pass downloads at most this many bodies, newest first.
const MAX_MAILS_PER_PASS = 200;
const ENVELOPE_CHUNK = 500;

async function readMailsFrom({
  host, port = 993, user, password, sender, allowedDomains = null, trustedAuthservId = '',
  sinceDays = 30, now = new Date(), ImapClient = ImapFlow, smtpHostOf = coreSmtpHost, log = () => {},
  seen = () => false, onMail = null, limit = MAX_MAILS_PER_PASS,
}) {
  const smtpHost = smtpHostOf();
  const domains = toList(allowedDomains).length ? allowedDomains : domainOf(sender);
  const trusted = trustedAuthservId || defaultAuthservId(smtpHost);
  const client = new ImapClient(connectionOptions({ host: resolveImapHost(smtpHost, host), port, user, password }));
  let lock = null;
  try {
    // Inside the try: a refused lock (or a connect that half-opened the socket) still logs out.
    await client.connect();
    lock = await client.getMailboxLock('INBOX', { readOnly: true });
    const since = new Date(now.getTime() - sinceDays * 24 * 3600 * 1000);
    const uids = await client.search({ from: sender, since }, { uid: true });
    const out = [];
    // `onMail` receives each mail as it is read and the reader keeps none; without it the mails are
    // returned in one array. An oversized part is handed over as `{ skipped: 'tooLarge', text: '' }` so the
    // caller can remember it; the array leaves it out.
    const deliver = onMail || ((mail) => { if (!mail.skipped) out.push(mail); });
    // Rule 31 — the envelopes and the authentication header come in bulk, newest first, before any body: a
    // mail whose DKIM verdict is good is always read (the sender's domain vouches for it); the cap only
    // bounds the unauthenticated ones, which can never auto-apply anyway.
    const verified = [];
    const unverified = [];
    let notRead = 0;
    const ordered = [...(uids || [])].reverse();
    for (let at = 0; at < ordered.length; at += ENVELOPE_CHUNK) {
      const batch = [];
      // eslint-disable-next-line no-await-in-loop
      for await (const msg of client.fetch(ordered.slice(at, at + ENVELOPE_CHUNK).join(','), { envelope: true, bodyStructure: true, internalDate: true, headers: ['authentication-results'] }, { uid: true })) batch.push(msg);
      batch.sort((x, y) => y.uid - x.uid).forEach((msg) => {
        if (!msg || !addressMatches(msg.envelope, sender)) return;
        const messageId = (msg.envelope && msg.envelope.messageId) || `uid:${msg.uid}`;
        if (seen(messageId)) return;
        const auth = verifyDkim(msg.headers, { domains, trustedAuthservId: trusted });
        if (!auth.ok && unverified.length >= limit) { notRead += 1; return; }
        const plainPart = findPart(msg.bodyStructure, 'text/plain');
        (auth.ok ? verified : unverified).push({
          uid: msg.uid, messageId, auth, plainPart, partId: plainPart || findPart(msg.bodyStructure, 'text/html'), envelope: msg.envelope, internalDate: msg.internalDate,
        });
      });
    }
    if (notRead) log(`mail intake: ${notRead} unauthenticated mails not read in this pass (cap ${limit}); the newest were read first`);
    for (const { uid, messageId, auth, plainPart, partId, envelope, internalDate } of [...verified, ...unverified]) {
      const raw = partId ? await readPart(client, uid, partId) : ''; // eslint-disable-line no-await-in-loop
      const tooLarge = Boolean(raw && raw.tooLarge);
      if (tooLarge) log(`mail intake: ${messageId} skipped, its text part is over ${MAX_PART_BYTES} bytes (read ${raw.tooLarge}+)`);
      await deliver({ // eslint-disable-line no-await-in-loop
        messageId,
        receivedAt: new Date(internalDate || (envelope && envelope.date) || now).toISOString(),
        sentAt: new Date((envelope && envelope.date) || internalDate || now).toISOString(),
        subject: (envelope && envelope.subject) || '',
        text: tooLarge ? '' : (plainPart ? raw : htmlToText(raw)),
        authenticated: auth.ok,
        authReason: auth.reason,
        ...(tooLarge ? { skipped: 'tooLarge' } : {}),
      });
    }
    return out;
  } finally {
    if (lock) lock.release();
    await client.logout().catch(() => {});
  }
}

// The IMAP server of the account GuestFlow sends from: `smtp.<domain>` reads on `imap.<domain>`
// (smtp.gmail.com → imap.gmail.com). Any other host is kept as is. specs/airbnb-mail-intake.md rule 4.
function imapHostFor(smtpHost) {
  const host = String(smtpHost || '').trim();
  return /^smtp\./i.test(host) ? `imap.${host.slice(5)}` : host;
}

async function testConnection({ host, port = 993, user, password, ImapClient = null, smtpHostOf = coreSmtpHost }) {
  const client = new (ImapClient || ImapFlow)(connectionOptions({ host: resolveImapHost(smtpHostOf(), host), port, user, password }));
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.responseText || err.message || String(err) };
  }
}

module.exports = { MAX_PART_BYTES, MAX_MAILS_PER_PASS, readPart, readMailsFrom, testConnection, htmlToText, imapHostFor, resolveImapHost, connectionOptions };
