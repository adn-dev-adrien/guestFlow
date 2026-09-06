/**
 * Neat subscription worker (specs/neat-cancellation-insurance-subscription.md §3.2).
 *
 * One pass = scan (enqueue eligible reservations, drop disqualified pending jobs) + process the due
 * jobs: externalId idempotency lookup → /price → /subscriptions → active. A failure schedules the
 * next attempt on the backoff ladder and pushes a « Souscriptions Neat » notification (first
 * failure, then at most once per 24 h per job). Everything is dependency-injected so tests drive
 * the whole pass without network or timers. NOTHING here ever blocks a reservation flow — callers
 * fire-and-forget the pass.
 */

const { calculateReservationQuote } = require('./pricing');
const { buildReservationEngineInput } = require('./reservationEngineInput');
const { isDirectChannel } = require('./platformNameFormat');
const { readNeatConfig } = require('./neatGuestPricing');
const {
  parseMappingJson, validateMapping, buildServiceFieldValues, buildCustomerPayload,
} = require('./neatFieldMapping');

const NOTIFY_THROTTLE_MS = 24 * 60 * 60 * 1000;

function externalIdFor(environment, reservationId) {
  return `${environment === 'staging' ? 'staging-' : ''}guestflow-${reservationId}`;
}

function parseContractFields(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// The subscription flow needs the full configuration (mapping valid against the cached contract
// schema included). Guest pricing has its own, stricter-on-margin gate in neatGuestPricing.
function subscriptionConfig(cfg) {
  if (!cfg || !cfg.clientId || !cfg.clientSecret || !cfg.salesChannelId || !cfg.contractId || !cfg.paymentMethodId) return null;
  const fields = parseContractFields(cfg.contractFieldsJson);
  if (fields.length === 0) return null;
  const mapping = parseMappingJson(cfg.fieldMappingJson);
  if (!validateMapping(mapping, fields).ok) return null;
  return { fields, mapping };
}

// The stay snapshot the field mapping prices/subscribes from — replayed through the SAME engine as
// the fiche (locked snapshots included), so Neat is told exactly what the guest was billed.
function buildStaySnapshot(db, reservation) {
  const quote = calculateReservationQuote(buildReservationEngineInput(db, reservation));
  if (quote.error) throw new Error(`quote failed: ${quote.error}`);
  const insuranceLine = (quote.optionLines || []).find((line) => {
    const opt = db.prepare('SELECT isCancellationInsurance FROM options WHERE id = ?').get(line.optionId);
    return opt && Number(opt.isCancellationInsurance) === 1;
  }) || null;
  const property = db.prepare('SELECT name FROM properties WHERE id = ?').get(reservation.propertyId);
  const nights = Math.max(1, Math.round(
    (new Date(`${reservation.endDate}T00:00:00Z`) - new Date(`${reservation.startDate}T00:00:00Z`)) / 86400000
  ));
  return {
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    nights,
    guests: Number(reservation.adults || 0) + Number(reservation.children || 0) + Number(reservation.teens || 0),
    accommodationAmount: Number(quote.cancellationInsuranceBase || 0),
    insuranceAmount: insuranceLine ? Number(insuranceLine.totalPrice || 0) : 0,
    // Excludes the insurance line itself, matching the quote-time snapshot (no circularity).
    totalAmount: Math.max(0, Number(quote.totalStayPrice || 0) - (insuranceLine ? Number(insuranceLine.totalPrice || 0) : 0)),
    propertyName: property ? String(property.name || '') : '',
    reservationRef: `GF-${reservation.id}`,
  };
}

/**
 * deps: { db, settingsModel, model (neatSubscriptionsModel), buildClient, pushService, now?, logger? }
 * Returns { skipped? } or { enqueued, dropped, subscribed, failed }.
 */
async function runNeatSubscriptionPass(deps, reason = 'tick') {
  const { db, settingsModel, model, buildClient, pushService, now = () => new Date(), logger = console } = deps;
  const cfg = readNeatConfig(settingsModel);
  const active = subscriptionConfig(cfg);
  // Spec rule 12: unconfigured → silent no-op, existing jobs left untouched, no failure spam.
  if (!active) return { skipped: 'unconfigured' };

  const env = cfg.environment;
  const nowDate = now();
  const nowIso = nowDate.toISOString();
  const today = nowIso.slice(0, 10);

  // Scan: enqueue rule-7 reservations (the platform filter stays in JS — isDirectChannel is the
  // single authority on what « direct » means, Lodgify included).
  let enqueued = 0;
  for (const row of model.findEligibleWithoutJob(env, today)) {
    if (!isDirectChannel(row.platform)) continue;
    model.enqueue(row.id, env, externalIdFor(env, row.id));
    enqueued += 1;
  }

  // Drop pending jobs whose reservation no longer qualifies (line removed, cancelled, un-paid,
  // stay started) — an ACTIVE subscription is deliberately left alone (rules 15-16).
  const disqualified = model.listPendingDisqualified(env, today);
  for (const job of disqualified) model.dropPending(job.id);

  let subscribed = 0;
  let failed = 0;
  for (const job of model.listDue(env, nowIso)) {
    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(job.reservationId);
    if (!reservation) { model.dropPending(job.id); continue; }
    try {
      const snapshot = buildStaySnapshot(db, reservation);
      const serviceFieldValues = buildServiceFieldValues(active.mapping, active.fields, snapshot);
      const clientRow = db.prepare('SELECT * FROM clients WHERE id = ?').get(reservation.clientId) || {};
      const client = buildClient({ environment: env, clientId: cfg.clientId, clientSecret: cfg.clientSecret });

      // Idempotency (rule 9a): a live subscription with our externalId is adopted, never duplicated.
      const existing = await client.getByExternalId(cfg.contractId, job.externalId);
      if (existing && existing.status !== 'voided' && existing.status !== 'refunded') {
        model.markActive(job.id, {
          neatSubscriptionId: existing.id,
          premiumAmount: Number.isFinite(Number(existing.amountInclTax)) ? Number(existing.amountInclTax) : null,
          billedAmount: snapshot.insuranceAmount,
        });
        subscribed += 1;
        continue;
      }

      const { amount } = await client.price(cfg.contractId, { serviceFieldValues, quantity: 1 });
      const { id: neatId } = await client.subscribe(cfg.contractId, {
        salesChannelId: cfg.salesChannelId,
        serviceFieldValues,
        customers: [buildCustomerPayload(clientRow)],
        totalAmount: amount,
        paymentContext: {
          method: cfg.paymentMethodKind || 'Cash',
          paymentMethodId: cfg.paymentMethodId,
        },
        externalId: job.externalId,
      });
      model.markActive(job.id, { neatSubscriptionId: neatId, premiumAmount: amount, billedAmount: snapshot.insuranceAmount });
      subscribed += 1;
      logger.log(`[neat] subscribed reservation ${job.reservationId} (${job.externalId} → ${neatId})`);
    } catch (err) {
      failed += 1;
      const errorKind = err && err.status === 400 ? 'validation' : 'unavailable';
      model.markFailedAttempt(job.id, { error: err.message, errorKind, nowMs: nowDate.getTime() });
      logger.error(`[neat] subscription of reservation ${job.reservationId} failed (${errorKind}): ${err.message}`);
      // Push on the first failure, then at most once per 24 h per job (rule 11). Push errors are
      // swallowed by pushService; a throw here must not poison the other jobs anyway.
      const lastNotified = job.lastNotifiedAt ? new Date(job.lastNotifiedAt).getTime() : 0;
      if (nowDate.getTime() - lastNotified >= NOTIFY_THROTTLE_MS) {
        const clientRow = db.prepare('SELECT lastName, firstName FROM clients WHERE id = ?').get(reservation.clientId) || {};
        const who = [clientRow.firstName, clientRow.lastName].filter(Boolean).join(' ') || `réservation ${job.reservationId}`;
        try {
          await pushService.sendToPref('neat', {
            title: 'Souscription Neat en échec',
            body: `${who} — ${reservation.startDate} → ${reservation.endDate}. ${errorKind === 'validation' ? 'Données refusées, à corriger.' : 'Neat indisponible, nouvelle tentative programmée.'}`,
            url: `/reservations/${job.reservationId}`,
          });
          model.touchNotifiedAt(job.id, nowIso);
        } catch (pushErr) {
          logger.error(`[neat] push notification failed: ${pushErr.message}`);
        }
      }
    }
  }

  const summary = { enqueued, dropped: disqualified.length, subscribed, failed };
  if (enqueued || disqualified.length || subscribed || failed) {
    logger.log(`[neat] pass (${reason}): ${JSON.stringify(summary)}`);
  }
  return summary;
}

module.exports = { runNeatSubscriptionPass, buildStaySnapshot, subscriptionConfig, externalIdFor, NOTIFY_THROTTLE_MS };
