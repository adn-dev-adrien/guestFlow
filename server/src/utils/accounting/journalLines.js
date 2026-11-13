/**
 * The neutral role lines of a journal entry (specs/pricing-components.md §3 rule 63).
 *
 * `entryLines(entry, splitFrom)` answers what an entry books, with no account number and no CSV column:
 *   { role, side: 'debit' | 'credit', amountCents, vatRate?, vatCents?, account? }
 * `role` is `customer`, `revenue:<class>` (`accommodation`, `options`, `customOptions`, `resources`, `activities`,
 * `compensation`, `indemnity`, `discount`, `tip`, `closing`), `vat:<rate>`, `touristTax`, `commission`, `commissionVat`
 * or `penalty`. `account` is present only when the entry itself pins one (a configured compensation account, a platform's
 * commission account, the account a closing refund found left on the stay's books). An exporter maps the roles to its own
 * accounts and columns; the amounts, the VAT split and the rounding residue are decided here, once.
 *
 * The lines come out in the order the CSV journal has always written its rows, and every amount is the cent value of the
 * euro figure the journal used to print, so the CSV bytes do not move.
 */

const { bookedBucketSplit, netOfTtc, TTC_SPLIT_FALLBACK } = require('./legacyBucketSplit');
const { roundMoneyOrZero: round2, toCentsStrict } = require('../pricing/money');

// `create({ accountPlan })` — only the plan's bucket table, to know which buckets book revenue.
function create({ accountPlan }) {
  const {
    BUCKET_TO_ACCOUNT, REVENUE_ACCOUNTS, vatAccountForRate, PASS_THROUGH_ACCOUNTS, DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT,
    DISCOUNT_ACCOUNT, TIP_ACCOUNT, PLATFORM_PENALTY_ACCOUNT,
  } = accountPlan;

  // The account a role line books on, in the engine's default plan: a line that carries its own account keeps it, a revenue
  // class maps to its account, the VAT to the account of its rate (the operator's plan renames them afterwards).
  const CLASS_ACCOUNTS = {
    ...BUCKET_TO_ACCOUNT,
    activities: REVENUE_ACCOUNTS.ACTIVITIES,
    catering: BUCKET_TO_ACCOUNT.options,
    compensation: DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT,
    indemnity: DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT,
    discount: DISCOUNT_ACCOUNT,
    tip: TIP_ACCOUNT,
  };
  // `plan.drinksRevenueAccount` is the accountant's account for the drinks sold outside a stay; no default is invented (outside-visit spec rule 43).
  function accountOf(line, customerAccount, plan = null) {
    if (line.role === 'customer') return customerAccount;
    if (line.account) return line.account;
    if (line.role === 'revenue:drinks') return (plan && plan.drinksRevenueAccount) || undefined;
    if (line.role.startsWith('revenue:')) return CLASS_ACCOUNTS[line.role.slice('revenue:'.length)];
    if (line.role.startsWith('vat:')) return vatAccountForRate(line.vatRate);
    if (line.role === 'touristTax') return PASS_THROUGH_ACCOUNTS.TOURIST_TAX;
    if (line.role === 'penalty') return PLATFORM_PENALTY_ACCOUNT;
    return undefined;
  }

  const line = (role, side, euros, extra = {}) => ({ role, side, amountCents: toCentsStrict(euros), ...extra });

  // Absorbs the cent residue of a group of lines on its last line, so the lines balance the other side to the cent.
  const absorbResidue = (amounts, target) => {
    if (amounts.length === 0) return;
    const residue = round2(target - round2(amounts.reduce((a, l) => a + l.amount, 0)));
    if (residue !== 0) amounts[amounts.length - 1].amount = round2(amounts[amounts.length - 1].amount + residue);
  };

  const revenueOf = (r) => line(`revenue:${r.name}`, r.side, r.amount, { vatRate: r.rate, ...(r.vatCents != null ? { vatCents: r.vatCents } : {}), ...(r.account ? { account: r.account } : {}) });
  const vatOf = (v, side) => line(`vat:${v.rate}`, side, v.amount, { vatRate: v.rate });

  function saleLines(entry, splitFrom) {
    const grossDebitTtc = round2(entry.encaissementTtc);
    const netDebitTtc = entry.encaissementNetTtc != null ? round2(entry.encaissementNetTtc) : grossDebitTtc;
    const taxTtc = round2(entry.taxTtc || 0);
    const commission = entry.commission || null;

    const revenue = [];
    const vatByRate = new Map();
    for (const bucket of entry.buckets) {
      if (!BUCKET_TO_ACCOUNT[bucket.name]) continue;
      const rate = Number(bucket.ratePercent) || 0;
      const { ht, vat } = bookedBucketSplit(entry, bucket, splitFrom);
      if (ht > 0) revenue.push({ name: bucket.name, side: 'credit', amount: ht, rate, vatCents: toCentsStrict(vat) });
      if (vat > 0) vatByRate.set(rate, (vatByRate.get(rate) || 0) + vat);
    }
    const vats = [...vatByRate.entries()].map(([rate, amount]) => ({ rate, amount: round2(amount) }));
    const taxes = taxTtc > 0 ? [{ amount: taxTtc }] : [];
    absorbResidue([...revenue, ...vats, ...taxes], grossDebitTtc);

    const commissions = [];
    if (commission && commission.ttc > 0) {
      if (commission.ht > 0) commissions.push({ role: 'commission', account: commission.account, amount: round2(commission.ht) });
      if (commission.hasVat && commission.vat > 0) commissions.push({ role: 'commissionVat', account: commission.vatAccount, amount: round2(commission.vat) });
      const debitResidue = round2(grossDebitTtc - round2(netDebitTtc + commissions.reduce((a, l) => a + l.amount, 0)));
      if (debitResidue !== 0 && commissions.length > 0) commissions[commissions.length - 1].amount = round2(commissions[commissions.length - 1].amount + debitResidue);
    }

    return [
      line('customer', 'debit', netDebitTtc),
      ...commissions.map((c) => line(c.role, 'debit', c.amount, { account: c.account })),
      ...revenue.map(revenueOf),
      ...vats.map((v) => vatOf(v, 'credit')),
      ...taxes.map((t) => line('touristTax', 'credit', t.amount)),
    ];
  }

  function refundLines(entry) {
    const creditTtc = round2(entry.encaissementTtc);
    const closing = entry.closing || null;
    const closingTax = closing ? closing.find((leg) => leg.role === 'touristTax') : null;
    const taxTtc = closing ? round2(closingTax ? closingTax.amount : 0) : round2(entry.taxTtc || 0);

    const revenue = [];
    const vatByRate = new Map();
    for (const leg of closing || []) {
      if (leg.role === 'revenue') revenue.push({ name: 'closing', side: 'debit', account: leg.account, amount: round2(leg.amount), rate: Number(leg.ratePercent) || 0 });
      if (leg.role === 'vat') vatByRate.set(Number(leg.ratePercent) || 0, round2((vatByRate.get(Number(leg.ratePercent) || 0) || 0) + leg.amount));
    }
    for (const bucket of closing ? [] : entry.buckets || []) {
      if (!BUCKET_TO_ACCOUNT[bucket.name]) continue;
      const ht = round2(bucket.ht || 0);
      const vat = round2(bucket.vat || 0);
      const rate = Number(bucket.ratePercent) || 0;
      if (ht > 0) revenue.push({ name: bucket.name, side: 'debit', amount: ht, rate });
      if (vat > 0) vatByRate.set(rate, (vatByRate.get(rate) || 0) + vat);
    }
    const indemnity = entry.indemnity || null;
    if (indemnity) {
      const ht = round2(indemnity.ht || 0);
      const rate = Number(indemnity.ratePercent) || 0;
      if (ht > 0) revenue.push({ name: 'indemnity', side: 'debit', amount: ht, rate, ...(indemnity.account ? { account: indemnity.account } : {}) });
      const vat = round2(indemnity.vat || 0);
      if (vat > 0) vatByRate.set(rate, (vatByRate.get(rate) || 0) + vat);
    }
    const vats = [...vatByRate.entries()].map(([rate, amount]) => ({ rate, amount: round2(amount) }));
    const taxes = taxTtc > 0 || (closing && taxTtc !== 0) ? [{ amount: taxTtc }] : [];
    absorbResidue([...revenue, ...vats, ...taxes], creditTtc);

    // A negative leg of a closing refund (the tax a sale left in credit) is a credit, never a negative debit.
    const sided = (role, amount, extra) => (amount < 0 ? line(role, 'credit', -amount, extra) : line(role, 'debit', amount, extra));
    return [
      line('customer', 'credit', creditTtc),
      ...revenue.map((r) => (r.amount < 0 ? revenueOf({ ...r, side: 'credit', amount: -r.amount }) : revenueOf(r))),
      ...vats.map((v) => sided(`vat:${v.rate}`, v.amount, { vatRate: v.rate })),
      ...taxes.map((t) => sided('touristTax', t.amount, {})),
    ];
  }

  function compensationLines(entry) {
    const config = entry.compensation || {};
    const debitTtc = round2(entry.encaissementTtc);
    const rate = Number(config.ratePercent) || 0;
    const ht = round2(config.ht != null ? config.ht : debitTtc);
    const credits = [];
    if (ht > 0) credits.push({ kind: 'revenue', amount: ht });
    const vat = round2(config.vat || 0);
    if (vat > 0) credits.push({ kind: 'vat', amount: vat });
    absorbResidue(credits, debitTtc);
    return [
      line('customer', 'debit', debitTtc),
      ...credits.map((c) => (c.kind === 'revenue'
        ? line('revenue:compensation', 'credit', c.amount, { vatRate: rate, ...(config.account ? { account: config.account } : {}) })
        : vatOf({ rate, amount: c.amount }, 'credit'))),
    ];
  }

  function discountLines(entry) {
    const ttc = round2(entry.encaissementTtc);
    const rate = Number(entry.discount?.ratePercent) || 0;
    const ht = round2(entry.discount?.ht != null ? entry.discount.ht : ttc);
    const debits = [];
    if (ht > 0) debits.push({ kind: 'revenue', amount: ht });
    const vat = round2(entry.discount?.vat || 0);
    if (vat > 0) debits.push({ kind: 'vat', amount: vat });
    absorbResidue(debits, ttc);
    return [
      ...debits.map((d) => (d.kind === 'revenue'
        ? line('revenue:discount', 'debit', d.amount, { vatRate: rate, ...(entry.discount?.account ? { account: entry.discount.account } : {}) })
        : vatOf({ rate, amount: d.amount }, 'debit'))),
      line('customer', 'credit', ttc),
    ];
  }

  function tipLines(entry) {
    const ttc = round2(entry.encaissementTtc);
    return [
      line('customer', 'debit', ttc),
      line('revenue:tip', 'credit', ttc, { vatRate: 0, ...(entry.tipAccount ? { account: entry.tipAccount } : {}) }),
    ];
  }

  function penaltyLines(entry) {
    const ttc = round2(entry.encaissementTtc);
    return [
      line('penalty', 'debit', ttc, entry.penaltyAccount ? { account: entry.penaltyAccount } : {}),
      line('customer', 'credit', ttc),
    ];
  }

  // A document of the core (rule 74): one revenue line per VAT class and one VAT line per rate, from the TTC the payments of the day allocated
  // to its lines on the books; the rounding cent lands on the last credit like every other entry.
  function documentLines(entry) {
    const ttc = round2(entry.encaissementTtc);
    const revenue = [];
    const vatByRate = new Map();
    for (const group of entry.groups) {
      const groupTtc = group.ttcCents / 100;
      const vat = group.vatCents / 100;
      const ht = round2(groupTtc - vat);
      if (ht > 0) revenue.push({ name: group.vatClass, side: 'credit', amount: ht, rate: group.rate, vatCents: group.vatCents });
      if (vat > 0) vatByRate.set(group.rate, round2((vatByRate.get(group.rate) || 0) + vat));
    }
    const vats = [...vatByRate.entries()].map(([rate, amount]) => ({ rate, amount }));
    absorbResidue([...revenue, ...vats], ttc);
    return [line('customer', 'debit', ttc), ...revenue.map(revenueOf), ...vats.map((v) => vatOf(v, 'credit'))];
  }

  function standaloneLines(entry) {
    if (Array.isArray(entry.groups)) return documentLines(entry);
    const ttc = round2(entry.encaissementTtc);
    const rate = entry.vatRatePercent === null || entry.vatRatePercent === undefined ? 0 : Number(entry.vatRatePercent);
    const ht = netOfTtc(ttc, rate);
    const vat = round2(ttc - ht);
    return [
      line('customer', 'debit', ttc),
      line('revenue:activities', 'credit', ht, { vatRate: rate }),
      ...(vat > 0 ? [vatOf({ rate, amount: vat }, 'credit')] : []),
    ];
  }

  /** The role lines of one entry, in the order the journal writes them. */
  function entryLines(entry, { splitFrom = TTC_SPLIT_FALLBACK } = {}) {
    switch (entry && entry.direction) {
      case 'refund': return refundLines(entry);
      case 'compensation': return compensationLines(entry);
      case 'discount': return discountLines(entry);
      case 'tip': return tipLines(entry);
      case 'penalty': return penaltyLines(entry);
      case 'standalone': return standaloneLines(entry);
      default: return saleLines(entry, splitFrom);
    }
  }

  return { entryLines, accountOf };
}

module.exports = { create };
