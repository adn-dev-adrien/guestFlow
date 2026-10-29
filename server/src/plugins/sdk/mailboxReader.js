/**
 * Reads the mails of one sender from an IMAP mailbox, for the intake plugins
 * (specs/gites-de-france-mail-intake.md rule 1, specs/airbnb-mail-intake.md rule 4). Read-only: the
 * mailbox is opened with `readOnly`, nothing is flagged, moved or deleted — the operator's mail client
 * still sees every message as it was.
 *
 * Returns `[{ messageId, receivedAt, sentAt, subject, text, authenticated, authReason }]`, the text being
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

// Linear in the size of the mail: tags are cut with indexOf, never with a pattern that backtracks across `>`
// (specs/airbnb-mail-intake.md rule 26). The `alt` of an image is kept, the rest of the tag dropped.
const ALT_RE = /\balt="([^"]{0,500})"/i;
const STYLE_END = /<\/style/gi;
const MAX_TAG = 2000;

function stripTags(html) {
  let out = '';
  let i = 0;
  // The next `>` is the same for every `<` before it: looked up once, so a flood of `<` stays linear.
  let gtAt = -2;
  const nextGt = (from) => { if (gtAt !== -1 && gtAt < from) gtAt = html.indexOf('>', from); return gtAt; };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    const gt = nextGt(lt);
    if (gt < 0) { out += html.slice(lt); break; }
    if (gt - lt > MAX_TAG) { out += '<'; i = lt + 1; continue; }
    const tag = html.slice(lt + 1, gt);
    const name = (/^\/?([a-z][a-z0-9]*)/i.exec(tag) || [])[1] || '';
    const lower = name.toLowerCase();
    if (lower === 'style' && tag[0] !== '/') {
      STYLE_END.lastIndex = gt;
      const close = STYLE_END.exec(html);
      i = close ? (html.indexOf('>', close.index) + 1 || html.length) : html.length;
      continue;
    }
    if (lower === 'img') {
      const alt = ALT_RE.exec(tag);
      if (alt) out += ` ${alt[1]} `;
    } else if (tag[0] === '/' ? /^(p|div|tr|h\d|li)$/.test(lower) : lower === 'br') out += '\n';
    else if (tag[0] === '/' && /^(td|th)$/.test(lower)) out += '\t';
    i = gt + 1;
  }
  return out;
}

function htmlToText(html) {
  return stripTags(String(html || ''))
    .replace(/&nbsp;/g, ' ')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&euro;/g, '€')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
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
// cost the server memory or time. Returns `null` for an oversized part.
const MAX_PART_BYTES = 256 * 1024;

async function readPart(client, uid, part, maxBytes = MAX_PART_BYTES) {
  const { content } = await client.download(String(uid), part, { uid: true });
  const chunks = [];
  let size = 0;
  for await (const chunk of content) {
    size += chunk.length;
    if (size > maxBytes) { if (typeof content.destroy === 'function') content.destroy(); return null; }
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

async function readMailsFrom({
  host, port = 993, user, password, sender, allowedDomains = null, trustedAuthservId = '',
  sinceDays = 30, now = new Date(), ImapClient = ImapFlow, smtpHostOf = coreSmtpHost,
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
    for (const uid of uids || []) {
      const msg = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true, internalDate: true, headers: ['authentication-results'] }, { uid: true });
      if (!msg || !addressMatches(msg.envelope, sender)) continue;
      const auth = verifyDkim(msg.headers, { domains, trustedAuthservId: trusted });
      const plainPart = findPart(msg.bodyStructure, 'text/plain');
      const htmlPart = plainPart ? null : findPart(msg.bodyStructure, 'text/html');
      const partId = plainPart || htmlPart;
      const raw = partId ? await readPart(client, uid, partId) : '';
      if (raw === null) continue;
      out.push({
        messageId: (msg.envelope && msg.envelope.messageId) || `uid:${uid}`,
        receivedAt: new Date(msg.internalDate || (msg.envelope && msg.envelope.date) || now).toISOString(),
        sentAt: new Date((msg.envelope && msg.envelope.date) || msg.internalDate || now).toISOString(),
        subject: (msg.envelope && msg.envelope.subject) || '',
        text: plainPart ? raw : htmlToText(raw),
        authenticated: auth.ok,
        authReason: auth.reason,
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

module.exports = { MAX_PART_BYTES, readPart, readMailsFrom, testConnection, htmlToText, imapHostFor, resolveImapHost, connectionOptions };
