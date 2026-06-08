/**
 * Devis PDF label maps — French + English.
 *
 * Single source of truth for every literal the devis PDF renders. The renderer calls
 * `labels(language).<key>`; missing language throws (fail-loud) so a typo can't silently
 * leak French into an EN PDF.
 *
 * Some entries are functions (n => string) for pluralisation / parameterised phrases.
 * Tests assert key parity between FR and EN — keep the two maps shape-identical.
 *
 * See specs/devis-english-language.md §3 rules 2, 4, 5, 8, 9, 10, 11.
 */

const FR = Object.freeze({
  // ── Header ────────────────────────────────────────────────────────────────
  documentTitle:   'DEVIS',
  documentNumber:  (n) => `N° ${n}`,

  // ── Issuer / client blocks ────────────────────────────────────────────────
  issuer:          'ÉMETTEUR',
  client:          'CLIENT',
  phonePrefix:     'Tél : ',
  emailPrefix:     'Email : ',

  // ── Meta pills (date / valid until / property) ────────────────────────────
  date:            'Date du devis',
  validUntil:      'Valable jusqu\'au',
  property:        'Logement',

  // ── Stay block ────────────────────────────────────────────────────────────
  stayHeading:     'DÉTAIL DU SÉJOUR',
  arrival:         'Arrivée',
  departure:       'Départ',
  duration:        'Durée',
  durationValue:   (nights) => `${nights} nuit${nights > 1 ? 's' : ''}`,
  adults:          'Adultes',
  teens:           'Adolescents',
  children:        'Enfants',
  babies:          'Bébés',

  // ── Pricing table headers ─────────────────────────────────────────────────
  pricingHeading:  'DÉTAIL TARIFAIRE',
  colDesignation:  'Désignation',
  colQuantity:     'Qté',
  colUnitPriceHt:  'Prix HT',
  colVatRate:      'TVA %',
  colTotalTtc:     'Total TTC',

  // ── Accommodation row ─────────────────────────────────────────────────────
  accommodation:           (nights) => `Hébergement — ${nights} nuit${nights > 1 ? 's' : ''}`,
  accommodationWithSeason: (nights, season) => (
    nights === 1
      ? `Hébergement — 1 nuit (${season})`
      : `Hébergement — ${nights} nuits (${season})`
  ),
  accommodationDiscount:   (pct) => `RÉDUCTION LOGEMENT ${pct}%`,

  // ── Option suffixes ───────────────────────────────────────────────────────
  extraHoursSuffix: (label) => `${label} suppl.`,
  offered:          'OFFERT',

  // ── Bank block ────────────────────────────────────────────────────────────
  bankHeading:     'COORDONNÉES BANCAIRES',
  bankAccount:     'Dénomination du compte : ',
  bankBic:         'BIC : ',
  bankIban:        'IBAN : ',

  // ── Totals ────────────────────────────────────────────────────────────────
  subtotalHt:      'Sous-total HT',
  subtotalTtc:     'Sous-total TTC',
  touristTax:      'Taxe de séjour',
  touristTaxBreakdown: (persons, nights, rate) => (
    `${persons} pers. × ${nights} nuit${nights > 1 ? 's' : ''} × ${rate} / pers./nuit`
  ),
  grandTotal:      'TOTAL TTC',

  // ── Payment terms ─────────────────────────────────────────────────────────
  paymentHeading:  'MODALITÉS DE RÈGLEMENT',
  depositLabel:    'Acompte :',
  balanceLabel:    'Solde :',
  payBefore:       'À payer avant le ',
  cautionLabel:    'Caution :',
  cautionOnArrival: ' — à remettre le jour de votre arrivée',

  // ── Footer / page numbers ─────────────────────────────────────────────────
  defaultFooter:   'Nous vous remercions de votre intérêt et restons à votre disposition pour tout renseignement complémentaire. Dans l\'attente de votre confirmation, nous vous souhaitons une excellente journée.',
  siret:           'SIRET : ',
  vatNumber:       'N° TVA : ',
  pageNumber:      (i, n) => `Page ${i} / ${n}`,
});

const EN = Object.freeze({
  // ── Header ────────────────────────────────────────────────────────────────
  documentTitle:   'QUOTE',
  documentNumber:  (n) => `No. ${n}`,

  // ── Issuer / client blocks ────────────────────────────────────────────────
  issuer:          'ISSUER',
  client:          'CLIENT',
  phonePrefix:     'Phone: ',
  emailPrefix:     'Email: ',

  // ── Meta pills ────────────────────────────────────────────────────────────
  date:            'Quote date',
  validUntil:      'Valid until',
  property:        'Property',

  // ── Stay block ────────────────────────────────────────────────────────────
  stayHeading:     'STAY DETAILS',
  arrival:         'Check-in',
  departure:       'Check-out',
  duration:        'Duration',
  durationValue:   (nights) => `${nights} night${nights > 1 ? 's' : ''}`,
  adults:          'Adults',
  teens:           'Teens',
  children:        'Children',
  babies:          'Babies',

  // ── Pricing table headers ─────────────────────────────────────────────────
  pricingHeading:  'PRICING DETAILS',
  colDesignation:  'Description',
  colQuantity:     'Qty',
  colUnitPriceHt:  'Price excl. VAT',
  colVatRate:      'VAT %',
  colTotalTtc:     'Total incl. VAT',

  // ── Accommodation row ─────────────────────────────────────────────────────
  accommodation:           (nights) => `Accommodation — ${nights} night${nights > 1 ? 's' : ''}`,
  accommodationWithSeason: (nights, season) => (
    nights === 1
      ? `Accommodation — 1 night (${season})`
      : `Accommodation — ${nights} nights (${season})`
  ),
  accommodationDiscount:   (pct) => `ACCOMMODATION DISCOUNT ${pct}%`,

  // ── Option suffixes ───────────────────────────────────────────────────────
  extraHoursSuffix: (label) => `${label} extra`,
  offered:          'INCLUDED',

  // ── Bank block ────────────────────────────────────────────────────────────
  bankHeading:     'BANK DETAILS',
  bankAccount:     'Account name: ',
  bankBic:         'BIC: ',
  bankIban:        'IBAN: ',

  // ── Totals ────────────────────────────────────────────────────────────────
  subtotalHt:      'Subtotal excl. VAT',
  subtotalTtc:     'Subtotal incl. VAT',
  touristTax:      'Tourist tax',
  touristTaxBreakdown: (persons, nights, rate) => (
    `${persons} guest${persons > 1 ? 's' : ''} × ${nights} night${nights > 1 ? 's' : ''} × ${rate} / guest / night`
  ),
  grandTotal:      'TOTAL incl. VAT',

  // ── Payment terms ─────────────────────────────────────────────────────────
  paymentHeading:  'PAYMENT TERMS',
  depositLabel:    'Deposit:',
  balanceLabel:    'Balance:',
  payBefore:       'Due before ',
  cautionLabel:    'Security deposit:',
  cautionOnArrival: ' — payable on arrival',

  // ── Footer / page numbers ─────────────────────────────────────────────────
  defaultFooter:   'We thank you for your interest and remain at your disposal for any further information. We look forward to your confirmation. Have a great day.',
  siret:           'SIRET: ',
  vatNumber:       'VAT No.: ',
  pageNumber:      (i, n) => `Page ${i} / ${n}`,
});

const MAPS = { fr: FR, en: EN };

function labels(language) {
  const lang = String(language || '').toLowerCase();
  const map = MAPS[lang];
  if (!map) {
    throw new Error(`devisPdfLabels: unknown language "${language}" (supported: ${Object.keys(MAPS).join(', ')})`);
  }
  return map;
}

// Exposed for tests + future "supported language list" UI.
function supportedLanguages() {
  return Object.keys(MAPS);
}

module.exports = {
  labels,
  supportedLanguages,
  FR,
  EN,
};
