/**
 * Detached Ed25519 signature over a release's `SHA256SUMS` (specs/self-update-and-releases.md rule 40).
 *
 * The signing key is held by the maintainer, never by GitHub; the installer is configured with the
 * matching public key (`GUESTFLOW_RELEASE_PUBLIC_KEY`, base64 DER SPKI, same encoding as the licence
 * and registry keys). With no key configured nothing is checked — the historical behaviour; with a
 * key configured an unsigned or wrongly signed release is refused.
 */

const crypto = require('crypto');

const SIGNATURE_ASSET_NAME = 'SHA256SUMS.sig';

function toKey(publicKey) {
  if (!publicKey) return null;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(String(publicKey).trim(), 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

/** The configured release public key, or null when releases are not required to be signed. */
function releasePublicKeyFromEnv(env = process.env) {
  return (env.GUESTFLOW_RELEASE_PUBLIC_KEY || '').trim() || null;
}

/** Base64 Ed25519 signature of the exact `SHA256SUMS` bytes. */
function signSums(sumsText, privateKey) {
  return crypto.sign(null, Buffer.from(sumsText), privateKey).toString('base64');
}

/**
 * Check `sums` (the raw bytes of SHA256SUMS, as downloaded) against the detached signature when a public key is configured.
 * `fetchSignature()` returns the signature text; it is only called when a key is configured.
 * Throws SIGNATURE_KEY_INVALID, SIGNATURE_MISSING or SIGNATURE_INVALID; resolves true when verified,
 * false when no key is configured.
 */
async function assertSumsSigned({ sums, signature, publicKey, fetchSignature }) {
  if (!publicKey) return false;
  const key = toKey(publicKey);
  if (!key) throw new Error('SIGNATURE_KEY_INVALID');
  if (!signature) throw new Error('SIGNATURE_MISSING');
  const text = await fetchSignature(signature);
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(sums), key, Buffer.from(String(text).trim(), 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('SIGNATURE_INVALID');
  return true;
}

module.exports = { SIGNATURE_ASSET_NAME, releasePublicKeyFromEnv, signSums, assertSumsSigned };
