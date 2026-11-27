/**
 * The drawing of the voucher's back that GuestFlow 4.7.0 sent (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md K10, CLAUDE.md §5.6): the dimensions and the words a connector
 * before 1.27.0 turns into the CSS variables and the texts of its own stylesheet. `/offer` keeps sending them as `back.layout` and `back.texts`, key for key, so a connector that has
 * not been updated still draws a back; the redrawn back travels under `back.design` (`cardBack.js`). Frozen: never edited, only removed with the connector versions that read it.
 */

const LEGACY_BACK_LAYOUT = Object.freeze({
  trimMm: Object.freeze({ width: 105, height: 148 }),
  safeMm: 5,
  legalStripMm: 5,
  qrMm: 23,
  logoMm: 12,
  footerLineMm: 4,
  qrGapMm: 3,
  afterQrMm: 3,
  afterItemsMm: 1.5,
  afterMessageMm: 2,
  lineHeight: Object.freeze({ sans: 1.326, serif: 1.371 }),
  pt: Object.freeze({
    logoGap: 8, logoName: 13, title: 20, titleSpacing: 2, titleGap: 4, ruleHalf: 20, ruleStroke: 0.6, ruleGap: 8, heading: 10, headingGap: 4, scan: 8.5, scanGap: 3, link: 8.5,
    includes: 9.5, includesGap: 2, item: 8.5, itemGap: 1, parties: 9.5, partiesGap: 1, message: 8.5, messageGap: 1, codeLabel: 7.5, codeLabelGap: 1, code: 15,
    codeGap: 3, codeSpacing: 0.5, valid: 9, footer: 8, legal: 7,
  }),
  lines: Object.freeze({
    logoName: 2, scan: 3, link: 3, items: 7, itemText: 2, parties: 2, message: 4,
  }),
});

const LEGACY_BACK_TEXTS = Object.freeze({
  title: 'BON CADEAU',
  howTo: 'Pour l’utiliser',
  scan: 'Scannez pour réserver votre cadeau ou suivez ce lien :',
  includes: 'Votre bon comprend :',
  bullet: '•',
  recipient: 'Pour {name}',
  sender: 'de la part de {name}',
  codeLabel: 'Votre code',
  codePlaceholder: 'XXXX-XXXX-XXXX-XXXX',
  validUntil: 'Valable jusqu’au {date}',
  legal: 'Ne pas jeter sur la voie publique.',
});

module.exports = { LEGACY_BACK_LAYOUT, LEGACY_BACK_TEXTS };
