// The part of a fiche the removal matrix compares to the cent (specs/plugin-removal-resilience.md rule 12).
const FIELDS = ['totalPrice', 'finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'clientGrossAmount',
  'touristTaxRate', 'touristTaxTotal', 'remainingDue', 'platformGrossAmount', 'platformPayoutAmount', 'platformCommissionAmount'];
const LINE_FIELDS = ['optionId', 'resourceId', 'quantity', 'unitPrice', 'billedUnits', 'priceType', 'totalPrice', 'offered', 'sessions'];

const pick = (object, keys) => Object.fromEntries(keys.filter((k) => k in object).map((k) => [k, object[k]]));

function money(fiche) {
  return {
    ...Object.fromEntries(FIELDS.map((k) => [k, fiche[k] === undefined ? null : fiche[k]])),
    options: (fiche.options || []).map((o) => pick(o, LINE_FIELDS)),
    resources: (fiche.resources || []).map((r) => pick(r, LINE_FIELDS)),
  };
}

module.exports = { money };
