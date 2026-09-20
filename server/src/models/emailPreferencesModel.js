/**
 * Guest email preferences — the unsubscribe token and state of a client
 * (specs/guest-email-sequence.md §3.2 rule 9, §4.3).
 *
 * The token is a per-client random capability (same generator and constant-time comparison as the
 * public devis token), minted lazily the first time a season email is rendered for that client.
 * Unsubscribing only stamps `marketingUnsubscribedAt`: the stay emails (1-4) keep leaving.
 *
 * API:
 *   ensureToken(clientId) → token
 *   findByToken(token) → { id, marketingUnsubscribedAt } | null
 *   unsubscribe(clientId) → true when this call changed the state
 */

const { generateToken, tokensMatch } = require('../utils/publicDevisToken');

function buildModel(database) {
  function ensureToken(clientId) {
    const row = database.prepare('SELECT emailPreferencesToken FROM clients WHERE id = ?').get(Number(clientId));
    if (!row) return '';
    if (row.emailPreferencesToken) return row.emailPreferencesToken;
    const token = generateToken();
    database.prepare("UPDATE clients SET emailPreferencesToken = ? WHERE id = ? AND COALESCE(emailPreferencesToken, '') = ''")
      .run(token, Number(clientId));
    return database.prepare('SELECT emailPreferencesToken FROM clients WHERE id = ?').get(Number(clientId)).emailPreferencesToken;
  }

  function findByToken(token) {
    const t = String(token || '');
    if (!t || t.length > 128) return null;
    const row = database.prepare(
      'SELECT id, emailPreferencesToken, marketingUnsubscribedAt FROM clients WHERE emailPreferencesToken = ?'
    ).get(t);
    if (!row || !tokensMatch(row.emailPreferencesToken, t)) return null;
    return { id: row.id, marketingUnsubscribedAt: row.marketingUnsubscribedAt || null };
  }

  function unsubscribe(clientId) {
    const info = database.prepare(
      "UPDATE clients SET marketingUnsubscribedAt = datetime('now') WHERE id = ? AND marketingUnsubscribedAt IS NULL"
    ).run(Number(clientId));
    return info.changes > 0;
  }

  return { ensureToken, findByToken, unsubscribe };
}

function unsubscribeUrl(publicUrl, token) {
  const base = String(publicUrl || '').trim().replace(/\/+$/, '');
  if (!base || !token) return '';
  return `${base}/preferences/emails?t=${encodeURIComponent(token)}`;
}

const defaultModel = (() => {
  try {
    return buildModel(require('../database'));
  } catch {
    return null;
  }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  defaultModel.unsubscribeUrl = unsubscribeUrl;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel, unsubscribeUrl };
}
