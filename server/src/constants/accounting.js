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

// accounting-platform-commission-and-no-deposit.md §3.1.
// Fallback compte commission when a platform row doesn't have its own number set on
// `/comptabilite/plateformes` AND the global default in app_settings is somehow NULL
// (defensive — the schema default is also '622600').
const DEFAULT_COMMISSION_ACCOUNT = '622600';
// Compte de TVA déductible sur les commissions plateforme. Une seule ligne unique au tier;
// le taux (default 20 %) est configuré globalement dans Settings (vatRateCommission).
const VAT_DEDUCTIBLE_COMMISSION_ACCOUNT = '44566000';

// specs/cancellation-compensation.md §3.3 rule 16. Compte crédité quand une plateforme verse une
// indemnité pour un séjour annulé : un produit divers de gestion courante, PAS du chiffre d'affaires
// hébergement (aucune nuitée n'a été vendue). Fallback quand le réglage global est vide; le taux de
// TVA associé (0 % par défaut = hors champ) vit dans app_settings.vatRateCancellationCompensation.
const DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT = '75880000';

// Well-known commission accounts the accountant uses. Adrien's accountant gave these by
// email 2026-06-04; new platforms get a generic `622600` fallback until the operator
// configures the right number on `/comptabilite/plateformes`.
const COMMISSION_ACCOUNT_LABELS = {
  '622600':   'Frais commission générique',
  '62260300': 'Frais Airbnb',
  '62260400': 'Frais Abritel',
  '62260500': 'Frais Gîtes de France',
  '62260600': 'Frais Stripe',
};

function commissionAccountLabel(account) {
  const key = String(account || '').trim();
  if (COMMISSION_ACCOUNT_LABELS[key]) return COMMISSION_ACCOUNT_LABELS[key];
  if (key) return `Frais commission (${key})`;
  return '';
}

// Human label per account number — drives the "intitulé" column in the visual journal preview on the
// Comptabilité page (not in the CSV itself, which keeps to the accountant's column list).
const ACCOUNT_LABELS = {
  [REVENUE_ACCOUNTS.ACCOMMODATION]: 'Location gîte',
  [REVENUE_ACCOUNTS.COMPLEMENTARY]: 'Prestation complémentaire',
  [REVENUE_ACCOUNTS.ACTIVITIES]:    'Activité diverse',
  [VAT_ACCOUNTS.REDUCED_10]:  'TVA 10 %',
  [VAT_ACCOUNTS.STANDARD_20]: 'TVA 20 %',
  [PASS_THROUGH_ACCOUNTS.TOURIST_TAX]: 'Taxe de séjour',
  [VAT_DEDUCTIBLE_COMMISSION_ACCOUNT]: 'TVA déductible commission',
  [DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT]: "Indemnité d'annulation",
};

function accountLabel(account) {
  if (ACCOUNT_LABELS[account]) return ACCOUNT_LABELS[account];
  if (String(account || '').startsWith('C')) return 'Compte client';
  // Dynamic commission accounts (any 6226xx beyond the well-known map).
  if (String(account || '').startsWith('6226')) return commissionAccountLabel(account);
  // Any 75xxxx the operator configures for cancellation compensations (75880000 is only the default).
  if (String(account || '').startsWith('75')) return "Indemnité d'annulation";
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

// Refund (« avoir ») buckets → account. Same three revenue accounts as a sale, plus the tourist-tax
// pass-through: giving back a tax the guest paid us reverses the 46710000 line, never a 70xxx one
// (specs/reservation-refunds.md §3.4 rule 22).
const REFUND_BUCKET_TO_ACCOUNT = {
  ...BUCKET_TO_ACCOUNT,
  touristTax: PASS_THROUGH_ACCOUNTS.TOURIST_TAX,
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

// How a sale's amounts are sourced. 'gross' = guest-paid (`clientGrossAmount`); 'net' = owner-
// received (`finalPrice`). Switched to 'gross' on 2026-06-04 per the accountant's email + the
// commission-as-journal-line rework (spec accounting-platform-commission-and-no-deposit.md §3.5
// rule 12). For directs gross === finalPrice (populated by the reservations model + boot
// backfill), so the entry shape collapses to the legacy direct one (no commission lines).
const RECOGNISE_REVENUE_ON = 'gross';

module.exports = {
  REVENUE_ACCOUNTS,
  VAT_ACCOUNTS,
  PASS_THROUGH_ACCOUNTS,
  ACCOUNT_LABELS,
  COMMISSION_ACCOUNT_LABELS,
  DEFAULT_COMMISSION_ACCOUNT,
  VAT_DEDUCTIBLE_COMMISSION_ACCOUNT,
  DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT,
  BUCKET_TO_ACCOUNT,
  REFUND_BUCKET_TO_ACCOUNT,
  vatAccountForRate,
  accountLabel,
  commissionAccountLabel,
  CLIENT_ACCOUNT_NAME_CHARS,
  buildClientAccount,
  RECOGNISE_REVENUE_ON,
  SALES_JOURNAL_CODE,
};
