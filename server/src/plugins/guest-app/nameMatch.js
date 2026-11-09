/**
 * Name matching (specs/guest-app.md rule 7). Pure.
 *
 * Both sides are reduced to their letters: NFD, accents stripped, lower-case, every non-letter removed,
 * so `Le Goff-Durand` = `legoffdurand`. The comparison hashes both sides and checks every candidate, so
 * its duration says nothing about how close a guess was, nor about which name matched (rule 6).
 */

const crypto = require('crypto');

function normalizeName(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\P{L}/gu, '');
}

const digest = (text) => crypto.createHash('sha256').update(text, 'utf8').digest();

/** `candidates`: the names on file for the stay. An empty name never matches, on either side. */
function nameMatches(input, candidates) {
  const typed = normalizeName(input);
  const typedDigest = digest(typed);
  let matched = false;
  (candidates || []).forEach((candidate) => {
    const onFile = normalizeName(candidate);
    const same = crypto.timingSafeEqual(typedDigest, digest(onFile));
    if (same && onFile !== '') matched = true;
  });
  return matched;
}

module.exports = { normalizeName, nameMatches };
