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
        ...(f.source ? {} : { helper: `Par défaut : ${rowByKey.get(f.key).default}` }),
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
