/**
 * The accounting synthesis engine (specs/accounting-synthesis.md). Pure: it reads the entries the journal
 * is made of — the very ones the CSV export writes, through `entryVentilation` / `entryToStructured` — and
 * shapes the VAT return, the checks and the collections. Every amount is summed in cents and leaves as
 * euros rounded to the cent; every share is computed here.
 */

const { entryVentilation, entryToStructured } = require('./accountingExport');
const { accountLabel, planMapper } = require('./accountPlan');

const cents = (value) => Math.round((Number(value) || 0) * 100);
const euros = (c) => Math.round(c) / 100;
// Half away from zero, the same for a refund's negative base as for a sale's.
const roundHalfAway = (x) => Math.sign(x) * Math.round(Math.abs(x));

const COLLECTION_DIRECTIONS = new Set(['sale', 'compensation', 'tip', 'discount', 'penalty']);

const MEANS = Object.freeze({
  platform: 'Versements plateforme',
  paymentLink: 'Lien de paiement',
  recorded: 'Marqué perçu',
});

const TYPES = Object.freeze({
  deposit: 'Acomptes',
  balance: 'Soldes',
  installment: 'Échéances',
  arrivalComplement: 'Compléments à l’arrivée',
  endOfStayComplement: 'Compléments de fin de séjour',
  midStayComplement: 'Notes en séjour',
  arrivalPayment: 'Paiements à l’arrivée',
  platformPayout: 'Versements plateforme',
  compensation: 'Indemnités d’annulation',
  tip: 'Pourboires',
});

const KIND_TYPE = {
  deposit: 'deposit',
  balance: 'balance',
  installment: 'installment',
  complement: 'arrivalComplement',
  endOfStayComplement: 'endOfStayComplement',
  midStayComplement: 'midStayComplement',
  compensation: 'compensation',
  tip: 'tip',
};

function directionOf(entry) {
  return entry && entry.direction ? entry.direction : 'sale';
}

/**
 * Rule 4 — one item per journal entry of the window: its CSV lines (role + rate), its structured card,
 * and a stable reference the checks name it by.
 */
function ventilate(entries, plan) {
  const seen = new Map();
  return (entries || []).map((entry) => {
    const structured = entryToStructured(entry, plan);
    if (!structured) return null;
    const direction = directionOf(entry);
    const discriminator = entry.refundId ?? entry.compensationId ?? (entry.installment ? entry.installment.number : '');
    const base = `${direction}:${entry.reservationId ?? ''}:${entry.kind || direction}:${entry.paidDate || ''}:${discriminator}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return {
      entry,
      direction,
      lines: entryVentilation(entry, plan),
      structured,
      ref: {
        key: n === 1 ? base : `${base}#${n}`,
        reservationId: entry.reservationId ?? null,
        kind: entry.kind || direction,
        direction,
        paidDate: entry.paidDate || null,
        libelle: structured.libelle,
      },
    };
  }).filter(Boolean);
}

// Signed per line: a credit adds to the account, a debit takes from it (an avoir, a rebate).
const signedCents = (line) => cents(line.credit) - cents(line.debit);

/** Split `total` cents over `weights` (cents) proportionally, largest remainder: the parts add up exactly. */
function apportion(total, weights) {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (weights.length === 0) return [];
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map((r) => Math.floor(r));
  let rest = total - floors.reduce((a, f) => a + f, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0 && k < order.length; k += 1, rest -= 1) floors[order[k][1]] += 1;
  return floors;
}

/**
 * Rules 5-6 — the VAT to declare: by rate and by revenue account, from the CSV's own lines. The VAT of an
 * entry at one rate is shared over that entry's revenue lines at that rate (largest remainder, to the
 * cent), so both tables add up to the same total.
 */
function vatReturn(items, plan) {
  const byRate = new Map();
  const byAccount = new Map();
  let deductible = 0;
  const roleOf = planMapper(plan).defaultOf;
  for (const item of items) {
    const revenue = item.lines.filter((l) => l.role === 'revenue');
    const vatByRate = new Map();
    for (const line of item.lines) {
      if (line.role === 'commissionVat') deductible += cents(line.debit) - cents(line.credit);
      if (line.role !== 'vat') continue;
      vatByRate.set(line.ratePercent, (vatByRate.get(line.ratePercent) || 0) + signedCents(line));
    }
    const rates = new Set([...revenue.map((l) => l.ratePercent), ...vatByRate.keys()]);
    for (const rate of rates) {
      const atRate = revenue.filter((l) => l.ratePercent === rate);
      const vat = vatByRate.get(rate) || 0;
      const r = byRate.get(rate) || { base: 0, vat: 0 };
      r.base += atRate.reduce((a, l) => a + signedCents(l), 0);
      r.vat += vat;
      byRate.set(rate, r);
      const shares = atRate.length > 0 ? apportion(vat, atRate.map((l) => Math.abs(signedCents(l)))) : [];
      atRate.forEach((line, i) => {
        const key = `${line.account}|${rate}`;
        const a = byAccount.get(key) || { account: line.account, ratePercent: rate, base: 0, vat: 0 };
        a.base += signedCents(line);
        a.vat += shares[i];
        byAccount.set(key, a);
      });
      if (atRate.length === 0 && vat !== 0) {
        const vatLine = item.lines.find((l) => l.role === 'vat' && l.ratePercent === rate);
        const key = `${vatLine.account}|${rate}`;
        const a = byAccount.get(key) || { account: vatLine.account, ratePercent: rate, base: 0, vat: 0 };
        a.vat += vat;
        byAccount.set(key, a);
      }
    }
  }
  const rateRows = [...byRate.entries()]
    .map(([ratePercent, r]) => ({ ratePercent, base: euros(r.base), vat: euros(r.vat) }))
    .filter((r) => r.base !== 0 || r.vat !== 0)
    .sort((a, b) => b.ratePercent - a.ratePercent);
  const accountRows = [...byAccount.values()]
    .map((a) => ({ account: a.account, label: accountLabel(roleOf(a.account)), ratePercent: a.ratePercent, base: euros(a.base), vat: euros(a.vat) }))
    .filter((a) => a.base !== 0 || a.vat !== 0)
    .sort((a, b) => b.ratePercent - a.ratePercent || a.account.localeCompare(b.account));
  const totalBase = [...byRate.values()].reduce((s, r) => s + r.base, 0);
  const totalVat = [...byRate.values()].reduce((s, r) => s + r.vat, 0);
  return {
    byRate: rateRows,
    byAccount: accountRows,
    totals: { base: euros(totalBase), vat: euros(totalVat) },
    deductibleOnCommissions: euros(deductible),
  };
}

/**
 * Rule 11 — debits equal credits, entry by entry and over the window.
 */
function balanceCheck(items) {
  let debits = 0;
  let credits = 0;
  const unbalanced = [];
  for (const item of items) {
    const d = item.lines.reduce((a, l) => a + cents(l.debit), 0);
    const c = item.lines.reduce((a, l) => a + cents(l.credit), 0);
    debits += d;
    credits += c;
    if (d !== c || !item.structured.balanced) unbalanced.push({ ...item.ref, gap: euros(d - c) });
  }
  return {
    status: unbalanced.length === 0 && debits === credits ? 'ok' : 'gap',
    totalDebits: euros(debits),
    totalCredits: euros(credits),
    unbalanced,
  };
}

/**
 * Rule 12 — the VAT of each entry against its base × rate, rate by rate. Tolerance: the expected VAT is
 * base × rate rounded to the cent (half away from zero); any difference of 1 cent or more is reported,
 * with the entry. Entry by entry, so rounding never accumulates across entries.
 */
function vatCheck(items) {
  const entries = [];
  let total = 0;
  for (const item of items) {
    const byRate = new Map();
    for (const line of item.lines) {
      if (line.role !== 'revenue' && line.role !== 'vat') continue;
      if (!(line.ratePercent > 0)) continue;
      const r = byRate.get(line.ratePercent) || { base: 0, vat: 0 };
      if (line.role === 'revenue') r.base += signedCents(line);
      else r.vat += signedCents(line);
      byRate.set(line.ratePercent, r);
    }
    const gaps = [];
    for (const [rate, r] of byRate) {
      const expected = roundHalfAway((r.base * rate) / 100);
      const gap = r.vat - expected;
      if (gap !== 0) gaps.push({ ratePercent: rate, base: euros(r.base), vat: euros(r.vat), expectedVat: euros(expected), gap: euros(gap) });
    }
    if (gaps.length > 0) {
      const entryGap = gaps.reduce((a, g) => a + cents(g.gap), 0);
      total += gaps.reduce((a, g) => a + Math.abs(cents(g.gap)), 0);
      entries.push({ ...item.ref, gap: euros(entryGap), rates: gaps });
    }
  }
  return { status: entries.length === 0 ? 'ok' : 'gap', gap: euros(total), entries };
}

/**
 * Rules 10 and 13 — the collections of the window as payments: an arrival payment's entries (one group) are
 * one payment; a rebate or a tip rides its payment; a platform penalty lowers the platform payouts
 * without being a payment. `meansOf(entry)` is the model's reading of how the money came.
 */
function collectionUnits(items, meansOf) {
  const units = new Map();
  for (const item of items) {
    const { entry, direction } = item;
    if (!COLLECTION_DIRECTIONS.has(direction)) continue;
    const money = item.lines.filter((l) => l.role === 'client').reduce((a, l) => a + cents(l.debit) - cents(l.credit), 0);
    const group = entry.paymentGroup && entry.paymentGroup.id ? entry.paymentGroup : null;
    if (group) {
      const key = `group:${group.id}`;
      const unit = units.get(key) || { key, date: group.at || entry.paidDate, amount: 0, type: 'arrivalPayment', means: null, meansSeen: new Set(), count: 1 };
      unit.amount += money;
      if (direction === 'sale') unit.meansSeen.add(meansOf(entry));
      units.set(key, unit);
      continue;
    }
    const means = meansOf(entry);
    let type;
    if (direction === 'penalty') type = 'platformPayout';
    else if (direction === 'discount') type = 'arrivalPayment';
    else if (means === 'platform' && (entry.kind === 'deposit' || entry.kind === 'balance')) type = 'platformPayout';
    else type = KIND_TYPE[entry.kind] || KIND_TYPE[direction] || 'balance';
    const count = direction === 'penalty' || direction === 'discount' ? 0 : 1;
    units.set(`entry:${item.ref.key}`, { key: item.ref.key, date: entry.paidDate, amount: money, type, means, count });
  }
  return [...units.values()].map((u) => {
    if (u.meansSeen) {
      const seen = [...u.meansSeen];
      return { key: u.key, date: u.date, amount: u.amount, type: u.type, means: seen.length === 1 ? seen[0] : 'recorded', count: u.count };
    }
    return u;
  });
}

/**
 * Rule 14 — shares in percent with one decimal, adding up to exactly 100 (largest remainder). None while
 * the total is not positive or a row is negative: a part of a whole cannot be read there.
 */
function sharesOf(amounts) {
  const total = amounts.reduce((a, c) => a + c, 0);
  if (!(total > 0) || amounts.some((c) => c < 0)) return amounts.map(() => null);
  return apportion(1000, amounts).map((tenths) => tenths / 10);
}

function breakdown(units, field, labels) {
  const rows = new Map();
  for (const u of units) {
    const r = rows.get(u[field]) || { key: u[field], label: labels[u[field]], count: 0, amount: 0 };
    r.count += u.count;
    r.amount += u.amount;
    rows.set(u[field], r);
  }
  const list = [...rows.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'fr'));
  const shares = sharesOf(list.map((r) => r.amount));
  return list.map((r, i) => ({ key: r.key, label: r.label, count: r.count, amount: euros(r.amount), share: shares[i] }));
}

function collections(units) {
  return {
    total: euros(units.reduce((a, u) => a + u.amount, 0)),
    payments: units.reduce((a, u) => a + u.count, 0),
    byMeans: breakdown(units, 'means', MEANS),
    byType: breakdown(units, 'type', TYPES),
  };
}

/** Rule 10 — what went back to guests in the window (avoirs), apart from the collections. */
function refundsOf(items) {
  const refunds = items.filter((i) => i.direction === 'refund');
  const amount = refunds.reduce((a, i) => a + i.lines.filter((l) => l.role === 'client').reduce((s, l) => s + cents(l.credit) - cents(l.debit), 0), 0);
  return { count: refunds.length, amount: euros(amount) };
}

/**
 * Rule 15 — collected per bucket, its running total, and last year's running total on the same buckets.
 * Both totals are read directly up to each bucket's end (never by adding buckets), so a 29 February that
 * maps to the 28th a year earlier is never counted twice.
 */
function series({ buckets, window, today, units, previousUnits, shiftYear }) {
  const upTo = (list, from, to) => list.filter((u) => u.date >= from && u.date <= to).reduce((a, u) => a + u.amount, 0);
  const previousFrom = previousUnits ? shiftYear(window.from, -1) : null;
  let before = 0;
  let previousBefore = 0;
  return buckets.map((b) => {
    const started = b.from <= today;
    const cumulative = started ? upTo(units, window.from, b.to) : null;
    const amount = started ? cumulative - before : null;
    if (started) before = cumulative;
    let previousCumulative = null;
    let previousAmount = null;
    if (previousUnits) {
      previousCumulative = upTo(previousUnits, previousFrom, shiftYear(b.to, -1));
      previousAmount = previousCumulative - previousBefore;
      previousBefore = previousCumulative;
    }
    return {
      key: b.key,
      label: b.label,
      from: b.from,
      to: b.to,
      amount: amount == null ? null : euros(amount),
      cumulative: cumulative == null ? null : euros(cumulative),
      previousAmount: previousAmount == null ? null : euros(previousAmount),
      previousCumulative: previousCumulative == null ? null : euros(previousCumulative),
    };
  });
}

module.exports = {
  ventilate, vatReturn, balanceCheck, vatCheck, collectionUnits, collections, refundsOf, series, sharesOf, apportion,
  MEANS, TYPES,
};
