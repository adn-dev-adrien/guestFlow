/**
 * The payment-link webhook subscribes itself.
 * See specs/settings-one-save-and-automatic-webhook.md §3 rules 7-11.
 *
 * Until 2026-09-16 the subscription was an operator's job: invent a secret, paste it into a field,
 * press « Enregistrer le webhook ». Nothing in that sequence needed a human — and the secret was on
 * screen in clear while being typed, which is the one thing that must never happen.
 *
 * The cardinal rule here is rule 8: **never create a second subscription**. Qonto has no way to tell
 * us the secret of a subscription it already holds, so a duplicate would deliver events signed with a
 * key we cannot verify, and the first one would keep delivering too. When Qonto already answers at our
 * address, we adopt what is there and touch nothing.
 */

const crypto = require('crypto');

const settingsModelDefault = require('../models/settingsModel');
const { resolveQontoConfig } = require('./qontoConfig');
const { withQonto, recordQontoFailure } = require('./qontoService');

const WEBHOOK_PATH = '/api/payments/qonto/webhook';
const SUBSCRIPTION_TYPES = ['v1/payment-links'];
const DESCRIPTION = 'GuestFlow payment links';

/** Rule 9: 32 random bytes in hexadecimal — 64 characters, inside Qonto's 32-128 range. */
const defaultRandomSecret = () => crypto.randomBytes(32).toString('hex');

const missingPublicUrlError = () => {
  const err = new Error("L'URL publique de GuestFlow n'est pas configurée (Réglages → Envoi d'emails).");
  err.code = 'PUBLIC_URL_MISSING';
  return err;
};

/** Two callback URLs are the same subscription when only a trailing slash separates them. */
const sameCallback = (a, b) => String(a || '').trim().replace(/\/+$/, '') === String(b || '').trim().replace(/\/+$/, '');

/**
 * Make sure Qonto is subscribed to payment-link events at the address GuestFlow answers on.
 *
 * Never throws and never interrupts its caller (rule 11): the OAuth callback and the poll pass both
 * call it for its side effect, and a Qonto outage must not cost an authorisation or a reconciliation.
 *
 * @returns {Promise<{action: 'skipped'|'adopted'|'created'|'unconfigured'|'failed', id?: string, callbackUrl?: string, error?: Error}>}
 */
async function ensureWebhookSubscription({
  settings = settingsModelDefault,
  env = process.env,
  origin = 'webhook-register',
  randomSecret = defaultRandomSecret,
} = {}) {
  try {
    const base = typeof settings.publicUrl === 'function' ? String(settings.publicUrl() || '').trim() : '';
    if (!base) {
      // Rule 11: recorded like any other Qonto failure, so the operator sees *why* the webhook is
      // missing on the page that can fix it — instead of a webhook that silently never arrives.
      recordQontoFailure({ settings, error: missingPublicUrlError(), origin });
      return { action: 'unconfigured' };
    }
    const callbackUrl = `${base.replace(/\/+$/, '')}${WEBHOOK_PATH}`;

    // Rule 10: the recorded subscription still points where we answer → nothing to ask Qonto.
    const known = typeof settings.qontoWebhookSubscription === 'function' ? settings.qontoWebhookSubscription() : { id: '', callbackUrl: '' };
    if (known.id && sameCallback(known.callbackUrl, callbackUrl)) {
      return { action: 'skipped', id: known.id, callbackUrl };
    }

    // `recordSuccess: false` — this is housekeeping, not a diagnosis. Recording a success here would
    // erase the outcome « Tester la connexion » had just recorded, and the page would claim a
    // connection the test had refused.
    return await withQonto({ settings, env, origin, recordSuccess: false }, async (client, accessToken) => {
      const existing = await client.listWebhookSubscriptions({ accessToken });
      const match = (existing || []).find((s) => sameCallback(s.callbackUrl, callbackUrl));

      // Rule 8 — adopt, never duplicate. The secret Qonto signs with stays the one it already has,
      // which is the one already stored here; we have no way to read it back to compare, and no
      // reason to: it has been verifying deliveries since the subscription was created.
      if (match) {
        settings.storeQontoWebhookSubscription({ id: match.id, callbackUrl });
        return { action: 'adopted', id: match.id, callbackUrl };
      }

      // Rule 9 — a secret is generated only when none is stored. An installation that already has
      // one (from `.env.local` or from the old form) keeps it, so re-creating a subscription after
      // a public-address change does not invalidate anything.
      const config = resolveQontoConfig({ settings, env });
      let secret = config.webhookSecret;
      if (!secret) {
        secret = randomSecret();
        settings.storeQontoCredentials({ webhookSecret: secret });
      }

      const sub = await client.createWebhookSubscription({
        accessToken, callbackUrl, types: SUBSCRIPTION_TYPES, secret, description: DESCRIPTION,
      });
      settings.storeQontoWebhookSubscription({ id: sub.id, callbackUrl });
      return { action: 'created', id: sub.id, callbackUrl };
    });
  } catch (error) {
    // `withQonto` already recorded the failure; swallowing it here is rule 11's "never interrupts".
    return { action: 'failed', error };
  }
}

module.exports = { ensureWebhookSubscription, WEBHOOK_PATH, SUBSCRIPTION_TYPES, __test: { sameCallback } };
