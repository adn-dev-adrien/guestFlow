// specs/pricing-components.md §3 rule 66 — the static guards that name their patterns, their home and, for the
// exporters, their scope. Shared by `no-duplicate-formulas.unit.test.js` (which judges the hits against the allow-lists
// of `fixtures/no-duplicate-formulas/`) and by the script that regenerates those lists.
//
// vat        the TTC to HT / VAT cut exists once, in `utils/pricing/vat/` (rules 61-62)
// platform-payment  what a platform pays out is computed once, in `platformPayment.js` (rule 70)
// refunds    every refund cap, trop-perçu and requalification figure lives in `utils/pricing/refunds/` (rule 72)
// money      no rounding helper defined outside `money.js` (rule 38: PR C merges the copies once the replay proves it)
// dates      no module compares dates to decide a stay phase or a collection moment outside `stayClock*` (rule 45)
// hourly     the hourly grid (`priceRange`, band arithmetic) exists once, in the hourly family
// families   the per-type multiplier (`getTypeMultiplier`, persons × nights) exists once, under `articles/`
// exporters  no accounting exporter imports `vat/`, `articles/` or the pipeline (rule 63): it reads neutral entries
// A path of the plugin folders is built, not written: these are repository paths to classify, not files the test reads
// (plugin-removal-matrix).
const plugin = (id, ...rest) => ['plugins/' + id, ...rest].join('/'); // eslint-disable-line prefer-template

// A guard is a list of rules (a pattern and a probe line it must catch), a home (where the formula may live) and, for
// the exporters, a scope. `removedBy(file, text)` gives the PR a new entry waits for, `reason(file, text)` why the copy is
// still there. The patterns are shapes (parentheses, variable names and spacing vary), never one spelling.
const MONEY_NAMES = '(round2|roundMoney|roundCents|toCents|fromCents|cents|euros)';

const GUARDS = [
  {
    name: 'vat',
    isHome: (file) => file.startsWith('utils/pricing/vat/') || file === 'utils/colorContrast.js', // the sRGB luminance divides by 1.055, not a VAT rate
    rules: [
      { re: /\/\s*\(\s*100\s*\+/, probe: 'const share = ttc * (rate / (100 + rate));' },
      { re: /\*\s*\(?\s*\w*[rR]ate\w*\s*\/\s*\(?\s*100/, probe: 'const vat = amount * vatRate / 100;' },
      { re: /\/\s*\(\s*1\s*\+\s*[\w.]*[rR]ate[\w.]*\s*\/\s*100\s*\)/, probe: 'const net = ttc / (1 + vatRate / 100);' },
      { re: /\/\s*\(\s*1\s*\+[^;]*\/\s*100/, probe: 'const net = ttc / (1 + (Number(quote.vatPercentageAccommodation || 0) / 100));' },
      { re: /\b1\s*\+\s*\(?[^;]*[pP]ercent[^;]*\/\s*100/, probe: 'const factor = 1 + (vatPercent / 100);' },
      { re: /\b1\s*\+\s*\(?\s*[\w.]*[rR]ate[\w.]*\s*\/\s*100/, probe: 'const factor = 1 + (taxRate / 100);' },
      { re: /[rR]ate[\w.]*\s*\/\s*\(\s*[\w.]*[rR]ate[\w.]*\s*\+\s*100\s*\)/, probe: 'const part = vatRate / (vatRate + 100);' },
      { re: /(?<!\d(px|em|rem)\s*)\/\s*1\.(055|021|1|2)\b(?!\d)/, probe: 'const ht = ttc / 1.2;' },
      { re: /(\w+)\s*-\s*\1\s*\/\s*\(\s*1\s*\+/, probe: 'const vat = amount - amount / (1 + t);' },
    ],
    // The departmental surcharge of the tourist tax is a percentage on top of the municipal tax, not a VAT.
    skip: (file, text) => /departmentPercentage/.test(text),
    removedBy: (file) => (file.startsWith('plugins/online-payment/') ? 'PR C' : 'PR B'),
    reason: (file) => (file.startsWith('plugins/online-payment/')
      ? 'the Qonto invoice line keeps its own TTC to HT cut until PR C switches it (lead decision: no Qonto change in PR A)'
      : 'a reader of the VAT split that PR B switches to the vat/ component (finance, tourist tax, devis PDF, accounting export)'),
  },
  {
    name: 'platform-payment',
    isHome: (file) => file === 'utils/pricing/platformPayment.js',
    rules: [
      { re: /\bgross\s*-\s*\w*[pP]ayout/, probe: 'const commission = gross - payout - tax;' },
      { re: /\bdepositAmount\)?\s*-\s*(Number\()?[\w.]*acompteCommission/, probe: 'net = Number(depositAmount) - acompteCommission;' },
      { re: /-\s*\w*[tT]ax\s*-\s*acompteCommission/, probe: 'raw = gross - newPayout - tax - acompteCommission;' },
      { re: /-\s*acompteCommission\s*-\s*\w*[tT]ax/, probe: 'raw = gross - commission - acompteCommission - tax;' },
      { re: /platformGrossAmount[\s\S]{0,80}depositAmount[\s\S]{0,40}balanceAmount/, probe: 'const g = row.platformGrossAmount ?? (row.depositAmount + row.balanceAmount);' },
      { re: /\brent\s*-\s*[\w.]*netRent/, probe: 'const commission = rent - netRent;' },
      { re: /\bgrossAmount\s*-\s*[\w.]*payoutAmount/, probe: 'const withheld = grossAmount - booking.payoutAmount;' },
      { re: /[pP]ayout\w*\s*\+\s*(Math\.max\(\s*0\s*,\s*)?\(?\s*[\w.()]*[pP]enalt/, probe: 'const total = payout + Math.max(0, penalty);' },
      { re: /[pP]enalt\w*\s*\+\s*[\w.()]*[pP]ayout/, probe: 'const total = penalty + payoutAmount;' },
      { re: /acompteCommission\s*\+\s*[\w.()]*(solde|balance)\w*Commission|(solde|balance)\w*Commission\s*\+\s*[\w.()]*acompteCommission/, probe: 'const total = acompteCommission + soldeCommission;' },
      { re: /\btotalPlatformCommission\s*[:=]\s*round2\(/, probe: 'const totalPlatformCommission = round2(a + b);' },
    ],
    removedBy: (file) => (/expectedReceipts|ficheWriter|gites-de-france-intake|reservationLedger/.test(file) ? 'PR C' : 'PR B'),
    reason: (file) => (/expectedReceipts|ficheWriter|gites-de-france-intake|reservationLedger/.test(file)
      ? 'a reconciliation, intake or ledger reader of the payout figures that PR C routes through platformPayment.js'
      : 'a penalty, cancellation or settlement figure that PR B routes through platformPayment.js'),
  },
  {
    name: 'refunds',
    isHome: (file) => file.startsWith('utils/pricing/refunds/'),
    rules: [
      { re: /REFUND_EXCEEDS_\w+/, probe: "throw new Error('REFUND_EXCEEDS_SALE');" },
      { re: /\b(excessCents|duplicateCents)\s*[:=]/, probe: 'const excessCents = paid - due;' },
      { re: /\b(indemnityLeftTtc|saleLeftTtc|cashLeftTtc)\s*[:=]/, probe: 'const saleLeftTtc = sale - kept;' },
      { re: /\b(overCollectedTtc|scheduleOverCollectedTtc|complementCollectedExcess)\s*[:=]/, probe: 'const overCollectedTtc = paid - due;' },
      { re: /\bSUM\([^)]*(totalTtc|amountTtc)/, probe: "db.prepare('SELECT SUM(amountTtc) FROM refunds')" },
      { re: /\b(keptFromGuest|writtenOffBalance):\s*round2\(/, probe: 'keptFromGuest: round2(kept),' },
      { re: /\brefundOwed\s*:\s*true|\brefundCents\s*:\s*excess/, probe: 'return { refundOwed: true };' },
    ],
    removedBy: () => 'PR B',
    reason: (file, text, pr) => `a refund figure computed outside refunds/ until ${pr || 'PR B or PR C'} routes it through the component`,
  },
  {
    name: 'money',
    isHome: (file) => file === 'utils/pricing/money.js',
    rules: [
      {
        re: new RegExp(`\\bfunction\\s+${MONEY_NAMES}\\s*\\(|\\b(const|let|var)\\s+${MONEY_NAMES}\\s*=\\s*(async\\s*)?(\\([^)]*\\)|\\w+)\\s*=>|\\b(const|let|var)\\s+${MONEY_NAMES}\\s*=\\s*function`),
        probe: 'const round2 = (n) => Math.round(n * 100) / 100;',
      },
      { re: /\b(function|const)\s+roundHalfAway\b/, probe: 'const roundHalfAway = (n) => n;' },
      { re: /Math\.round\([^;]*\*\s*100\)\s*\/\s*100/, probe: 'return Math.round((a + b) * 100) / 100;' },
    ],
    removedBy: () => 'PR C',
    reason: () => 'a private rounding or cents helper: rule 38, PR C merges the copies once the replay proves each tie rule',
  },
  {
    name: 'dates',
    isHome: (file) => /(^|\/)stayClock[^/]*\.js$/.test(file),
    rules: [
      { re: /\b(startDate|arrivalDate|start_date)\b[^;\n]*\s(<=|<|>=|>)\s*[\w.]*([tT]oday\w*|getTodayIsoDate\(\))/, probe: ['const locked = Boolean(row && row.startDate && row.startDate <= today);', 'const started = row.arrivalDate < todayIso;'] },
      { re: /[\w.]*([tT]oday\w*|getTodayIsoDate\(\))\s*(<=|<|>=|>)\s*[\w.]*(startDate|arrivalDate|start_date)\b/, probe: 'const started = today >= r.start_date;' },
      { re: /\bhasGuestArrived\b/, probe: 'if (hasGuestArrived(row, now)) lock();' },
      { re: /\bisArrivalNotMarked\b/, probe: 'if (isArrivalNotMarked(row)) warn();' },
      { re: /\bfunction\s+isCheckoutDone\b/, probe: 'function isCheckoutDone(row, now) {}' },
      { re: /\bsasLockReason\(\s*\{\s*dateIso/, probe: 'sasLockReason({ dateIso, row });' },
    ],
  },
  {
    name: 'hourly',
    isHome: (file) => file === plugin('hourly-resources', 'hourlyPricing.js') || file === plugin('hourly-resources', 'hourlyFamily.js'),
    rules: [
      { re: /\bpriceRange\s*\(/, probe: 'price: priceRange(slot.start, slot.end, rate),' },
      { re: /\b(hourlyEveningRate|eveningRate|hourlyExternalEveningRate)\s*\*/, probe: 'const extra = eveningRate * hours;' },
      { re: /\*\s*[\w.]*(hourlyEveningRate|eveningRate)\b/, probe: 'const extra = hours * eveningRate;' },
    ],
  },
  {
    name: 'families',
    isHome: (file) => file.startsWith('utils/pricing/articles/'),
    rules: [
      { re: /\bgetTypeMultiplier\b/, probe: 'const multiplier = getTypeMultiplier(priceType, persons, nights);' },
      { re: /\b(persons|guests|nbPersons)\s*\*\s*(nights|nbNights)\b|\b(nights|nbNights)\s*\*\s*(persons|guests|nbPersons)\b/, probe: ['const units = nights * persons;', 'const units = persons * nights;'] },
    ],
  },
  {
    name: 'exporters',
    isHome: () => false,
    scope: (file) => file.startsWith(`${plugin('accounting-export')}/`) && !file.includes('/tests/'),
    rules: [
      { re: /require\(\s*['"][^'"]*\/vat(\/[^'"]*)?['"]\s*\)/, probe: "const { vatOf } = require('../../utils/pricing/vat');" },
      { re: /require\(\s*['"][^'"]*\/articles(\/[^'"]*)?['"]\s*\)/, probe: "const articles = require('../../utils/pricing/articles');" },
      { re: /require\(\s*['"][^'"]*pricing\/(pipelines?|compose|steps\/[^'"]*)['"]\s*\)/, probe: "const { compose } = require('../../utils/pricing/compose');" },
      { re: /require\(\s*['"][^'"]*utils\/pricing(\.js|\/index(\.js)?)?['"]\s*\)/, probe: "const { roundMoney } = require('../../utils/pricing');" },
    ],
  },
];

for (const guard of GUARDS) guard.patterns = guard.rules.map((rule) => rule.re);

// The PR that empties each list (rule 66: the lists must be empty at the end of PR C).
// Rule 45's table of today's call sites, by file: B moves the decisions of the fiche, the mid-stay window, the checkout and
// the SAS; C the lock, the lists, the guest app, the intakes and the module `arrivalMoment`. Date-window checks of an entered
// date and slot logic that the pattern also meets are listed with C, where each one is judged.
const DATES_IN_B = Object.freeze([
  'models/reservationsModel.js', 'utils/midStayExtrasWindow.js', 'utils/endOfStayCheckout.js', plugin('sas', 'controller.js'),
  'utils/sasEditWindow.js', 'utils/receptionView.js', // the SAS lock reason that row of the table calls
]);
const datesRemovedBy = (file, text) => {
  if (file === 'controllers/reservationsController.js') return /pastReservationLocked|const started\b/.test(text) ? 'PR C' : 'PR B';
  return DATES_IN_B.includes(file) ? 'PR B' : 'PR C';
};

const REMOVED_BY = Object.freeze({
  dates: datesRemovedBy,
  hourly: () => 'PR B', // rules 24-26: the evening supplement is identical from the shop, the SAS and the fiche
  families: () => 'PR B', // rules 47-49: every seller prices through the Articles head
  exporters: () => 'PR B', // rule 63: exporters read neutral entries
});
const REASONS = Object.freeze({
  dates: (file, text) => (/pastReservationLocked|const started\b/.test(text) && file === 'controllers/reservationsController.js'
    ? 'a started-stay refusal that PR C judges with the lists'
    : 'a call site of rule 45\'s table: the decision moves behind the stay clock in the PR named here'),
  hourly: () => 'the hourly grid is read by the shop, the SAS and the fiche until PR B routes them through the family',
  families: () => 'a seller that multiplies by persons and nights itself until PR B routes it through the Articles head',
  exporters: () => 'an exporter that reaches a pricing module: it reads neutral entries from PR B on',
});

const removedByOf = (guard, file, text) => (guard.removedBy || REMOVED_BY[guard.name])(file, text);
const reasonOf = (guard, file, text, pr) => (guard.reason || REASONS[guard.name])(file, text, pr);

module.exports = { GUARDS, removedByOf, reasonOf, plugin };
