/**
 * SCHEDULE — the stay-level amounts and their dates (specs/pricing-components.md §3 rules 22, 48, 50).
 *
 * Contract: `planSchedule({ totals, policy, planLines, overrides, receipts, ledger })` → the pre-arrival amount,
 * the acompte and the solde (percentage, overrides, platform single payment, installment plan, a paid bucket that keeps
 * what it collected), their due dates (`paymentSchedule`), the arrival complement (forced lines, tourist tax, the gap
 * between the stay and what the buckets cover, the excess of a collected one, the operator's adjustment) and the
 * end-of-stay complement amounts. The code moved from the engine as it was: the same names, the same order of operations.
 *
 * - `totals`: finalPrice, totalStayPrice, touristTaxTotal, touristTaxAddedGuestsAmount, touristTaxInComplement,
 *   isTouristTaxCollectedOnArrival, forcedItemsTotal, complementForcedItemsTotal, platformGrossPin;
 * - `policy`: the schedule settings (depositPercent, depositEnabled, depositDueDays, balanceDaysBefore), the sale channel,
 *   the platform, the quote kind, the dates and the devis promise;
 * - `planLines`: what the mid-stay split and the departure SAS carry;
 * - `overrides`: depositAmountOverride, complementAmountOverride;
 * - `receipts`: what is stored as collected (flags and amounts of the three buckets);
 * - `ledger`: the two readings of money received, as values the caller read from the PaymentLedger port under the conditions
 *   it owns: `{ splitReceived, installmentPlan }` (`null` when the stay has none).
 *
 * Pure: no DB, no port, no clock (the dates it judges are inputs). Nothing here is read by a unit upstream.
 */
const { roundMoney } = require('./money');
const {
  resolveDepositDueDate, resolveBalanceDueDate, isLastMinuteStay, owesSinglePaymentByValidity, devisPromiseHeld, devisPromiseDueDate, toIsoDay,
} = require('../paymentSchedule');
const { unreceivedOf } = require('../splitReceived');
const {
  settledByKey, buildMidStayLine, ARRIVAL_COMPLEMENT_EXCESS_KEY, ARRIVAL_COMPLEMENT_EXCESS_LABEL,
} = require('./settlement');

function planSchedule({
  totals: {
    finalPrice, totalStayPrice, touristTaxTotal, touristTaxAddedGuestsAmount, touristTaxInComplement,
    isTouristTaxCollectedOnArrival, forcedItemsTotal, complementForcedItemsTotal, platformGrossPin,
  },
  policy: {
    settings, channel, platform, platformTakesDeposit, platformPayoutDueDays, quoteKind, devisPromise, validUntil,
    bookingDate, startDate, endDate, bookingId, depositDisabled,
  },
  planLines: {
    midStayExtras, midStayTotal, midStayUnforced, midStaySettledTotal, midStayRemainingTotal, midStaySettledNotes,
    endOfStaySasAmount, endOfStaySasAmountAuto,
  },
  overrides: { depositAmountOverride, complementAmountOverride },
  receipts: {
    depositPaid, balancePaid, complementPaid, depositAmount, balanceAmount, complementAmount, existingDepositDueDate,
    paidSoldeCaptured, endOfStayComplementSettled,
  },
  ledger: { splitReceived, installmentPlan },
}) {
  const isTouristTaxForcedToComplement = Boolean(touristTaxInComplement);
  const taxInComplement = (isTouristTaxCollectedOnArrival || isTouristTaxForcedToComplement)
    ? touristTaxTotal
    : touristTaxAddedGuestsAmount;
  const taxInPreArrival = roundMoney(touristTaxTotal - taxInComplement);
  const preArrivalAmount = roundMoney(Math.max(0, finalPrice - forcedItemsTotal - midStayUnforced + taxInPreArrival));
  // specs/tourist-tax-on-solde.md — when there's an acompte, the tourist tax rides entirely on the SOLDE.
  // The acompte is therefore a % of the ACCOMMODATION pre-arrival only (no tax); the balance is the rest of
  // the accommodation PLUS the full pre-arrival tax. Because `balance = preArrivalAmount − deposit` (and
  // `preArrivalAmount = accommodationPreArrival + taxInPreArrival`), simply computing the deposit on
  // `accommodationPreArrival` puts the whole tax on the solde automatically. No acompte → balance =
  // preArrivalAmount (tax included), unchanged.
  const accommodationPreArrival = roundMoney(Math.max(0, finalPrice - forcedItemsTotal - midStayUnforced));

  const autoDepositAmount = roundMoney(accommodationPreArrival * (Number(settings.depositPercent || 0) / 100));
  const autoBalanceAmount = roundMoney(preArrivalAmount - autoDepositAmount);
  let resolvedDepositAmount = autoDepositAmount;
  let resolvedBalanceAmount = autoBalanceAmount;

  // specs/property-deposit-switch.md rules 2, 5-6 — the logement's « Acompte » switch. OFF, this
  // property has no acompte at all: the solde absorbs the whole pre-arrival total, on a direct
  // booking as on a platform one. A row read without the column (a minimal test DB) counts as ON,
  // so a suite that never heard of the flag keeps its behaviour; real rows are NOT NULL DEFAULT 0.
  // Rule 4: the gate never rewrites an acompte that was already ENCAISSÉ — that money produced an
  // accounting entry, and collapsing it into the solde afterwards would desynchronise the export.
  // Hence its position below the `depositPaid` branches, unlike `depositDisabled` which outranks
  // them on purpose ("the platform took it, it never hit my bank").
  const propertyDepositOff = settings.depositEnabled !== undefined
    && settings.depositEnabled !== null
    && Number(settings.depositEnabled) !== 1;

  // Platform reservations are always paid in a single bank transfer — no deposit/balance
  // split (specs/accounting-platform-commission-and-no-deposit.md §3.3 rules 5–7). The boot
  // migration collapses legacy platform deposits into the balance, and the engine here
  // enforces the same on every recompute so an edit can't reintroduce a phantom acompte.
  // Direct reservations keep the full deposit/balance/complement flow.
  // Rule 45 of plugins-phase-p-productisation.md — the acompte follows the SALE (a counts-as-direct
  // channel keeps the direct schedule); a commission can be booked on any named channel.
  const platformIsNonDirect = channel.platformSale;
  // specs/reservation-refunds.md rules 38 and 40 — whose amount a paid solde follows: the platform's
  // statement on a platform sale, and on a counts-as-direct channel whose platform amount is entered.
  const paidSoldeFollowsStatement = channel.platformSale || platformGrossPin != null;
  // specs/plugins-phase-p-productisation.md rule 45 — an EXISTING stay on a counts-as-direct channel
  // keeps the schedule it was stored with: sold as a single payment (no acompte, no acompte deadline)
  // it stays one, paid or not; a stored acompte stays as it is. Only a new stay takes the direct rule.
  const storedDepositKnown = depositAmount !== null && depositAmount !== undefined && depositAmount !== '';
  const keepsStoredSchedule = channel.ownChannel && channel.namedChannel && Number(bookingId) > 0
    && storedDepositKnown && !depositPaid && !depositDisabled
    && (depositAmountOverride === null || depositAmountOverride === undefined || depositAmountOverride === '');
  // D23 (specs/deposit-blocks-the-dates.md rule 19) — a devis whose solde would fall on or before its
  // validity date carries no acompte: due on the validity date, it would be owed after the solde. A devis
  // collects nothing before it is converted, so this outranks every branch below, platform included.
  const devisSinglePayment = String(quoteKind) === 'devis'
    && owesSinglePaymentByValidity({ startDate, validUntil, balanceDaysBefore: settings.balanceDaysBefore });
  // The reservation converted from such a devis, or from a devis stored with no acompte (rule 22, R34-RES-L2),
  // keeps its single payment and its deadline for the dates quoted; moved, the stay takes the reservation rules.
  // Last in the chain, like the last-minute switch. Only a DIRECT devis made that promise (rule 24, audit R35-RES-L1):
  // an OTA devis's stored acompte 0 is no promise, whatever channel the stay is switched to later.
  const keepsDevisPromise = String(quoteKind) !== 'devis' && !platformIsNonDirect && Boolean(devisPromise)
    && toIsoDay(devisPromise.startDate) === toIsoDay(startDate)
    && devisPromiseHeld({ devisPromise, balanceDaysBefore: settings.balanceDaysBefore });
  if (devisSinglePayment) {
    resolvedDepositAmount = 0;
    resolvedBalanceAmount = roundMoney(preArrivalAmount);
  } else if (keepsStoredSchedule) {
    resolvedDepositAmount = roundMoney(Math.min(Math.max(0, Number(depositAmount) || 0), accommodationPreArrival));
    resolvedBalanceAmount = roundMoney(Math.max(0, preArrivalAmount - resolvedDepositAmount));
  } else if (platformIsNonDirect) {
    // specs/platform-per-echeance-commission.md — the acompte/solde split the GROSS pre-arrival (the
    // guest-facing amounts); the commission is booked separately per échéance, NOT subtracted from the
    // displayed amounts. specs/platform-deposit-toggle.md — « no acompte » (default) or `depositDisabled`
    // → deposit=0, everything in the solde; otherwise a normal acompte/solde split (manual override OK).
    if (!platformTakesDeposit || depositDisabled) {
      resolvedDepositAmount = 0;
      resolvedBalanceAmount = roundMoney(preArrivalAmount);
    } else if (depositPaid && balancePaid) {
      // specs/reservation-refunds.md rule 40 — rule 38 holds with an acompte too: the paid acompte stays,
      // the paid solde follows the statement, and no arrival complement is asked.
      resolvedDepositAmount = roundMoney(depositAmount);
      resolvedBalanceAmount = roundMoney(Math.max(0, preArrivalAmount - resolvedDepositAmount));
    } else if (propertyDepositOff && !depositPaid) {
      resolvedDepositAmount = 0;
      resolvedBalanceAmount = roundMoney(preArrivalAmount);
    } else {
      let dep;
      if (depositPaid) {
        dep = roundMoney(depositAmount);
      } else if (depositAmountOverride !== null && depositAmountOverride !== undefined && depositAmountOverride !== '') {
        const overrideRaw = Number(depositAmountOverride);
        // specs/tourist-tax-on-solde.md — acompte clamped to the ACCOMMODATION (tax stays on the solde).
        dep = Number.isFinite(overrideRaw)
          ? roundMoney(Math.min(Math.max(0, overrideRaw), accommodationPreArrival))
          : roundMoney(accommodationPreArrival * (Number(settings.depositPercent || 0) / 100));
      } else {
        dep = roundMoney(accommodationPreArrival * (Number(settings.depositPercent || 0) / 100));
      }
      resolvedDepositAmount = dep;
      resolvedBalanceAmount = roundMoney(Math.max(0, preArrivalAmount - dep));
    }
  } else if (depositDisabled) {
  // `depositDisabled` opt-out wins over every other branch below — it's the explicit
  // "this reservation has no deposit concept, the platform handled it" toggle. See
  // specs/disable-deposit-per-reservation.md. We force-zero the deposit and let the
  // balance absorb the pre-arrival total. The controller is responsible for also forcing
  // depositPaid = 0 + depositPaidDate = NULL on the way in, so accountingModel emits a
  // single journal entry instead of two.
    resolvedDepositAmount = 0;
    resolvedBalanceAmount = roundMoney(preArrivalAmount);
  } else if (depositPaid && balancePaid) {
    resolvedDepositAmount = roundMoney(depositAmount);
    // Rule 40 — a counts-as-direct channel with its platform amount entered settles on the statement.
    resolvedBalanceAmount = paidSoldeFollowsStatement
      ? roundMoney(Math.max(0, preArrivalAmount - resolvedDepositAmount))
      : roundMoney(balanceAmount);
  } else if (depositPaid) {
    resolvedDepositAmount = roundMoney(depositAmount);
    resolvedBalanceAmount = roundMoney(Math.max(0, preArrivalAmount - resolvedDepositAmount));
  } else if (balancePaid && depositAmount !== null && depositAmount !== undefined && depositAmount !== ''
    && roundMoney(depositAmount) === 0) {
    // specs/plugins-phase-p-productisation.md rule 45 — a stay whose single payment is already in (no
    // acompte, solde paid) stays a single payment: a later recompute never opens an acompte before a
    // solde that is already collected (the counts-as-direct stays sold as one payout, a direct stay
    // moved out of the last-minute window after it was paid).
    resolvedDepositAmount = 0;
    resolvedBalanceAmount = roundMoney(preArrivalAmount);
  } else if (propertyDepositOff) {
    // Above the manual override on purpose (rule 5): with the switch OFF the property page offers no
    // acompte setting at all, so a frozen override would be an amount nobody can see or explain.
    resolvedDepositAmount = 0;
    resolvedBalanceAmount = roundMoney(preArrivalAmount);
  } else if (depositAmountOverride !== null && depositAmountOverride !== undefined && depositAmountOverride !== '') {
    // Manual deposit override (specs/editable-deposit-amount.md rule 3-4). Freeze the deposit at the
    // operator's value, clamped to [0, preArrival] so the balance can never go negative; the balance
    // absorbs the rest of the pre-arrival total — and any later growth of it, since the override is
    // re-fed on every recompute.
    const overrideRaw = Number(depositAmountOverride);
    // specs/tourist-tax-on-solde.md — acompte clamped to the ACCOMMODATION (the tax stays on the solde).
    const clamped = Number.isFinite(overrideRaw)
      ? roundMoney(Math.min(Math.max(0, overrideRaw), accommodationPreArrival))
      : autoDepositAmount;
    resolvedDepositAmount = clamped;
    resolvedBalanceAmount = roundMoney(Math.max(0, preArrivalAmount - clamped));
  } else if (isLastMinuteStay({ bookingDate, startDate, balanceDaysBefore: settings.balanceDaysBefore }) || keepsDevisPromise) {
    // specs/deposit-blocks-the-dates.md rules 4-6 (implementing specs/online-payments-qonto.md §3.7) —
    // the stay starts inside the solde window, so an acompte would be due at the same time as the solde
    // it is supposed to precede. The guest owes ONE payment: the whole pre-arrival total. Last in the
    // chain on purpose — a paid, disabled or hand-set acompte above states an intent this must not undo.
    resolvedDepositAmount = 0;
    resolvedBalanceAmount = roundMoney(preArrivalAmount);
  }
  // specs/reservation-refunds.md rule 36 — a paid solde keeps what it collected. The branches above
  // re-price a solde that carries the whole pre-arrival amount (no acompte), so reducing the stay after
  // payment used to lower the money received with it, and the trop-perçu refund then took the same
  // euros off a second time. The excess stays visible as `overCollectedTtc` until a refund returns it.
  // Rule 38 — a platform stay is the exception: the platform paid what its statement says and refunds its
  // guest itself, so the paid solde follows the platform amount the operator corrects.
  const paidBalanceAmount = roundMoney(Number(balanceAmount) || 0);
  if (balancePaid && !paidSoldeFollowsStatement && paidBalanceAmount > resolvedBalanceAmount) resolvedBalanceAmount = paidBalanceAmount;
  // specs/reservation-payment-ledger.md rule 36 — with no acompte to share the stay with, a paid solde
  // also keeps what it collected when the stay costs MORE: raising it would book money never received
  // (a link paid at its old amount, rule 31). The difference is owed as the arrival complement below.
  const noDepositToShare = !depositPaid && roundMoney(resolvedDepositAmount) === 0;
  if (balancePaid && !paidSoldeFollowsStatement && noDepositToShare && Number(balanceAmount) > 0) {
    resolvedBalanceAmount = paidBalanceAmount;
  }
  // specs/reservation-payment-ledger.md rule 46, reading of 2026-11-05 (audit R22-3) — a solde collected before its
  // acompte keeps what it collected: what is still owed shrinks first, a rise goes to the complement.
  const soldeBeforeAcompte = balancePaid && !paidSoldeFollowsStatement && !depositPaid && !depositDisabled && !noDepositToShare
    && storedDepositKnown && Number(balanceAmount) > 0;
  if (soldeBeforeAcompte) {
    resolvedBalanceAmount = paidBalanceAmount;
    resolvedDepositAmount = roundMoney(Math.max(0, Math.min(Number(depositAmount) || 0, roundMoney(preArrivalAmount - paidBalanceAmount))));
  }
  // specs/mixed-method-payments.md rule 47 (audit R34-M-H1) — a paid bucket split with a « Reste à percevoir » or a
  // « Geste commercial » received less than its amount: rule 36 keeps what it RECEIVED. A cut of the stay lowers it down
  // to that before any trop-perçu is left; rule 39 then cancels the reste, then the geste, on the bucket's new amount.
  // Rule 50 (D25 « Une seule somme ») — a settlement over several buckets received one sum for all of them: what a cut may
  // take off a bucket is what its whole pool did not receive, read at the amounts its buckets are worth now.
  const splitAmountOf = (kind) => {
    if (kind === 'deposit') return resolvedDepositAmount;
    if (kind === 'balance') return resolvedBalanceAmount;
    if (kind === 'complement') return complementPaid ? roundMoney(complementAmount) : 0;
    return null;
  };
  if (splitReceived && (depositPaid || balancePaid)) {
    let over = roundMoney((depositPaid ? resolvedDepositAmount : 0) + (balancePaid ? resolvedBalanceAmount : 0)
      - (totalStayPrice - complementForcedItemsTotal - taxInComplement - midStayTotal));
    for (const [bucket, paid] of [['balance', balancePaid], ['deposit', depositPaid]]) {
      if (!paid || !(over > 0)) continue;
      const cut = roundMoney(Math.min(over, unreceivedOf(splitReceived, bucket, splitAmountOf)));
      if (bucket === 'balance') resolvedBalanceAmount = roundMoney(resolvedBalanceAmount - cut);
      else resolvedDepositAmount = roundMoney(resolvedDepositAmount - cut);
      over = roundMoney(over - cut);
    }
  }

  // specs/direct-installments.md rules 4-5 — an installment plan replaces the acompte and the solde: the
  // pre-arrival amount (`preArrivalAmount`) is handed to the plan, which the caller rebalances after the
  // save. Read by the saved booking's id; a booking that does not exist yet has no plan, and neither does
  // one on a platform (rule 1: a switch away from the own channels ends the plan with the save).
  // A bucket already collected is never zeroed (rule 35): such a stay keeps its acompte / solde.
  if (installmentPlan) {
    resolvedDepositAmount = 0;
    resolvedBalanceAmount = 0;
  }

  // specs/payment-schedule-and-cancellation.md §3.1-§3.2 — the acompte is due `depositDueDays` after
  // the BOOKING and never moves again (`existingDepositDueDate` wins on every recompute); the solde
  // is due `balanceDaysBefore` before arrival, clamped so it can never land before the booking day.
  // A devis takes its validity date as the acompte deadline. Both are NULL when their bucket carries
  // nothing to collect — a deadline on a €0 line would only confuse the UI and the emails.
  // specs/platform-payout-due-date.md §3.1 — on a NON-direct reservation the solde is the platform's
  // payout, due `payoutDueDays` after the guest leaves; own channels keep the J-30 rule above.
  const balanceDueDate = resolveBalanceDueDate({
    hasBalance: resolvedBalanceAmount > 0,
    startDate,
    endDate,
    bookingDate,
    balanceDaysBefore: settings.balanceDaysBefore,
    // Rule 3 — the payout regime is for reservations only. A devis is a promise made to a guest; even
    // one carrying a platform name owes its solde on the quote's own schedule, not on a payout that
    // does not exist yet.
    platform: String(quoteKind) === 'devis' ? null : platform,
    platformPayoutDueDays,
    // specs/deposit-blocks-the-dates.md rule 7 — with no acompte, a DIRECT devis owes its single
    // payment on its validity date, not on the issue day the clamp would produce. A devis carrying an
    // OTA name never had an acompte to lose, so it keeps the guest-facing derivation (rule 3 above).
    // D23 — the reservation converted from a devis owing one payment keeps the devis's deadline, never
    // before its own booking day.
    dueOnValidUntil: (String(quoteKind) === 'devis' || keepsDevisPromise) && !platformIsNonDirect && resolvedDepositAmount === 0,
    validUntil: keepsDevisPromise ? devisPromiseDueDate({ validUntil: devisPromise.validUntil, bookingDate }) : validUntil,
  });
  const depositDueDate = resolveDepositDueDate({
    kind: quoteKind,
    hasDeposit: !depositDisabled && resolvedDepositAmount > 0,
    bookingDate,
    validUntil,
    existingDepositDueDate,
    depositDueDays: settings.depositDueDays,
    // specs/payment-schedule-and-cancellation.md rule 47 — never after the solde.
    notAfter: balanceDueDate,
  });

  // Complément à percevoir = forced items (manual or tax-on-arrival or touristTaxInComplement)
  // + auto-gap when the total stay TTC drifted past the frozen deposit+balance. The auto-gap
  // appears once both `*Paid` flags are 1 (legacy behavior) OR when the tax is collected on
  // arrival (visible immediately as a check-in collection target). Frozen once `complementPaid`.
  // specs/platform-per-echeance-commission.md — the acompte/solde now store the GROSS amounts (the
  // commission is tracked + booked separately), so the auto-gap reconciles against the gross stay total
  // for direct AND platform alike.
  // specs/mid-stay-extras-to-end-of-stay-complement.md §3.3 — the mid-stay total is deducted from the
  // auto-gap too: that share of the stay total is already billed in the end-of-stay complement, so
  // leaving it here would charge it twice.
  const ownerStayTotal = roundMoney(totalStayPrice);
  const planScheduled = installmentPlan ? installmentPlan.scheduled : 0;
  const autoGapBetweenDepositAndBalance = roundMoney(Math.max(
    0,
    ownerStayTotal - resolvedDepositAmount - resolvedBalanceAmount - planScheduled
      - complementForcedItemsTotal - taxInComplement - midStayTotal,
  ));
  // specs/reservation-refunds.md rule 34 — the other side of that gap: what the paid acompte and solde
  // hold beyond what they now have to cover, once the stay was reduced after they were paid. The engine
  // keeps a paid bucket's amount, so without this the money received above the new total went unseen.
  const paidOnSchedule = (depositPaid ? resolvedDepositAmount : 0) + (balancePaid ? resolvedBalanceAmount : 0)
    + (installmentPlan ? installmentPlan.paid : 0);
  const scheduleOverCollectedTtc = roundMoney(Math.max(
    0,
    paidOnSchedule - (ownerStayTotal - complementForcedItemsTotal - taxInComplement - midStayTotal),
  ));
  const rawComplement = roundMoney(complementForcedItemsTotal + taxInComplement + autoGapBetweenDepositAndBalance);
  // Rule 36 — the paid solde of a stay without acompte was kept at what it collected: the gap is owed.
  const noDepositGap = balancePaid && !paidSoldeFollowsStatement && noDepositToShare && Number(balanceAmount) > 0;
  // Rule 8 — a rise on a plan whose installments are all paid goes to the arrival complement, exactly as
  // when acompte and solde are both paid.
  const preArrivalSettled = ((depositPaid || noDepositGap || soldeBeforeAcompte) && balancePaid) || Boolean(installmentPlan && installmentPlan.allPaid);
  // What the arrival complement would ask for if it were not collected yet.
  let liveComplementAmount;
  if (isTouristTaxCollectedOnArrival || isTouristTaxForcedToComplement || complementForcedItemsTotal > 0
    || touristTaxAddedGuestsAmount > 0) {
    // Forced contributions are visible from save 1, regardless of payment state.
    liveComplementAmount = preArrivalSettled
      ? rawComplement
      : roundMoney(complementForcedItemsTotal + taxInComplement);
  } else {
    liveComplementAmount = preArrivalSettled ? autoGapBetweenDepositAndBalance : 0;
  }
  let resolvedComplementAmount = complementPaid ? roundMoney(complementAmount) : liveComplementAmount;
  const complementOverridden = complementAmountOverride !== null && complementAmountOverride !== undefined
    && complementAmountOverride !== '' && Number.isFinite(Number(complementAmountOverride));
  // specs/reservation-save-keeps-pricing.md rule 4 — a collected complement stays at what was collected
  // (the books follow the money), but a later edit can leave it above what the stay now asks of the
  // arrival: a line moved out of it, a tax that fell. That excess is money received beyond the stay
  // total — a trop-perçu, like the same excess on the acompte and the solde — never a second charge and
  // never an anonymous « Complément d'arrivée » line the total does not include. The operator's own
  // adjustment of the complement is his decision and is not second-guessed. A platform stay has no
  // trop-perçu to give back (reservation-refunds.md rule 38): the excess stays where it is (Adrien, 2026-10-29).
  let complementCollectedExcess = complementPaid && !complementOverridden && !channel.platformSale
    ? roundMoney(Math.max(0, roundMoney(complementAmount) - rawComplement))
    : 0;
  // Rule 47 — the same for a collected complement paid with several methods: its excess comes off what it did not receive.
  if (splitReceived && complementCollectedExcess > 0) {
    const cut = roundMoney(Math.min(complementCollectedExcess, unreceivedOf(splitReceived, 'complement', splitAmountOf)));
    resolvedComplementAmount = roundMoney(resolvedComplementAmount - cut);
    complementCollectedExcess = roundMoney(complementCollectedExcess - cut);
  }
  const overCollectedTtc = roundMoney(scheduleOverCollectedTtc + complementCollectedExcess);
  // specs/mid-stay-extras-to-end-of-stay-complement.md rule 20 — a collected arrival complement is
  // closed, so what was routed to it since (an extra added on the complement before any arrival
  // baseline existed, a tax or an extra guest added after the collection) is billed at check-out, in
  // the end-of-stay complement. Without proof the buckets agreed only the routed items count, never the
  // auto-gap: the line can under-claim but never invent a due. With that proof (reading of 2026-11-05, D9:
  // the solde's contribs captured and the pre-arrival money settled) the auto-gap counts too. Never on a
  // complement the operator adjusted (his amount is the decision), nor once the end-of-stay complement is
  // collected too (its lines are frozen). Reading of 2026-11-05 (audit R23 N1): a plan never sets `balancePaid`, so all
  // its installments paid is the same proof.
  const bucketsAgreed = paidSoldeCaptured || Boolean(installmentPlan && installmentPlan.allPaid);
  const routedToComplement = roundMoney(complementForcedItemsTotal + taxInComplement
    + (bucketsAgreed && preArrivalSettled ? autoGapBetweenDepositAndBalance : 0));
  const arrivalComplementExcess = complementPaid && !complementOverridden && !endOfStayComplementSettled
    ? roundMoney(Math.max(0, routedToComplement - resolvedComplementAmount))
    : 0;
  const excessSettledByNotes = arrivalComplementExcess > 0
    ? roundMoney(Math.min(arrivalComplementExcess, Number(settledByKey(midStaySettledNotes)[ARRIVAL_COMPLEMENT_EXCESS_KEY] || 0)))
    : 0;
  const excessStillDue = roundMoney(arrivalComplementExcess - excessSettledByNotes);
  const midStayLinesWithExcess = excessStillDue > 0
    ? [...midStayExtras.lines, buildMidStayLine({
      label: ARRIVAL_COMPLEMENT_EXCESS_LABEL,
      unitPrice: excessStillDue,
      amount: excessStillDue,
      key: ARRIVAL_COMPLEMENT_EXCESS_KEY,
    })]
    : midStayExtras.lines;
  const midStayRemainingDue = roundMoney(midStayRemainingTotal + excessStillDue);
  const midStaySettledAll = roundMoney(midStaySettledTotal + excessSettledByNotes);
  // What the engine would collect on its own — the « Calcul auto (X €) » the fiche shows under the
  // adjustment field, and the base the accounting ventilation is spread over (§3.6 rule 36).
  const autoComplementAmount = roundMoney(resolvedComplementAmount);
  // specs/adjustable-complement-amounts.md §3.2 rule 13 — the operator's amount is applied LAST, after
  // the frozen / forced / auto-gap branches above. That ordering is what lets it correct a complement
  // that is already collected (rule 6), while rule 14 stands: the COMPUTED `complementAmount` a
  // browser sends is still ignored on a frozen bucket (specs/frozen-complement-trusts-client.md).
  if (complementAmountOverride !== null && complementAmountOverride !== undefined && complementAmountOverride !== '') {
    const overrideRaw = Number(complementAmountOverride);
    if (Number.isFinite(overrideRaw)) resolvedComplementAmount = roundMoney(Math.max(0, overrideRaw));
  }

  // The end-of-stay complement as it will be stored: what the departure SAS bills + what is STILL
  // due of the mid-stay sales (specs/mid-stay-notes.md §3.3 rule 10 — the notes already collected
  // are out). Exposed so the fiche shows the sale live, before the save persists it.
  const endOfStayComplementTotal = roundMoney(Number(endOfStaySasAmount || 0) + midStayRemainingDue);
  // Le même total sans l'ajustement de l'opérateur : ce que la fiche affiche en « Calcul auto (X €) »
  // sous le champ du complément de fin de séjour (specs/adjustable-complement-amounts.md §6.1).
  const endOfStayComplementAutoTotal = roundMoney(
    Number(endOfStaySasAmountAuto != null ? endOfStaySasAmountAuto : endOfStaySasAmount || 0) + midStayRemainingDue,
  );

  return {
    accommodationPreArrival,
    autoComplementAmount,
    autoDepositAmount,
    balanceDueDate,
    complementCollectedExcess,
    depositDueDate,
    endOfStayComplementAutoTotal,
    endOfStayComplementTotal,
    installmentPlan,
    isTouristTaxForcedToComplement,
    midStayLinesWithExcess,
    midStayRemainingDue,
    midStaySettledAll,
    overCollectedTtc,
    planScheduled,
    platformIsNonDirect,
    preArrivalAmount,
    rawComplement,
    resolvedBalanceAmount,
    resolvedComplementAmount,
    resolvedDepositAmount,
    taxInComplement,
  };
}

// specs/pricing-components.md §3 rule 50 — the settings of this unit, read through SettingsProvider.for('schedule', scope).
const percent = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? null : 'Un pourcentage entre 0 et 100 est attendu.');
const days = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? null : 'Un nombre de jours entier est attendu.');
const settingsSchema = [
  { key: 'depositPercent', type: 'number', default: 0, scope: 'property', validate: percent },
  { key: 'depositEnabled', type: 'number', default: 1, scope: 'property', validate: (value) => ([0, 1].includes(Number(value)) ? null : 'Choix invalide.') },
  { key: 'depositDueDays', type: 'number', default: 7, scope: 'property', validate: days },
  { key: 'balanceDaysBefore', type: 'number', default: 30, scope: 'property', validate: days },
  { key: 'cancelAfterBalanceDueDays', type: 'number', default: 7, scope: 'property', validate: days },
];

module.exports = { planSchedule, settingsSchema };
