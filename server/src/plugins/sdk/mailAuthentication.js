/**
 * Who really sent a mail, for the intake plugins (specs/airbnb-mail-intake.md rule 22,
 * specs/gites-de-france-mail-intake.md rule 20). IMAP `SEARCH FROM` is a substring match over the whole
 * From field, display name included, and says nothing about authenticity; both checks live here:
 *
 *   - `addressMatches` — the envelope's first From address equals a configured sender, case-insensitive;
 *   - `verifyDkim` — the `Authentication-Results` header written by the RECEIVING mailbox server reports
 *     `dkim=pass` for a signing domain (`header.d`, or the domain of `header.i`) that belongs to the sender.
 *
 * Only one `Authentication-Results` header is trusted: the one a server adds at the top of the message
 * it receives. Any other (added by the sender or a relay below it) is attacker-controlled text. When
 * the operator names the mailbox's `authserv-id`, the header must carry it; otherwise the first one
 * (the topmost, the last added) is the trusted one.
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

// RFC 8601 comments `( … )` can hold anything, nested.
function stripComments(value) {
  let out = '';
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') { if (depth > 0) depth -= 1; } else if (depth === 0) out += ch;
  }
  return out;
}

function parseAuthenticationResults(value) {
  const parts = stripComments(value).split(';').map((p) => p.trim()).filter(Boolean);
  const authservId = lower((parts.shift() || '').split(/\s+/)[0]);
  const results = parts.map((part) => {
    const [method, ...props] = part.split(/\s+/);
    const [name, result] = String(method).split('=');
    const properties = {};
    for (const prop of props) {
      const i = prop.indexOf('=');
      if (i > 0) properties[lower(prop.slice(0, i))] = prop.slice(i + 1).replace(/^"|"$/g, '');
    }
    return { method: lower(name), result: lower(result), properties };
  });
  return { authservId, results };
}

const signingDomain = ({ properties }) => lower(properties['header.d'] || properties.d || domainOf(properties['header.i'] || ''));

/**
 * @param {string|Buffer} headerBlock raw headers of the message, at least its Authentication-Results
 * @param {{domains: string[]|string, trustedAuthservId?: string}} options `domains`: signing domains
 *   accepted as the sender's own (the sender's domain by default, the caller's list otherwise)
 * @returns {{ok: boolean, reason: string}}
 */
function verifyDkim(headerBlock, { domains, trustedAuthservId = '' } = {}) {
  const accepted = toList(domains);
  if (accepted.length === 0) return { ok: false, reason: 'no-domain' };
  const trusted = lower(trustedAuthservId);
  const headers = splitHeaders(Buffer.isBuffer(headerBlock) ? headerBlock.toString('utf8') : headerBlock)
    .filter(([name]) => name === 'authentication-results').map(([, value]) => parseAuthenticationResults(value));
  if (headers.length === 0) return { ok: false, reason: 'no-authentication-results' };
  const header = trusted ? headers.find((h) => h.authservId === trusted) : headers[0];
  if (!header) return { ok: false, reason: 'untrusted-authserv-id' };
  const dkim = header.results.filter((r) => r.method === 'dkim');
  if (dkim.length === 0) return { ok: false, reason: 'no-dkim-result' };
  const passed = dkim.filter((r) => r.result === 'pass');
  if (passed.length === 0) return { ok: false, reason: 'dkim-not-pass' };
  return passed.some((r) => accepted.includes(signingDomain(r))) ? { ok: true, reason: 'dkim-pass' } : { ok: false, reason: 'dkim-domain-mismatch' };
}

module.exports = { addressMatches, verifyDkim, parseAuthenticationResults, domainOf, toList };
