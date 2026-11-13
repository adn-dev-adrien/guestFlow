/**
 * The « Vendable hors séjour » block of an article form (specs/outside-booking-sas.md rule 11): the stored article ⇄ the form, and the payload the server takes.
 * The class's external rate is sent only once the operator typed it (a rate typed for a class is the rate of the whole class); the server judges the rest.
 */

export const emptyExternalSale = { sellableExternally: false, vatClass: '', externalVatRate: '' };

export const externalSaleFromItem = (item) => ({
  sellableExternally: Boolean(Number(item.sellableExternally)),
  vatClass: item.vatClass || '',
  externalVatRate: '',
});

export function externalSalePayload(form) {
  const rate = String(form.externalVatRate ?? '').trim();
  return {
    sellableExternally: Boolean(form.sellableExternally),
    ...(form.vatClass ? { vatClass: form.vatClass } : {}),
    ...(rate !== '' ? { externalVatRate: Number(rate.replace(',', '.')) } : {}),
  };
}

export const EXTERNAL_FIELDS = ['sellableExternally', 'vatClass', 'externalVatRate'];
