/**
 * The prepaid instruments a plugin declared with `ctx.prepaid(...)` (SDK 2.33.0, specs/mixed-method-payments.md rule 51): an
 * amount a guest already paid, somewhere else, and that a plugin keeps the balance of (a stored credit, a prepaid card...).
 * The core never names one: it asks the live plugin that owns a `source`, through the five calls it declared —
 *
 *   apply({ devisId, input, capCents, visitor, dryRun, consumer }) → { ok: true, heldCents, display } | { ok: false, status, code, message }
 *       holds (or, with `dryRun`, only prices) what `input` — the opaque `prepaid` field of the booking request — is worth
 *       on that quote, never more than `capCents`; it runs inside the caller's transaction. `consumer` names what the caller sells —
 *       `lodging` (the default: a stay) or `resource:<id>` — so an instrument that is good for one kind only can refuse the other;
 *   held(devisId)                      → { amountCents, display } | null     what is held for the quote now
 *   settle({ devisId, reservationId, amountCents, paidDate }) → { ref } | null
 *       the quote became a stay: `amountCents` is used, the rest of the hold is given back;
 *   release({ devisId, reason })       the quote was refused, deleted or lapsed unpaid: the hold is given back.
 *
 * What a source holds for a quote lowers what the public payment asks for (`reductionCents`), and is recorded on the stay as
 * money received by `prepaidReceipts`.
 */

const registry = require('../plugins/sdk/registry');

function liveSources() {
  return registry.all()
    .filter((r) => registry.isLive(r.id))
    .flatMap((r) => (r.prepaidSources || []).map((s) => ({ pluginId: r.id, ...s })));
}

const byKind = (kind) => liveSources().find((s) => s.source === kind) || null;

const labelOf = (source) => (liveSources().find((s) => s.source === source) || {}).label || 'Prépayé';

/** Every live source's hold on a quote: `[{ source, label, amountCents, display }]`. */
function heldFor(devisId) {
  return liveSources().flatMap((s) => {
    const held = s.held(Number(devisId));
    return held && held.amountCents > 0 ? [{ source: s.source, label: s.label, amountCents: held.amountCents, display: held.display || null }] : [];
  });
}

const heldCentsFor = (devisId) => heldFor(devisId).reduce((sum, h) => sum + h.amountCents, 0);

/**
 * What the holds take off a public payment now: the earliest amounts first — the acompte, then the solde — so a link asking
 * `askedCents` (the acompte of a `deposit` mode, the whole pre-arrival amount of a `full` one) asks that less what is held.
 */
function reductionCents(devisId, askedCents) {
  return Math.min(heldCentsFor(devisId), Math.max(0, askedCents));
}

/** Takes `reduction` off a VAT basket, the taxable stay line first, then the tax line: the components still add up to the charge. */
function reduceComponents(built, reduction) {
  if (!built || !Array.isArray(built.components) || !(reduction > 0)) return built;
  let left = reduction;
  const components = [...built.components].sort((a, b) => Number(Boolean(b.taxable)) - Number(Boolean(a.taxable)))
    .map((c) => {
      const taken = Math.min(left, c.grossCents);
      left -= taken;
      return { ...c, grossCents: c.grossCents - taken };
    })
    .filter((c) => c.grossCents > 0);
  return { ...built, components };
}

/** The request's `prepaid` field, held for the quote just created. → the source's answer, or `{ ok: false, ... }` for an unknown kind. */
function apply(devisId, input, {
  capCents, visitor, dryRun = false, consumer = 'lodging',
} = {}) {
  const source = input && typeof input === 'object' ? byKind(input.kind) : null;
  if (!source) return { ok: false, status: 400, code: 'PREPAID_UNAVAILABLE', message: 'Moyen de paiement indisponible.' };
  const answer = source.apply({
    devisId: devisId == null ? null : Number(devisId), input, capCents, visitor, dryRun, consumer,
  });
  return { ...answer, source: source.source, label: source.label };
}

/** The quote is gone or lapsed: every live source gives back what it held. */
function releaseFor(devisId, reason) {
  liveSources().forEach((s) => {
    try { s.release({ devisId: Number(devisId), reason }); } catch (err) { console.error(`[plugin:${s.pluginId}] prepaid release failed:`, err && err.message); } // eslint-disable-line no-console
  });
}

module.exports = {
  liveSources, byKind, labelOf, heldFor, heldCentsFor, reductionCents, reduceComponents, apply, releaseFor,
};
