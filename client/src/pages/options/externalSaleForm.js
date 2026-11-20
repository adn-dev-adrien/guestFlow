/**
 * The « Vendable hors séjour » block of an article form (specs/outside-booking-sas.md rule 11): the stored article ⇄ the form, and the payload the server takes.
 * The class's external rate is sent only once the operator typed it (a rate typed for a class is the rate of the whole class); a rate typed then emptied is sent empty,
 * so the server refuses it (loop t2 UI2-8) instead of the save keeping the old rate in silence. The server judges the rest.
 */

export const emptyExternalSale = { sellableExternally: false, vatClass: '', externalVatRate: null };

export const externalSaleFromItem = (item) => ({
  sellableExternally: Boolean(Number(item.sellableExternally)),
  vatClass: item.vatClass || '',
  externalVatRate: null,
});

export function externalSalePayload(form) {
  const typed = form.externalVatRate != null;
  const rate = String(form.externalVatRate ?? '').trim();
  return {
    sellableExternally: Boolean(form.sellableExternally),
    ...(form.vatClass ? { vatClass: form.vatClass } : {}),
    ...(typed ? { externalVatRate: rate === '' ? '' : Number(rate.replace(',', '.')) } : {}),
  };
}

export const EXTERNAL_FIELDS = ['sellableExternally', 'vatClass', 'externalVatRate'];
