/**
 * Email address shape check — the one hardened helper (specs/audit-r2-injection.md rule 1).
 *
 * Linear by construction: the length is checked BEFORE anything scans the string, and the
 * check is one `indexOf` plus two bounded character-class tests, never a pattern whose
 * quantified classes overlap. A single public request used to freeze the event loop for 35 s
 * with `x@` followed by 200 000 dots.
 *
 * `isValidEmailAddress(value)` → true for `local@domain.tld` after trimming: one `@`, a local
 * part, a domain with a dot that is neither first nor last, no whitespace and none of
 * `@ , ; < > "`. Empty is NOT valid here; callers that accept empty test it themselves.
 * `MAX_EMAIL_LENGTH` is the RFC 5321 path limit.
 */

const MAX_EMAIL_LENGTH = 254;
const FORBIDDEN = /[\s@,;<>"]/;

function isValidEmailAddress(value) {
  const v = String(value == null ? '' : value).trim();
  if (v.length < 5 || v.length > MAX_EMAIL_LENGTH) return false;
  const at = v.indexOf('@');
  if (at < 1) return false;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (FORBIDDEN.test(local) || FORBIDDEN.test(domain)) return false;
  const dot = domain.lastIndexOf('.');
  return dot >= 1 && dot <= domain.length - 2;
}

module.exports = { isValidEmailAddress, MAX_EMAIL_LENGTH };
