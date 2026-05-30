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

// Human label per account number — drives the "intitulé" column in the visual journal preview on the
// Comptabilité page (not in the CSV itself, which keeps to the accountant's column list).
const ACCOUNT_LABELS = {
  [REVENUE_ACCOUNTS.ACCOMMODATION]: 'Location gîte',
  [REVENUE_ACCOUNTS.COMPLEMENTARY]: 'Prestation complémentaire',
  [REVENUE_ACCOUNTS.ACTIVITIES]:    'Activité diverse',
  [VAT_ACCOUNTS.REDUCED_10]:  'TVA 10 %',
  [VAT_ACCOUNTS.STANDARD_20]: 'TVA 20 %',
};

function accountLabel(account) {
  if (ACCOUNT_LABELS[account]) return ACCOUNT_LABELS[account];
  if (String(account || '').startsWith('C')) return 'Compte client';
  return '';
}

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
// non-alphanumerics removed. N = 6 by default (common French convention; trivial to tweak when Adrien's
// accountant sends their example). Pads with `X` if shorter, so the suffix length is stable.
const CLIENT_ACCOUNT_NAME_CHARS = 6;

function buildClientAccount(lastName, { chars = CLIENT_ACCOUNT_NAME_CHARS } = {}) {
  const raw = String(lastName || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const padded = (cleaned + 'X'.repeat(chars)).slice(0, chars);
  return `C${padded}`;
}

// How a sale's amounts are sourced. 'net' = owner-received (`finalPrice`); 'gross' = guest-paid
// (`clientGrossAmount`). Wired here so the choice is explicit and one-place-changeable.
const RECOGNISE_REVENUE_ON = 'net';

module.exports = {
  REVENUE_ACCOUNTS,
  VAT_ACCOUNTS,
  ACCOUNT_LABELS,
  BUCKET_TO_ACCOUNT,
  vatAccountForRate,
  accountLabel,
  CLIENT_ACCOUNT_NAME_CHARS,
  buildClientAccount,
  RECOGNISE_REVENUE_ON,
};
