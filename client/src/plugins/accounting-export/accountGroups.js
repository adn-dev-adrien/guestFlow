/**
 * The « Comptes » card of the Plan comptable page, as data (specs/settings-input-guards.md rules 32-34).
 * Every account the plugin asks for sits in one of the labelled groups below; adding an account is one
 * line in the right group (and a label in PLAN_LABELS when it comes from the account plan).
 *
 * A field `source` says where its value lives on the page:
 *   - 'plan'         — a row of the account plan the server sends (`plan: [{ key, value, default }]`)
 *   - 'default'      — the default commission account
 *   - 'compensation' — the cancellation-compensation account
 *   - 'vatCompensation' — the VAT rate (%) on cancellation compensations, shown right after it
 *
 * A plan field may carry a `kind`: `account` (the default: digits), `code` (a VAT code of the CSV's last column, capitals) or `switch`
 * (a setting stored as '0' / '1').
 */

// specs/plugins-phase-p-productisation.md rules 27–28 — the account plan, one field per role.
export const PLAN_LABELS = {
  accommodationAccount: 'Hébergement',
  complementaryAccount: 'Prestations complémentaires',
  activitiesAccount: 'Activités',
  vat20Account: 'TVA collectée 20 %',
  vat10Account: 'TVA collectée 10 %',
  touristTaxAccount: 'Taxe de séjour',
  commissionVatAccount: 'TVA déductible (commissions)',
  discountAccount: 'Rabais accordés',
  tipAccount: 'Pourboires',
  platformPenaltyAccount: 'Pénalités plateformes',
  journalCode: 'Code journal des ventes',
  // specs/platform-host-statement-and-commission-vat.md rules 14-16 — the account of each regime of a commission, the self-assessed VAT, the codes.
  commissionFrAccount: 'Plateformes France — TVA 20 % déductible',
  commissionEuAccount: 'Plateformes UE — autoliquidation',
  commissionNoVatAccount: 'Plateformes sans TVA, frais de paiement',
  reverseChargeDeductibleAccount: 'TVA déductible autoliquidée',
  reverseChargeDueAccount: 'TVA due intracommunautaire',
  reverseChargeLines: 'Écrire l’autoliquidation dans l’export',
  vatCodeRate10: 'Ventes à 10 %',
  vatCodeRate20: 'Ventes à 20 %',
  vatCodeRate55: 'Ventes à 5,5 %',
  vatCodeReverseCharge: 'Commission UE (autoliquidation)',
  vatCodeDeductible20: 'Commission France (TVA déductible)',
};

export const ACCOUNT_GROUPS = [
  {
    key: 'sales',
    label: 'Ventes',
    fields: [
      { key: 'accommodationAccount' },
      { key: 'complementaryAccount' },
      { key: 'activitiesAccount' },
      { key: 'discountAccount' },
    ],
  },
  {
    key: 'taxes',
    label: 'Taxes',
    fields: [
      { key: 'vat20Account' },
      { key: 'vat10Account' },
      { key: 'touristTaxAccount' },
      { key: 'commissionVatAccount' },
      { key: 'reverseChargeDeductibleAccount' },
      { key: 'reverseChargeDueAccount' },
      { key: 'reverseChargeLines', kind: 'switch', helper: 'Décocher si le code « autoliquidation » du logiciel du cabinet génère déjà ces deux lignes.' },
    ],
  },
  {
    key: 'regimes',
    label: 'Comptes de commission par régime de TVA',
    fields: [
      { key: 'commissionFrAccount' },
      { key: 'commissionEuAccount' },
      { key: 'commissionNoVatAccount' },
    ],
  },
  {
    key: 'misc',
    label: 'Commissions et produits divers',
    fields: [
      { key: 'defaultAccount', source: 'default', label: 'Commission par défaut', helper: 'Pour les plateformes sans compte propre.' },
      { key: 'compensationAccount', source: 'compensation', label: "Indemnités d'annulation", helper: "Crédité quand une plateforme indemnise une annulation." },
      { key: 'vatRateCompensation', source: 'vatCompensation', label: 'TVA sur indemnités (%)', helper: '0 % = hors champ de TVA.' },
      { key: 'tipAccount' },
      { key: 'platformPenaltyAccount' },
    ],
  },
  {
    key: 'journal',
    label: 'Journal',
    fields: [{ key: 'journalCode' }],
  },
  {
    key: 'vatCodes',
    label: 'Codes TVA (dernière colonne du fichier)',
    fields: [
      { key: 'vatCodeRate10', kind: 'code' },
      { key: 'vatCodeRate20', kind: 'code' },
      { key: 'vatCodeRate55', kind: 'code' },
      { key: 'vatCodeReverseCharge', kind: 'code' },
      { key: 'vatCodeDeductible20', kind: 'code' },
    ],
  },
];

/**
 * The groups to render for the plan rows the server sent: plan fields appear only when the server
 * knows them, the two older accounts always do, a plan row the page does not know yet goes at the end
 * of the first group with its key as label, and an empty group is dropped.
 */
export function accountGroupsFor(planRows = []) {
  const known = new Set(ACCOUNT_GROUPS.flatMap((g) => g.fields.map((f) => f.key)));
  const rowByKey = new Map(planRows.map((r) => [r.key, r]));
  const groups = ACCOUNT_GROUPS.map((group, index) => {
    const fields = group.fields
      .filter((f) => f.source || rowByKey.has(f.key))
      .map((f) => ({
        source: 'plan',
        label: PLAN_LABELS[f.key] || f.key,
        ...f,
        ...(f.source || f.helper ? {} : { helper: `Par défaut : ${rowByKey.get(f.key).default || 'aucun'}` }),
      }));
    if (index === 0) {
      planRows.filter((r) => !known.has(r.key)).forEach((r) => {
        fields.push({ key: r.key, source: 'plan', label: PLAN_LABELS[r.key] || r.key, helper: `Par défaut : ${r.default}` });
      });
    }
    return { ...group, fields };
  });
  return groups.filter((g) => g.fields.length > 0);
}
