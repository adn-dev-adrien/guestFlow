/**
 * The words and views of the stock (specs/guest-app.md rules 37bis-37quater). Pure: a stock state from
 * `models/stockModel.js` comes in, ready-to-render fields go out.
 */

const LOCALE = 'fr-FR';

/** « −2 »: a stock below zero is shown with a true minus sign (rule 37ter: staff and site sales are never refused). */
const quantityLabel = (n) => (n < 0 ? `−${-n}` : String(n));

const historyStamp = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** « Stock réglé à 24 — Sophie, 6 nov. 14:02 » — the last restock, as the editor prints it. */
function restockLine({ quantity, setAt, setBy }) {
  if (!setAt) return null;
  const stamp = historyStamp.format(new Date(setAt)).replace(' à ', ' ').replace(',', '');
  return `Stock réglé à ${quantityLabel(quantity)}${setBy ? ` — ${setBy}` : ''}, ${stamp}`;
}

/** The editor's « Stock » group: the switch, the count, the restock line, what unpaid orders hold. */
function adminStockView(row, state) {
  const tracked = Number(row.stockTracked) === 1;
  return {
    tracked,
    quantity: tracked && row.stockQuantity !== null && row.stockQuantity !== undefined ? Number(row.stockQuantity) : null,
    quantityLabel: tracked && row.stockQuantity !== null && row.stockQuantity !== undefined ? quantityLabel(Number(row.stockQuantity)) : null,
    held: state ? state.held : 0,
    heldLabel: state && state.held > 0 ? `${state.held} réservé${state.held > 1 ? 's' : ''} par des commandes en attente de paiement` : null,
    left: state ? state.left : null,
    alertBelow: row.stockAlertBelow === null || row.stockAlertBelow === undefined ? null : Number(row.stockAlertBelow),
    soldOut: Number(row.soldOut) === 1,
    out: Boolean(state && state.out),
    restockLine: tracked ? restockLine({ quantity: Number(row.stockSetQuantity ?? row.stockQuantity ?? 0), setAt: row.stockSetAt, setBy: row.stockSetBy }) : null,
  };
}

const LEFT = Object.freeze({
  fr: (n) => `Plus que ${n}`,
  en: (n) => `Only ${n} left`,
});
const AVAILABLE = Object.freeze({
  fr: (n) => `Plus que ${n} disponible${n > 1 ? 's' : ''}`,
  en: (n) => `Only ${n} available`,
});
const SOLD_OUT = Object.freeze({ fr: 'Épuisé', en: 'Sold out' });

/**
 * Rule 37quater — what the shop shows of a tracked article: `{ soldOut, left, leftLabel }`, `leftLabel` only once
 * what is left no longer covers a full order (`maxQuantity`). An untracked article has no `stock` at all.
 */
function shopStockView(state, maxQuantity, lang = 'fr') {
  if (!state) return null;
  const left = state.out ? 0 : Math.max(0, state.left);
  return {
    soldOut: state.out,
    left,
    leftLabel: !state.out && left <= Number(maxQuantity) ? (LEFT[lang] || LEFT.fr)(left) : null,
  };
}

/** Rule 37quater — the quote line beyond the stock: `{ left, label }` (« Plus que 1 disponible », « Épuisé »). */
function outOfStockOf(state, lang = 'fr') {
  const left = state.out ? 0 : Math.max(0, state.left);
  return { left, label: left > 0 ? (AVAILABLE[lang] || AVAILABLE.fr)(left) : (SOLD_OUT[lang] || SOLD_OUT.fr) };
}

/** Rule 37quater — the reservation editor's warning, never a refusal. */
const editorLabel = (state) => (state.out ? 'Stock : épuisé' : `Stock : ${quantityLabel(state.left)}`);

/** Rule 37quater — « Stock bas : Cidre — plus que 3 », « Cidre épuisé ». */
function alertPush(alert, title) {
  if (alert.kind === 'out') return { title: 'Stock épuisé', body: `${title} épuisé` };
  return { title: 'Stock bas', body: `Stock bas : ${title} — plus que ${quantityLabel(alert.left)}` };
}

module.exports = {
  SOLD_OUT, adminStockView, alertPush, editorLabel, outOfStockOf, quantityLabel, restockLine, shopStockView,
};
