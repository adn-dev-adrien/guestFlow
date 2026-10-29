/**
 * Who really sent a mail, for the intake plugins (specs/airbnb-mail-intake.md rule 22,
 * specs/gites-de-france-mail-intake.md rule 20). IMAP `SEARCH FROM` is a substring match over the whole
 * From field, display name included, and says nothing about authenticity; both checks live here:
 *
 *   - `addressMatches` — the header From address equals a configured sender, case-insensitive;
 *   - `verifyDkim` — the `Authentication-Results` header written by the RECEIVING mailbox server reports
 *     `dkim=pass` for a signing domain (`header.d`, or the domain of `header.i`) that belongs to the sender.
 *
 * Only the `Authentication-Results` header written by the mailbox's own server is trusted, found by its
 * `authserv-id` (a provider's known name, or the one the operator sets). Any other — added by the sender
 * or a relay — is attacker-controlled text, and with no name to look for, nothing is trusted.
 */

const lower = (v) => String(v || '').trim().toLowerCase();

const toList = (value) => (Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/)).map(lower).filter(Boolean);

const domainOf = (address) => lower(address).split('@').pop();

function addressMatches(envelope, senders) {
  const wanted = toList(senders);
  const from = envelope && Array.isArray(envelope.from) ? envelope.from[0] : null;
  const address = lower(from && from.address);
  return Boolean(address) && wanted.includes(address);
}

// The header block as a list of `[name, value]`, continuation lines unfolded.
function splitHeaders(block) {
  const unfolded = String(block || '').replace(/\r?\n[ \t]+/g, ' ');
  return unfolded.split(/\r?\n/).map((line) => {
    const i = line.indexOf(':');
    return i > 0 ? [lower(line.slice(0, i)), line.slice(i + 1).trim()] : null;
  }).filter(Boolean);
}

/*
 * RFC 8601 tokenizer. `;` separates resinfos and spaces separate their parts only OUTSIDE a quoted string
 * and a comment; a comment `( … )` nests and may hold quoted strings; `\` escapes in both. A quoted value
 * such as `smtp.mailfrom="x;dkim=pass header.d=gdf07.com;y"@attacker.tld` therefore stays one token of the
 * `smtp` resinfo and can never be read as a `dkim` result.
 */
function tokenize(value) {
  const resinfos = [[]];
  let token = '';
  let hasToken = false;
  let quoted = false;
  let depth = 0;
  let inCommentQuote = false;
  const flush = () => { if (hasToken) resinfos[resinfos.length - 1].push(token); token = ''; hasToken = false; };
  const chars = [...String(value || '')];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (depth > 0) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inCommentQuote = !inCommentQuote;
      else if (!inCommentQuote && ch === '(') depth += 1;
      else if (!inCommentQuote && ch === ')') { depth -= 1; if (depth === 0) inCommentQuote = false; }
    } else if (quoted) {
      if (ch === '\\' && i + 1 < chars.length) { i += 1; token += chars[i]; } else if (ch === '"') quoted = false; else token += ch;
    } else if (ch === '"') { quoted = true; hasToken = true; } else if (ch === '(') depth = 1;
    else if (ch === ';') { flush(); resinfos.push([]); } else if (/\s/.test(ch)) flush();
    else { token += ch; hasToken = true; }
  }
  flush();
  return resinfos.filter((r) => r.length);
}

function parseAuthenticationResults(value) {
  const [head = [], ...rest] = tokenize(value);
  const authservId = lower(head[0]);
  const results = rest.map(([first, ...props]) => {
    const [name, result] = String(first).split('=');
    const properties = {};
    for (const prop of props) {
      const i = prop.indexOf('=');
      if (i > 0) properties[lower(prop.slice(0, i))] = prop.slice(i + 1);
    }
    return { method: lower(name), result: lower(result), properties };
  });
  return { authservId, results };
}

const signingDomain = ({ properties }) => lower(properties['header.d'] || domainOf(properties['header.i'] || ''));

// The server name a provider writes in the Authentication-Results of the mail it receives. Anywhere else
// the operator names it; with neither, nothing is trusted.
function defaultAuthservId(smtpHost) {
  return /^(smtp|imap|smtp-relay)\.(gmail|googlemail)\.com$/i.test(String(smtpHost || '').trim()) ? 'mx.google.com' : '';
}

/**
 * @param {string|Buffer} headerBlock raw headers of the message, at least its Authentication-Results
 * @param {{domains: string[]|string, trustedAuthservId: string}} options `domains`: signing domains
 *   accepted as the sender's own; `trustedAuthservId`: the mailbox server whose header counts — required,
 *   since a header added below the server's, or by the sender, is attacker text
 * @returns {{ok: boolean, reason: string}}
 */
function verifyDkim(headerBlock, { domains, trustedAuthservId = '' } = {}) {
  const accepted = toList(domains);
  if (accepted.length === 0) return { ok: false, reason: 'no-domain' };
  const trusted = lower(trustedAuthservId);
  if (!trusted) return { ok: false, reason: 'no-trusted-authserv-id' };
  const headers = splitHeaders(Buffer.isBuffer(headerBlock) ? headerBlock.toString('utf8') : headerBlock)
    .filter(([name]) => name === 'authentication-results').map(([, value]) => parseAuthenticationResults(value));
  if (headers.length === 0) return { ok: false, reason: 'no-authentication-results' };
  const header = headers.find((h) => h.authservId === trusted);
  if (!header) return { ok: false, reason: 'untrusted-authserv-id' };
  // Only the results written before the first `smtp.*` one count: whatever the server echoes of the
  // envelope (a MAIL FROM it failed to quote) comes after the dkim verdicts.
  const echoAt = header.results.findIndex((r) => Object.keys(r.properties).some((k) => k.startsWith('smtp.')));
  const dkim = (echoAt < 0 ? header.results : header.results.slice(0, echoAt)).filter((r) => r.method === 'dkim');
  if (dkim.length === 0) return { ok: false, reason: 'no-dkim-result' };
  const passed = dkim.filter((r) => r.result === 'pass');
  if (passed.length === 0) return { ok: false, reason: 'dkim-not-pass' };
  return passed.some((r) => accepted.includes(signingDomain(r))) ? { ok: true, reason: 'dkim-pass' } : { ok: false, reason: 'dkim-domain-mismatch' };
}

module.exports = { addressMatches, verifyDkim, parseAuthenticationResults, defaultAuthservId, domainOf, toList };
