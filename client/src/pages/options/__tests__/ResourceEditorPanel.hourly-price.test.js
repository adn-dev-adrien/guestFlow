// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 1 — a resource that becomes hourly starts with its guests' price empty and required, not the « 0 » of a fresh form.
import { emptyResourceFor, validateResourceForm } from '../resourceForm';
import { hourlyPriceForm } from '../../../plugins/hourly-resources/hourlyPriceForm';

const FORMS = [hourlyPriceForm];

test('an hourly price left empty is refused by the form; the source of the « 0 » is the fresh form, not the grids', () => {
  const fresh = { ...emptyResourceFor(FORMS), name: 'Bain', priceType: 'per_hour', showsPlanningCard: true, price: '' };
  expect(validateResourceForm(fresh, FORMS).price).toBe('Le tarif logés (journée, 1re heure) doit être un montant positif.');
});
