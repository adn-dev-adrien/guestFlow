const {
  computePlatformCommission, commissionOf, taxPaidWithPayout,
} = require('./pricing/platformPayment');

/**
 * The tourist tax a platform pays us with its transfer, from the box of a stay's statement and the platform's own mode
 * (specs/platform-host-statement-and-commission-vat.md rules 5, 8). Required lazily: the platforms model opens the database.
 */
function taxPaidOf({ platform, box }) {
  const mode = require('../models/platformsModel').getTouristTaxCollection(platform);
  return taxPaidWithPayout({ mode, box });
}

/**
 * « Calculer la commission » (rule 8) for a stay of `platform`: the figures are the statement's as typed on the fiche
 * (`touristTax` is the box), the platform's mode decides whether the box adds to the host amount.
 */
function statementCommission({
  platform, gross, payout, touristTax, acompteCommission,
}) {
  return computePlatformCommission({
    gross, payout, touristTax: taxPaidOf({ platform, box: touristTax }), acompteCommission,
  });
}

module.exports = {
  computePlatformCommission, commissionOf, taxPaidOf, statementCommission,
};
