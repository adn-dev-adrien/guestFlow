/**
 * ARTICLE FULFILMENT — the registry of the downstream bookings an article may name (specs/pricing-components.md §3 rules 49, 57).
 *
 * An article names an adapter by id (`config.fulfilment`, today `'hourly-slot'` for a resource sold by the hour and placed on a
 * planning). An adapter is a plain object `{ id, reserve(draft, ctx), confirm(hold, line, tx), release(hold, reason) }`, declared by a
 * plugin through `ctx.articleFulfilment(id, adapter)` and asked only while that plugin is live:
 *
 *   reserve(draft, ctx) → { hold: { id, expiresAt } } | { refusal: { code, message } }   a hold on the slot; nothing is written
 *   confirm(hold, line, tx) → { ok: true } | { refusal: { code, message } }               inside the sale transaction, before the line is written
 *   release(hold, reason)                                                                  a cancelled line, a lapsed hold, a refund
 *
 * The functions below are the only way the core calls an adapter. An adapter that throws refuses (`FULFILMENT_FAILED`); a refusal
 * at `confirm` aborts the sale (`SLOT_TAKEN` for the slot adapter). An article whose adapter is not live needs no booking: `reserve`
 * answers no hold. Pure registry: no DB, no clock.
 */
const MEMBERS = Object.freeze(['reserve', 'confirm', 'release']);
const adapters = new Map();

function register(id, adapter, { owner = null, isLive = () => true } = {}) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(String(id || ''))) throw new Error('A fulfilment adapter needs an id like "hourly-slot"');
  for (const member of MEMBERS) {
    if (!adapter || typeof adapter[member] !== 'function') throw new Error(`Fulfilment adapter "${id}" lacks "${member}"`);
  }
  // The same owner declares again when it is reloaded; another owner may not take the id.
  const existing = adapters.get(id);
  if (existing && (existing.owner !== owner || owner === null)) {
    throw Object.assign(new Error(`Fulfilment adapter "${id}" is already declared`), { code: 'DUPLICATE_FULFILMENT' });
  }
  adapters.set(id, { adapter, owner, isLive });
}

function unregister(id) {
  adapters.delete(id);
}

const live = (id) => {
  const entry = adapters.get(id);
  return entry && entry.isLive() ? entry.adapter : null;
};

const failed = (err) => ({ refusal: { code: 'FULFILMENT_FAILED', message: String((err && err.message) || err) } });

function reserve(id, draft, ctx = {}) {
  const adapter = live(id);
  if (!adapter) return { hold: null };
  try { return adapter.reserve(draft, ctx) || { hold: null }; } catch (err) { return failed(err); }
}

function confirm(id, hold, line, tx) {
  const adapter = live(id);
  if (!adapter) return { ok: true };
  try { return adapter.confirm(hold, line, tx) || { ok: true }; } catch (err) { return failed(err); }
}

function release(id, hold, reason) {
  const adapter = live(id);
  if (!adapter) return;
  try { adapter.release(hold, reason); } catch (err) { console.error(`[fulfilment:${id}] release failed:`, err && err.message); } // eslint-disable-line no-console
}

const fulfilmentOf = (article) => (article && article.config && article.config.fulfilment) || null;

module.exports = {
  register, unregister, reserve, confirm, release, fulfilmentOf, MEMBERS,
};
