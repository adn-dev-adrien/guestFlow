/**
 * Reads the mails of one sender from an IMAP mailbox, for the intake plugins
 * (specs/gites-de-france-mail-intake.md rule 1, specs/airbnb-mail-intake.md rule 4). Read-only: the
 * mailbox is opened with `readOnly`, nothing is flagged, moved or deleted — the operator's mail client
 * still sees every message as it was.
 *
 * Returns `[{ messageId, receivedAt, sentAt, subject, text, authenticated, authReason }]`, the text being
 * the plain-text part, or the HTML part reduced to text when the mail has no plain part.
 *
 * A mail is returned only when its envelope's first From address IS the sender (the IMAP search is a
 * substring match over the display name too). `authenticated` is true only when the receiving server's
 * `Authentication-Results` reports `dkim=pass` for the sender's domain (or `allowedDomains`); an
 * unauthenticated mail is still returned, flagged, for the caller to propose and never auto-apply
 * (specs/airbnb-mail-intake.md rule 22). `trustedAuthservId` names the mailbox server whose header counts
 * (default: the first Authentication-Results header).
 */

const { ImapFlow } = require('imapflow');
const { addressMatches, verifyDkim, domainOf, toList } = require('./mailAuthentication');

function htmlToText(html) {
  return String(html || '')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
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

async function readPart(client, uid, part) {
  const { content } = await client.download(String(uid), part, { uid: true });
  const chunks = [];
  for await (const chunk of content) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// The password never travels in clear (specs/airbnb-mail-intake.md rule 23): implicit TLS on 993, and on
// any other port the connection must upgrade with STARTTLS or it is refused.
function connectionOptions({ host, port = 993, user, password }) {
  const implicit = Number(port) === 993;
  return { host, port: Number(port), secure: implicit, doSTARTTLS: implicit ? undefined : true, auth: { user, pass: password }, logger: false };
}

// The password of the SMTP account is only ever offered to a host of the same domain as the SMTP server
// (smtp.example.com → imap.example.com, mail.example.com, example.com). A configured host elsewhere is
// ignored: the derived one is used.
function resolveImapHost(smtpHost, configured) {
  const smtp = String(smtpHost || '').trim().toLowerCase();
  const wanted = String(configured || '').trim().toLowerCase();
  const derived = imapHostFor(smtp);
  if (!wanted) return derived;
  const labels = smtp.split('.');
  const parent = labels.length >= 3 ? labels.slice(1).join('.') : smtp;
  return wanted === smtp || wanted === parent || wanted.endsWith(`.${parent}`) ? wanted : derived;
}

async function readMailsFrom({
  host, port = 993, user, password, sender, allowedDomains = null, trustedAuthservId = '',
  sinceDays = 30, now = new Date(), ImapClient = ImapFlow,
}) {
  const domains = toList(allowedDomains).length ? allowedDomains : domainOf(sender);
  const client = new ImapClient(connectionOptions({ host, port, user, password }));
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
      const auth = verifyDkim(msg.headers, { domains, trustedAuthservId });
      const plainPart = findPart(msg.bodyStructure, 'text/plain');
      const htmlPart = plainPart ? null : findPart(msg.bodyStructure, 'text/html');
      const raw = plainPart ? await readPart(client, uid, plainPart) : htmlPart ? await readPart(client, uid, htmlPart) : '';
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

async function testConnection({ host, port = 993, user, password, ImapClient = null }) {
  const client = new (ImapClient || ImapFlow)(connectionOptions({ host, port, user, password }));
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.responseText || err.message || String(err) };
  }
}

module.exports = { readMailsFrom, testConnection, htmlToText, imapHostFor, resolveImapHost, connectionOptions };
