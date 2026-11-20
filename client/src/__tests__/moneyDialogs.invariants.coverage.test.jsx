// specs/plugins-phase-1-sdk.md rule 58 (loop t26) — the generative harness covers every money dialog, read from the code: every file that
// previews money through the shared hook (or one built on it), draws tender lines or commits a report of them, or renders a sale block.
// A file added to that set fails here until a family of `moneyDialogs.invariants.*.test.jsx` drives it.
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');
// By behaviour too (loop t26 verifier): any file that asks the server for a quote or a preview (`api.quote…(` / `api.preview…(`) previews
// money unless it is listed below as previewing something else.
const ASKS = /\bapi\.(quote|preview)[A-Za-z]*\(/;
const NOT_MONEY = {
  'components/EmailManualSendDialog.jsx': 'previews an e-mail text',
  'components/OnboardingEmailsStep.jsx': 'previews an e-mail text',
  'pages/settings/EmailTextsSettingsPage.jsx': 'previews an e-mail text',
  'pages/settings/TermsSettingsPage.jsx': 'previews the terms text',
  'pages/PropertyPricingSeasonsPage.jsx': 'previews a price configuration (seasons, degressivity); nothing is collected or sold',
  'plugins/tariff-recipes/TariffRecipeCard.jsx': 'previews a tariff recipe before it is applied; nothing is collected or sold',
  'plugins/linen/LaundryExtraTripDialog.jsx': 'previews laundry trip dates; no amount',
  'plugins/linen/LaundryScheduleSection.jsx': 'previews laundry dates; no amount',
};
const MEMBER = /\b(useLatestPreview|useVisitQuote|useResourceBookingPreview|useSasRecapPreview|useMoneyCommit)\(|<(TenderLines|BookingPaymentFields|BookingInvoiceBlock|StandaloneSaleDialog|StaySalesSection|SuggestedArticlesStep|SalePaymentLink)\b|\b(tendersForDue|paymentForDue)\(/;

function filesOf(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : filesOf(full);
    return /\.jsx?$/.test(entry.name) ? [full] : [];
  });
}

// Each member and the families whose generated runs drive it (a shared piece: every family that draws it).
const TENDERS = ['counter', 'visit', 'booking', 'sas', 'note', 'fiche'];
const PREVIEWS = ['counter', 'visit', 'booking', 'sas', 'note', 'penalty', 'reconciliation'];
const MEMBERS = {
  'components/StandaloneSaleDialog.jsx': ['counter'],
  'components/AddProductDialog.jsx': ['product'],
  'pages/FinancePage.jsx': ['counter'],
  'components/TenderLines.jsx': TENDERS,
  'components/reservation/FinanceSection.jsx': ['fiche'],
  'components/reservation/PaymentMarkForm.jsx': ['fiche'],
  'components/reservation/MidStayNoteDialog.jsx': ['note'],
  'components/reservation/PlatformPenaltyDialog.jsx': ['penalty'],
  'hooks/useLatestPreview.js': PREVIEWS,
  'hooks/useMoneyCommit.jsx': [...new Set([...PREVIEWS, ...TENDERS])],
  'plugins/hourly-resources/BookingPaymentFields.jsx': ['visit', 'booking'],
  'plugins/hourly-resources/ResourceArrivalDialog.jsx': ['visit'],
  'plugins/hourly-resources/useVisitQuote.js': ['visit'],
  'plugins/hourly-resources/ResourceBookingDialog.jsx': ['booking'],
  'plugins/hourly-resources/useResourceBookingPreview.js': ['booking'],
  'plugins/online-payment/LinkTransactionDialog.jsx': ['reconciliation'],
  'plugins/online-payment/SplitSharesDialog.jsx': ['reconciliation'],
  'plugins/sas/ReservationSasDialog.jsx': ['sas'],
  'plugins/sas/useSasRecapPreview.js': ['sas'],
};
// The component each family renders (the host page of the counter is FinancePage: the family drives the dialog it opens).
const RENDERS = {
  counter: ['StandaloneSaleDialog'],
  visit: ['ResourceArrivalDialog'],
  booking: ['ResourceBookingDialog'],
  sas: ['renderDialog'],
  note: ['MidStayNoteDialog'],
  penalty: ['PlatformPenaltyDialog'],
  reconciliation: ['SplitSharesDialog', 'LinkTransactionDialog'],
  fiche: ['FinanceSection'],
  product: ['AddProductDialog'],
};

test('the money dialogs read from the code are exactly the members the harness drives', () => {
  const found = filesOf(SRC)
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((f) => !/\.test\.jsx?$/.test(f))
    .filter((f) => {
      const text = fs.readFileSync(path.join(SRC, f), 'utf8');
      return MEMBER.test(text) || (ASKS.test(text) && !NOT_MONEY[f]);
    })
    .filter((f) => fs.existsSync(path.join(SRC, f)))
    .sort();
  const known = Object.keys(MEMBERS).filter((f) => fs.existsSync(path.join(SRC, f))).sort();
  expect(found).toEqual(known);
});

test.each(Object.keys(RENDERS))('the family « %s » has its generated suite, which renders its dialog', (family) => {
  const file = path.join(__dirname, `moneyDialogs.invariants.${family}.test.jsx`);
  expect(fs.existsSync(file)).toBe(true);
  const text = fs.readFileSync(file, 'utf8');
  RENDERS[family].forEach((name) => expect(text).toMatch(new RegExp(`\\b${name}\\b`)));
  expect(text).toMatch(/runFamily\(/);
});

test('every member is driven by at least one family that exists', () => {
  Object.entries(MEMBERS).forEach(([, families]) => families.forEach((family) => expect(Object.keys(RENDERS)).toContain(family)));
});
