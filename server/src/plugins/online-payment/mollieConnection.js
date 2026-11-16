/**
 * The optional « Compte Mollie » of the plugin (specs/mollie-rolling-reserve-and-incoming-payments.md rules 14-17): an
 * advanced access token, kept encrypted as a plugin secret, that lets the reconciliation read the settlements behind the
 * Mollie credits. Read-only. The token is never logged, never put in a message, never returned by any endpoint.
 */

const { buildMollieClient, explainError } = require('./mollieClient');
const { syncSettlements } = require('./reconciliation/mollieSettlements');
const { invoiceSources } = require('./reconciliation/mollieCardSources');

const TOKEN_PREFIX = 'access_';
const NOT_A_TOKEN = 'Ce n\'est pas un jeton d\'accès Mollie : il commence par access_';
const NO_TOKEN = 'Aucun jeton Mollie enregistré.';

/** Rule 15 — what the settings PUT and « Tester » refuse before any call. '' and null are not refused (they keep / clear). */
const tokenMessage = (value) => {
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim().startsWith(TOKEN_PREFIX) ? null : NOT_A_TOKEN;
};

/** Rule 14 — what Mollie still holds, as the card shows it: `pendingAmount` of the primary balance (the reserves not released yet). */
const balanceView = (stored) => (stored ? {
  pendingCents: Number(stored.pendingCents) || 0, pendingAmount: (Number(stored.pendingCents) || 0) / 100,
  availableCents: Number(stored.availableCents) || 0, at: stored.at || null,
} : null);

/**
 * @param {object} deps
 * @param {{ get(key): string, set(key, value): void }} deps.settings  ctx.settings
 * @param {object} deps.db
 * @param {object} deps.settlements  the settlements model
 * @param {Function} [deps.buildClient]  `({ token }) → mollieClient` (tests inject a fake)
 * @param {() => Date} [deps.now]
 */
function createMollieConnection({ settings, db, settlements, buildClient = ({ token }) => buildMollieClient({ token }), now = () => new Date() }) {
  const token = () => String(settings.get('mollieAccessToken') || '').trim();
  const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

  const paidLinks = () => db.prepare("SELECT * FROM payment_links WHERE status = 'paid'").all();
  const invoices = () => invoiceSources(now().toISOString().slice(0, 10));

  return {
    configured: () => token() !== '',

    /** What the card shows: the token is only ever « set » or not. */
    status() {
      return {
        configured: token() !== '',
        profileId: String(settings.get('mollieProfileId') || ''),
        lastRead: parse(settings.get('mollieLastRead')),
        lastError: parse(settings.get('mollieLastError')),
        balance: balanceView(parse(settings.get('mollieBalance'))),
        settlements: settlements.count(),
      };
    },

    /**
     * Rules 16-17 — reads what the stored credits name. Never throws and never blocks the reconciliation: a failure is
     * kept in words for the card and what was read before stays.
     */
    async sync({ credits, splits }) {
      const at = now().toISOString();
      try {
        const client = buildClient({ token: token() });
        if (typeof client.getBalance === 'function') {
          try {
            const balance = await client.getBalance();
            settings.set('mollieBalance', JSON.stringify({ at, pendingCents: balance.pendingCents, availableCents: balance.availableCents }));
          } catch { /* `balances.read` is optional: the card just shows no pending amount */ }
        }
        const result = await syncSettlements({
          client, model: settlements, splits, settings, credits, links: paidLinks(),
          invoiceSources: invoices(), profileId: String(settings.get('mollieProfileId') || ''), now: now(),
        });
        settings.set('mollieLastRead', JSON.stringify({ at, settlements: result.read, unknownPayments: result.unknownPayments, balances: result.balances }));
        // Rule 17 — a settlement that could not be read is told in words; the ones that could were stored all the same.
        const failed = result.failed || [];
        settings.set('mollieLastError', failed.length === 0 ? '' : JSON.stringify({
          at, message: failed.length === 1 ? `Règlement ${failed[0].reference} : ${failed[0].message}` : `${failed.length} règlements illisibles (premier : ${failed[0].reference}) — ${failed[0].message}`,
        }));
        return { ok: failed.length === 0, ...result };
      } catch (err) {
        settings.set('mollieLastError', JSON.stringify({ at, message: explainError(err) }));
        return { ok: false, read: 0, unknownPayments: 0 };
      }
    },

    /** Rule 15 — « Tester »: one settlement is enough to prove the token reads them; fills the profile of an organisation token. */
    async test({ token: typed } = {}) {
      const candidate = typed != null && String(typed).trim() !== '' ? String(typed).trim() : token();
      if (candidate === '') return { status: 400, body: { ok: false, settlements: 0, error: NO_TOKEN } };
      const refused = tokenMessage(candidate);
      if (refused) return { status: 400, body: { ok: false, settlements: 0, error: refused } };
      const client = buildClient({ token: candidate });
      try {
        const found = await client.listSettlements({ limit: 1 });
        let profileId = String(settings.get('mollieProfileId') || '');
        if (!profileId) {
          try {
            const profiles = await client.listProfiles();
            const pick = profiles.find((p) => p.mode === 'live') || profiles[0];
            // A token typed but not saved yet belongs to no one: its profile is told, never stored (it could be another account's).
            if (pick) { profileId = pick.id; if (candidate === token()) settings.set('mollieProfileId', profileId); }
          } catch { /* `profiles.read` is optional: the profile is only needed to list payments of an organisation token */ }
        }
        return { status: 200, body: { ok: true, settlements: found.length, profileId } };
      } catch (err) {
        return { status: 200, body: { ok: false, settlements: 0, error: explainError(err) } };
      }
    },
  };
}

module.exports = { createMollieConnection, tokenMessage, NOT_A_TOKEN };
