/**
 * The opaque `prepaid` field of the public quote and booking request (SDK 2.31.0, specs/mixed-method-payments.md rule 51). This
 * plugin knows nothing of what it names: the core asks the live plugin that owns the `kind` (`ctx.prepaid`) what the amount is
 * worth on this stay, and this file only shapes what the page shows — the amount applied and « À payer aujourd'hui », both
 * computed here, never by the site.
 */

const sdk = require('../sdk');

const prepaidSources = sdk.coreModule('prepaidSources');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The request's `prepaid` field: null when absent, `{ error }` when it names nothing live, else the field itself. */
function read(body) {
  if (!body || body.prepaid === undefined || body.prepaid === null) return null;
  const field = body.prepaid;
  if (!isObject(field) || typeof field.kind !== 'string' || !prepaidSources.byKind(field.kind)) return { error: 'PREPAID_UNAVAILABLE' };
  return field;
}

/** What a hold of `heldCents` leaves to pay today in `mode`: the earliest amounts first, the acompte then the solde (rule 38). */
function amounts({ mode, depositCents, balanceCents, heldCents }) {
  const totalCents = depositCents + balanceCents;
  const askedCents = mode === 'deposit' ? depositCents : totalCents;
  const appliedCents = Math.min(Math.max(0, heldCents), totalCents);
  return { appliedCents, dueTodayCents: askedCents - Math.min(appliedCents, askedCents) };
}

/** The block the page renders. */
const projection = (answer, figures) => ({
  label: answer.display && answer.display.label ? answer.display.label : answer.label,
  appliedCents: figures.appliedCents,
  dueTodayCents: figures.dueTodayCents,
  balanceLeftCents: answer.display && answer.display.balanceCents != null ? Math.max(0, answer.display.balanceCents - figures.appliedCents) : null,
});

/** What the page needs of a refusal: the code, the sentence, and the figures that go with it. */
const refusal = (answer) => ({
  code: answer.code,
  message: answer.message,
  ...(answer.balanceCents != null ? { balanceCents: answer.balanceCents } : {}),
  ...(answer.triesLeft != null ? { triesLeft: answer.triesLeft } : {}),
  ...(answer.expiresOn ? { expiresOn: answer.expiresOn } : {}),
  ...(answer.retryAfterSeconds ? { retryAfterSeconds: answer.retryAfterSeconds } : {}),
});

/** A refusal of the source, as the public envelope's `details`. */
const refusalDetails = (answer) => [{ field: 'prepaid', issue: answer.code, ...refusal(answer) }];

module.exports = {
  read, amounts, projection, refusal, refusalDetails,
};
