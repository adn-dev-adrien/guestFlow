/**
 * Reads the mails of one sender from an IMAP mailbox, for the intake plugins
 * (specs/gites-de-france-mail-intake.md rule 1, specs/airbnb-mail-intake.md rule 4). Read-only: the
 * mailbox is opened with `readOnly`, nothing is flagged, moved or deleted — the operator's mail client
 * still sees every message as it was.
 *
 * Returns `[{ messageId, receivedAt, sentAt, subject, text }]`, the text being the plain-text part, or
 * the HTML part reduced to text when the mail has no plain part.
 */

const { ImapFlow } = require('imapflow');

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

async function readMailsFrom({ host, port = 993, user, password, sender, sinceDays = 30, now = new Date() }) {
  const client = new ImapFlow({ host, port: Number(port), secure: Number(port) === 993, auth: { user, pass: password }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX', { readOnly: true });
  try {
    const since = new Date(now.getTime() - sinceDays * 24 * 3600 * 1000);
    const uids = await client.search({ from: sender, since }, { uid: true });
    const out = [];
    for (const uid of uids || []) {
      const msg = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true, internalDate: true }, { uid: true });
      if (!msg) continue;
      const plainPart = findPart(msg.bodyStructure, 'text/plain');
      const htmlPart = plainPart ? null : findPart(msg.bodyStructure, 'text/html');
      const raw = plainPart ? await readPart(client, uid, plainPart) : htmlPart ? await readPart(client, uid, htmlPart) : '';
      out.push({
        messageId: (msg.envelope && msg.envelope.messageId) || `uid:${uid}`,
        receivedAt: new Date(msg.internalDate || (msg.envelope && msg.envelope.date) || now).toISOString(),
        sentAt: new Date((msg.envelope && msg.envelope.date) || msg.internalDate || now).toISOString(),
        subject: (msg.envelope && msg.envelope.subject) || '',
        text: plainPart ? raw : htmlToText(raw),
      });
    }
    return out;
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

// The IMAP server of the account GuestFlow sends from: `smtp.<domain>` reads on `imap.<domain>`
// (smtp.gmail.com → imap.gmail.com). Any other host is kept as is. specs/airbnb-mail-intake.md rule 4.
function imapHostFor(smtpHost) {
  const host = String(smtpHost || '').trim();
  return /^smtp\./i.test(host) ? `imap.${host.slice(5)}` : host;
}

async function testConnection({ host, port = 993, user, password }) {
  const client = new ImapFlow({ host, port: Number(port), secure: Number(port) === 993, auth: { user, pass: password }, logger: false });
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.responseText || err.message || String(err) };
  }
}

module.exports = { readMailsFrom, testConnection, htmlToText, imapHostFor };
