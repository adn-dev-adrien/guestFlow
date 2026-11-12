const { roundMoneyStrict } = require('../../pricing/money');
/**
 * The sales JSON exporter (specs/pricing-components.md §3 rule 63): the CSV's rows grouped per entry and pre-classified so the
 * Comptabilité page renders the journal as cards. Pure, formatting only. Moved from the accounting-export plugin.
 */

// `create({ accountPlan, csvJournal })` — the account plan and the CSV journal whose rows each card is made of.
function createSalesJson({ accountPlan, csvJournal }) {
  const { PASS_THROUGH_ACCOUNTS, accountLabel, planMapper } = accountPlan;
  const { entryToRows, round2 } = csvJournal;

  // Same data as the CSV but in a structured, render-friendly shape (one object per encaissement,
  // lines already classified by type so the UI can colour them). Guarantees the rendered preview
  // = the CSV content: each entry's lines are produced from the same `entryToRows` walk so any
  // future change to the export (e.g. an extra commission-as-charge line) appears in both at once.
  function entryToStructured(entry, plan) {
    const rows = entryToRows(entry, plan);
    // Labels and line types are known by the default numbers; an account the plan renamed reads as its role.
    const roleOf = planMapper(plan).defaultOf;
    if (rows.length === 0) return null;
    const [day, month, year] = rows[0];

    const isRefund = entry.direction === 'refund';
    const isCompensation = entry.direction === 'compensation';
    const isDiscount = entry.direction === 'discount';
    const isTip = entry.direction === 'tip';
    const isPenalty = entry.direction === 'penalty';
    const platformInfo = (entry.platform && entry.platform !== 'direct' && !isRefund && !isCompensation
      && !isDiscount && !isTip && !isPenalty)
      ? {
          platform: entry.platform,
          gross: entry.clientGrossAmount == null ? null : Number(entry.clientGrossAmount),
          // Net (versement) banked by the owner = revenu brut − commission, surfaced so the journal
          // card can show what actually hit the bank (2026-06-22).
          net: round2(Number(entry.encaissementNetTtc)),
          commission: entry.commission ? round2(entry.commission.ttc) : null,
          commissionAccount: entry.commission ? entry.commission.account : null,
          commissionHt: entry.commission ? entry.commission.ht : null,
          commissionVat: entry.commission ? entry.commission.vat : null,
          commissionHasVat: entry.commission ? entry.commission.hasVat : null,
        }
      : { platform: null, gross: null, net: null, commission: null, commissionAccount: null, commissionHt: null, commissionVat: null, commissionHasVat: null };

    // Position indices follow CSV_HEADERS exactly.
    const lines = rows.map((row) => {
      const [,, , , , libelle, compte, debit, credit] = row;
      const debitVal = typeof debit === 'number' ? debit : null;
      const creditVal = typeof credit === 'number' ? credit : null;
      return {
        compte: String(compte),
        // specs/arrival-payment-detail-and-adjustment.md rule 25 — the pourboire shares the produit-divers
        // account with the indemnité d'annulation, so an entry may name what ITS use of the account is.
        // Everything else keeps the shared chart-of-accounts label.
        accountLabel: (entry.accountLabels && entry.accountLabels[String(compte)]) || accountLabel(roleOf(compte)),
        libelle: String(libelle),
        // Map literal-0 placeholders back to null so the preview shows a blank cell on the
        // counter-side (the user sees `100,00 / —` not `100,00 / 0,00`).
        debit: debitVal === 0 ? null : debitVal,
        credit: creditVal === 0 ? null : creditVal,
        type: classifyLine(roleOf(compte)),
      };
    });

    const sumDebits = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
    const sumCredits = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
    const balanced = sumDebits === sumCredits;

    // Effective share of the séjour this encaissement covers (revenue TTC / finalPrice) — the
    // « N % du séjour » caption. Distinct from `fraction`, which is the export-side bucket
    // multiplier (1 on the contrib path where buckets are absolute).
    const finalPrice = round2(entry.finalPrice);
    // A refund covers no « share of the séjour » — it gives part of it back (the caption is hidden).
    // A compensation has no séjour at all: the stay was cancelled (the caption is hidden too).
    const stayShare = (!isRefund && !isCompensation && !isDiscount && !isTip && !isPenalty && finalPrice > 0)
      ? Math.max(0, (round2(entry.encaissementTtc) - round2(entry.taxTtc || 0)) / finalPrice)
      : null;

    return {
      reservationId: entry.reservationId,
      kind: entry.kind,
      // specs/reservation-refunds.md §3.4 rule 25 — the card renders as an « avoir » when set.
      // specs/cancellation-compensation.md §6.3 — « compensation » renders as an indemnity card.
      direction: isRefund ? 'refund'
        : (isCompensation ? 'compensation'
          : (isDiscount ? 'discount' : (isTip ? 'tip' : (isPenalty ? 'penalty' : 'sale')))),
      // specs/resource-booking-pricing-and-invoicing.md rule 22 — a sale made outside any stay, and its Qonto invoice.
      standalone: entry.direction === 'standalone' ? { label: entry.standaloneLabel || '', invoiceNumber: entry.piece || null } : null,
      compensationId: entry.compensationId != null ? entry.compensationId : null,
      // The cancelled stay window, so the card can say WHICH séjour the indemnity replaces.
      compensationStay: isCompensation
        ? { startDate: entry.compensation?.startDate || '', endDate: entry.compensation?.endDate || '' }
        : null,
      platformName: isCompensation ? (entry.platform || '') : null,
      refundId: entry.refundId != null ? entry.refundId : null,
      refundReason: isRefund ? (entry.reason || '') : null,
      refundMethod: isRefund ? (entry.method || null) : null,
      day, month, year,
      paidDate: entry.paidDate,
      client: entry.client,
      libelle: rows[0][5],          // libellé column
      clientAccount: rows[0][6],    // compte column on the debit row
      encaissementTtc: round2(entry.encaissementTtc),
      // specs/single-payment-at-check-in.md §3.3 rule 12 — the collection this entry belonged to, so
      // the Comptabilité can render ONE card for one payment. Carried through untouched: the entry's
      // own ventilation (accounts, VAT, share of the séjour) is not affected by the grouping.
      ...(entry.paymentGroup ? { paymentGroup: entry.paymentGroup } : {}),
      finalPrice,
      fraction: entry.fraction,
      stayShare,
      platform: platformInfo,
      lines,
      sumDebits,
      sumCredits,
      balanced,
    };
  }

  // 'client' = auxiliary debit (C…) — 'revenue' = comptes 70xxx — 'vat' = comptes 44571xxx —
  // 'tax_pass_through' = compte 46710000 (taxe de séjour pass-through, see spec
  // accountant-accounting-export.md §3.4 rule 14) — 'commission_charge' = compte 6226xx
  // (debit line on the platform's compte commission) — 'commission_vat' = compte 44566000
  // (debit line for the deductible VAT on commission). See accounting-platform-commission-
  // and-no-deposit.md §3.5–§3.6.
  function classifyLine(compte) {
    const s = String(compte);
    if (s.startsWith('C')) return 'client';
    if (s.startsWith('70')) return 'revenue';
    if (s.startsWith('44571')) return 'vat';
    if (s === PASS_THROUGH_ACCOUNTS.TOURIST_TAX) return 'tax_pass_through';
    if (s === '44566000') return 'commission_vat';
    if (s.startsWith('6226')) return 'commission_charge';
    // Produits divers (75xxxx) — the cancellation-compensation account. Still a revenue credit for
    // the reader, so it gets the same green treatment as the 70xxx lines.
    if (s.startsWith('75')) return 'revenue';
    return 'other';
  }

  function buildStructuredEntries(entries, plan) {
    return (entries || []).map((entry) => entryToStructured(entry, plan)).filter(Boolean);
  }

  const TOURIST_TAX_ACCOUNT = '46710000';
  function taxOnlyEntries(structured) {
    return structured
      .filter((e) => e.direction === 'sale')
      .filter((e) => {
        const credits = (e.lines || []).filter((l) => Number(l.credit) > 0);
        return credits.length > 0 && credits.every((l) => String(l.compte) === TOURIST_TAX_ACCOUNT);
      })
      .map((e) => ({ reservationId: e.reservationId, kind: e.kind, libelle: e.libelle, paidDate: e.paidDate, amount: e.encaissementTtc }));
  }

  function exportJson(entries, { plan }) {
    const structured = buildStructuredEntries(entries, plan);
    const totalDebits = structured.reduce((s, e) => s + e.sumDebits, 0);
    const totalCredits = structured.reduce((s, e) => s + e.sumCredits, 0);
    return {
      contentType: 'application/json',
      body: {
        entries: structured,
        totals: {
          entriesCount: structured.length,
          totalDebits: roundMoneyStrict(totalDebits),
          totalCredits: roundMoneyStrict(totalCredits),
          allBalanced: structured.every((e) => e.balanced),
          // specs/reservation-payment-ledger.md rule 43 — a sale whose credits are all on the
          // tourist-tax account carries no revenue and no VAT: shown, never silently exported.
          taxOnlyEntries: taxOnlyEntries(structured),
        },
      },
    };
  }

  return {
    id: 'salesJson',
    export: exportJson,
    entryToStructured,
    buildStructuredEntries,
    __test: { classifyLine, taxOnlyEntries },
  };
}

module.exports = { create: createSalesJson };
