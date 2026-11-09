// The « Application clients » section of the option / resource editor (specs/guest-app.md rules 22, 37bis):
// the server's item view → an editable draft, and back to the PUT that writes only what changed. The server judges
// every value; the checks here only spare the operator a round trip.

export const MAX_DESCRIPTION = 140;

const text = (value) => (value === null || value === undefined ? '' : String(value));

/** `GET /api/guest-app/items/:kind/:id` → the fields as the section edits them (numbers as typed text). */
export function draftOf(view) {
  const stock = view.stock || {};
  return {
    sold: Boolean(view.sold),
    mediaId: view.mediaId ?? null,
    shortDescriptionFr: text(view.shortDescriptionFr),
    shortDescriptionEn: text(view.shortDescriptionEn),
    needsStaff: Boolean(view.needsStaff),
    leadMinutes: text(view.leadMinutes),
    maxQuantity: text(view.maxQuantity),
    stockTracked: Boolean(stock.tracked),
    // A count below zero reads « −2 » (rule 37ter); it is sent again only once retyped.
    stockQuantity: text(stock.quantityLabel ?? stock.quantity),
    stockAlertBelow: text(stock.alertBelow),
    soldOut: Boolean(stock.soldOut),
  };
}

const isInteger = (value) => /^\d+$/.test(String(value).trim());
const toInteger = (value) => Number(String(value).trim());

/** → `{ field: message }` for the values the server would refuse anyway. */
export function draftErrors(draft, { kind, saved }) {
  const errors = {};
  if (!isInteger(draft.maxQuantity) || toInteger(draft.maxQuantity) < 1 || toInteger(draft.maxQuantity) > 50) {
    errors.maxQuantity = 'Un entier de 1 à 50.';
  }
  if (kind === 'option' && draft.needsStaff && (!isInteger(draft.leadMinutes) || toInteger(draft.leadMinutes) > 240)) {
    errors.leadMinutes = 'Un nombre de minutes, de 0 à 240.';
  }
  if (draft.stockTracked && String(draft.stockQuantity).trim() === '') {
    errors.stockQuantity = 'Indiquez la quantité en stock.';
  } else if (draft.stockTracked && !isInteger(draft.stockQuantity) && (!saved || draft.stockQuantity !== saved.stockQuantity)) {
    errors.stockQuantity = 'Un nombre entier, 0 ou plus.';
  }
  if (String(draft.stockAlertBelow).trim() !== '' && !isInteger(draft.stockAlertBelow)) {
    errors.stockAlertBelow = 'Un nombre entier, ou vide.';
  }
  return errors;
}

/** The PUT body: only the keys that changed, typed. Retyping « En stock » is a restock (rule 37bis). */
export function patchOf(saved, draft, { kind }) {
  const patch = {};
  const changed = (key) => draft[key] !== saved[key];
  ['sold', 'mediaId', 'soldOut', 'stockTracked'].forEach((key) => { if (changed(key)) patch[key] = draft[key]; });
  ['shortDescriptionFr', 'shortDescriptionEn'].forEach((key) => { if (changed(key)) patch[key] = draft[key].trim() || null; });
  if (changed('maxQuantity')) patch.maxQuantity = toInteger(draft.maxQuantity);
  if (kind === 'option') {
    if (changed('needsStaff')) patch.needsStaff = draft.needsStaff;
    if (changed('leadMinutes')) patch.leadMinutes = toInteger(draft.leadMinutes);
  }
  if (changed('stockQuantity') && isInteger(draft.stockQuantity)) patch.stockQuantity = toInteger(draft.stockQuantity);
  if (changed('stockAlertBelow')) patch.stockAlertBelow = String(draft.stockAlertBelow).trim() === '' ? null : toInteger(draft.stockAlertBelow);
  return patch;
}

export const sameDraft = (a, b) => Object.keys(a).every((key) => a[key] === b[key]);
