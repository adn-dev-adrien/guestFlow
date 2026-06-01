/**
 * Accounting constants — the bridge between GuestFlow's revenue buckets and the accountant's chart of
 * accounts. Single source of truth for account numbers, bucket → account mapping, and the auxiliary
 * client-account format. See specs/accountant-accounting-export.md §3.4.
 *
 * Turnover basis (decided 2026-05-29): the accounting lines (70xxx + TVA) sit on the **net** (the
 * `finalPrice` the owner receives). For platform-sourced bookings, the gross (what the guest paid the
 * platform) and the commission appear only in the trailing info columns of the CSV. To switch to a
 * gross-as-turnover model, change `RECOGNISE_REVENUE_ON` and the bucket-amount source in
 * `accountingExport.js` — the rest stays.
 */

const REVENUE_ACCOUNTS = {
  ACCOMMODATION: '70600000', // LOCATION GITE
  COMPLEMENTARY: '70600010', // PRESTATIONS COMPLÉMENTAIRES GITE (options + custom options)
  ACTIVITIES:    '70601000', // ACTIVITÉS DIVERSES (resources)
};

const VAT_ACCOUNTS = {
  STANDARD_20: '44571200', // TVA 20%
  REDUCED_10:  '44571100', // TVA 10%
};

// Pass-through accounts — money on the customer's debit that isn't owner revenue. The
// `TOURIST_TAX` (46710000) mirrors the SOLIO export style: the tax is part of the
// encaissement TTC (so the customer's debit covers it), but credited to a "compte d'attente"
// because the owner owes it to the commune rather than recognising it as turnover.
const PASS_THROUGH_ACCOUNTS = {
  TOURIST_TAX: '46710000',
};

// Human label per account number — drives the "intitulé" column in the visual journal preview on the
// Comptabilité page (not in the CSV itself, which keeps to the accountant's column list).
const ACCOUNT_LABELS = {
  [REVENUE_ACCOUNTS.ACCOMMODATION]: 'Location gîte',
  [REVENUE_ACCOUNTS.COMPLEMENTARY]: 'Prestation complémentaire',
  [REVENUE_ACCOUNTS.ACTIVITIES]:    'Activité diverse',
  [VAT_ACCOUNTS.REDUCED_10]:  'TVA 10 %',
  [VAT_ACCOUNTS.STANDARD_20]: 'TVA 20 %',
  [PASS_THROUGH_ACCOUNTS.TOURIST_TAX]: 'Taxe de séjour',
};

function accountLabel(account) {
  if (ACCOUNT_LABELS[account]) return ACCOUNT_LABELS[account];
  if (String(account || '').startsWith('C')) return 'Compte client';
  return '';
}

// Journal de ventes — fixed in the column layout decided 2026-06-01 from Adrien's accountant
// example. Constant lives here so the column-set lives next to the other accounting bridges.
const SALES_JOURNAL_CODE = 'VT';

// Which revenue account each GuestFlow bucket lands in. See spec §3.4 rule 12.
const BUCKET_TO_ACCOUNT = {
  accommodation: REVENUE_ACCOUNTS.ACCOMMODATION,
  options:       REVENUE_ACCOUNTS.COMPLEMENTARY,
  customOptions: REVENUE_ACCOUNTS.COMPLEMENTARY, // custom options ride with options
  resources:     REVENUE_ACCOUNTS.ACTIVITIES,
};

// Resolve the VAT account from a rate (10 % → reduced ; everything else → standard).
function vatAccountForRate(ratePercent) {
  return Number(ratePercent) === 10 ? VAT_ACCOUNTS.REDUCED_10 : VAT_ACCOUNTS.STANDARD_20;
}

// Auxiliary client-account format: `C` + first N chars of the last name, uppercased, accent-stripped,
// non-alphanumerics removed. N = 6 (matches the accountant's example: `CNOTIN`, `CCAGGUI`).
// No X-padding — the accountant's example uses variable-width codes (`CNOTIN` = 6 chars,
// `CCAGGUI` = 7 chars). Empty / unknown names fall back to `CXXXXX` so the column is never
// blank (the accountant's import requires a non-empty customer code).
const CLIENT_ACCOUNT_NAME_CHARS = 6;
const CLIENT_ACCOUNT_FALLBACK = 'CXXXXX';

function buildClientAccount(lastName, { chars = CLIENT_ACCOUNT_NAME_CHARS } = {}) {
  const raw = String(lastName || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return CLIENT_ACCOUNT_FALLBACK;
  return `C${cleaned.slice(0, chars)}`;
}

// How a sale's amounts are sourced. 'net' = owner-received (`finalPrice`); 'gross' = guest-paid
// (`clientGrossAmount`). Wired here so the choice is explicit and one-place-changeable.
const RECOGNISE_REVENUE_ON = 'net';

module.exports = {
  REVENUE_ACCOUNTS,
  VAT_ACCOUNTS,
  PASS_THROUGH_ACCOUNTS,
  ACCOUNT_LABELS,
  BUCKET_TO_ACCOUNT,
  vatAccountForRate,
  accountLabel,
  CLIENT_ACCOUNT_NAME_CHARS,
  buildClientAccount,
  RECOGNISE_REVENUE_ON,
  SALES_JOURNAL_CODE,
};
