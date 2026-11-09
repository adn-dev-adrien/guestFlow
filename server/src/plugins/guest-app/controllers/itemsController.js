/**
 * `GET /api/guest-app/items`, `GET/PUT /api/guest-app/items/:kind/:id` — the sell switch and its fields,
 * as the option and resource editors and the studio show them (specs/guest-app.md rules 22, 23, 39), and the
 * stock of the article (rules 37bis-37quater), edited in GuestFlow's editors only.
 * `GET /api/guest-app/stock` — every tracked article's stock, for the reservation editor's warning (rule 37quater).
 * Admin only: the guard refuses every role but admin on a path no role has listed. The boundary validates
 * everything; French messages reach the operator as they are.
 */

const { sellabilityOf } = require('../sellable');
const { parisDate } = require('../currentStay');
const { adminStockView, editorLabel } = require('../stock');

const KINDS = Object.freeze(['option', 'resource']);
const FIELDS = Object.freeze([
  'sold', 'mediaId', 'shortDescriptionFr', 'shortDescriptionEn', 'maxQuantity', 'needsStaff', 'leadMinutes',
  'stockTracked', 'stockQuantity', 'stockAlertBelow', 'soldOut',
]);
const STOCK_FIELDS = Object.freeze(['stockTracked', 'stockQuantity', 'stockAlertBelow', 'soldOut']);
const STOCK = Object.freeze({ min: 0, max: 100000 });
const MAX_SHORT_DESCRIPTION = 140;
const QUANTITY = Object.freeze({ min: 1, max: 50 });
const LEAD_MINUTES = Object.freeze({ min: 0, max: 240 });

const isIntegerIn = (value, { min, max }) => Number.isInteger(value) && value >= min && value <= max;
const isShortText = (value) => value === null || (typeof value === 'string' && value.length <= MAX_SHORT_DESCRIPTION);

/** → an error message or null. Only the keys present are judged: each editor saves its own. */
function itemInputError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Requête invalide.';
  if (Object.keys(body).some((key) => !FIELDS.includes(key))) return 'Champ inconnu.';
  if (body.sold !== undefined && typeof body.sold !== 'boolean') return 'Indiquez si l’article est vendu dans l’application.';
  if (body.mediaId !== undefined && body.mediaId !== null && !(Number.isInteger(body.mediaId) && body.mediaId > 0)) return 'La photo est invalide.';
  if (body.shortDescriptionFr !== undefined && !isShortText(body.shortDescriptionFr)) return `La description courte fait au plus ${MAX_SHORT_DESCRIPTION} caractères.`;
  if (body.shortDescriptionEn !== undefined && !isShortText(body.shortDescriptionEn)) return `La description courte anglaise fait au plus ${MAX_SHORT_DESCRIPTION} caractères.`;
  if (body.maxQuantity !== undefined && !isIntegerIn(body.maxQuantity, QUANTITY)) return `La quantité maximale est un entier de ${QUANTITY.min} à ${QUANTITY.max}.`;
  if (body.needsStaff !== undefined && typeof body.needsStaff !== 'boolean') return 'Indiquez si l’article est préparé par l’équipe.';
  if (body.leadMinutes !== undefined && !isIntegerIn(body.leadMinutes, LEAD_MINUTES)) return `Le délai de préparation est un nombre entier de minutes, de ${LEAD_MINUTES.min} à ${LEAD_MINUTES.max}.`;
  if (body.stockTracked !== undefined && typeof body.stockTracked !== 'boolean') return 'Indiquez si le stock est suivi.';
  if (body.stockQuantity !== undefined && !isIntegerIn(body.stockQuantity, STOCK)) return `La quantité en stock est un entier de ${STOCK.min} à ${STOCK.max}.`;
  if (body.stockAlertBelow !== undefined && body.stockAlertBelow !== null && !isIntegerIn(body.stockAlertBelow, STOCK)) return 'Le seuil d’alerte est un entier positif.';
  if (body.soldOut !== undefined && typeof body.soldOut !== 'boolean') return 'Indiquez si l’article est en rupture.';
  return null;
}

// Rules 27bis, 28, 37bis — the breakfast is sold by the morning and the bath follows the resource planning: no stock.
function stockRefusal(kind, core) {
  if (kind === 'resource' && core.priceType === 'per_hour') return 'Une ressource à l’heure suit son planning, pas un stock.';
  if (kind === 'option' && core.autoOptionType === 'breakfast') return 'Le petit-déjeuner se commande par matin, sans stock.';
  return null;
}

const blankToNull = (text) => (typeof text === 'string' && text.trim() === '' ? null : text);

/** The stored shape of a validated body. A resource is never « préparé par l'équipe »: rule 31 governs it. */
function toPatch(kind, body) {
  const patch = {};
  if (body.sold !== undefined) patch.sold = body.sold ? 1 : 0;
  if (body.mediaId !== undefined) patch.mediaId = body.mediaId;
  if (body.shortDescriptionFr !== undefined) patch.shortDescriptionFr = blankToNull(body.shortDescriptionFr);
  if (body.shortDescriptionEn !== undefined) patch.shortDescriptionEn = blankToNull(body.shortDescriptionEn);
  if (body.maxQuantity !== undefined) patch.maxQuantity = body.maxQuantity;
  if (body.needsStaff !== undefined) patch.needsStaff = kind === 'option' && body.needsStaff ? 1 : 0;
  if (body.leadMinutes !== undefined) patch.leadMinutes = body.leadMinutes;
  if (body.stockTracked !== undefined) patch.stockTracked = body.stockTracked ? 1 : 0;
  if (body.stockAlertBelow !== undefined) patch.stockAlertBelow = body.stockAlertBelow;
  if (body.soldOut !== undefined) patch.soldOut = body.soldOut ? 1 : 0;
  return patch;
}

const toView = ({ kind, core, item }, stockState = null) => ({
  kind,
  id: Number(core.id),
  title: core.title,
  priceType: core.priceType,
  ...(kind === 'option' ? { category: String(core.category || '').trim(), archived: Boolean(core.archivedAt) } : {}),
  sellable: sellabilityOf(kind, core),
  sold: Number(item.sold) === 1,
  mediaId: item.mediaId,
  shortDescriptionFr: item.shortDescriptionFr,
  shortDescriptionEn: item.shortDescriptionEn,
  maxQuantity: Number(item.maxQuantity),
  needsStaff: kind === 'option' && Number(item.needsStaff) === 1,
  leadMinutes: Number(item.leadMinutes),
  stockable: !stockRefusal(kind, core),
  stock: adminStockView(item, stockState),
});

/** The operator who restocks, as the history line names them. */
const operatorName = (req) => {
  const user = req.user || {};
  return String(user.displayName || user.firstName || user.username || user.email || '').trim() || null;
};

function buildItemsController({
  items, stock, alertStock = () => {}, now = () => new Date(),
}) {
  const stateOf = (kind, id) => stock().state(kind, id, now());
  const viewOf = (found) => toView(found, stateOf(found.kind, found.core.id));

  /** → `{ kind, id }`, or the 400 to answer. */
  function target(req) {
    const { kind } = req.params;
    const id = Number(req.params.id);
    if (!KINDS.includes(kind)) return { error: 'Type d’article inconnu.' };
    if (!Number.isInteger(id) || id <= 0) return { error: 'Identifiant invalide' };
    return { kind, id };
  }

  function list(req, res) {
    return res.json(items().listAll().map(viewOf));
  }

  function read(req, res) {
    const at = target(req);
    if (at.error) return res.status(400).json({ error: at.error });
    const found = items().get(at.kind, at.id);
    if (!found) return res.status(404).json({ error: 'Article introuvable' });
    return res.json(viewOf(found));
  }

  function write(req, res) {
    const at = target(req);
    if (at.error) return res.status(400).json({ error: at.error });
    const error = itemInputError(req.body);
    if (error) return res.status(400).json({ error });
    const found = items().get(at.kind, at.id);
    if (!found) return res.status(404).json({ error: 'Article introuvable' });
    // Rule 23 — the switch cannot go on for a price the app cannot sell; turning it off is always allowed.
    const sellable = sellabilityOf(at.kind, found.core);
    if (req.body.sold === true && !sellable.ok) return res.status(400).json({ error: sellable.reason, code: 'NOT_SELLABLE' });
    if (req.body.mediaId && !items().mediaExists(req.body.mediaId)) return res.status(400).json({ error: 'La photo est introuvable.' });
    const touchesStock = STOCK_FIELDS.some((key) => req.body[key] !== undefined);
    const refusal = touchesStock && stockRefusal(at.kind, found.core);
    if (refusal && (req.body.stockTracked === true || req.body.stockQuantity !== undefined || req.body.soldOut === true)) {
      return res.status(400).json({ error: refusal, code: 'NO_STOCK' });
    }
    // Rule 37bis — following a stock starts from a count: « En stock » is typed at the first switch-on.
    const tracksAfter = req.body.stockTracked !== undefined ? req.body.stockTracked : Number(found.item.stockTracked) === 1;
    if (tracksAfter && req.body.stockQuantity === undefined && (found.item.stockQuantity === null || found.item.stockQuantity === undefined)) {
      return res.status(400).json({ error: 'Indiquez la quantité en stock.' });
    }
    items().save(at.kind, at.id, toPatch(at.kind, req.body));
    if (tracksAfter && req.body.stockQuantity !== undefined) {
      const restockedAt = now();
      stock().restock(at.kind, at.id, {
        quantity: req.body.stockQuantity, by: operatorName(req), at: restockedAt, today: parisDate(restockedAt),
      });
    }
    if (tracksAfter) alertStock([`${at.kind}:${at.id}`]);
    return res.json(viewOf(items().get(at.kind, at.id)));
  }

  /** `GET /stock` — rule 37quater: the tracked articles, the reservation editor warns « Stock : épuisé », never blocks. */
  function stockList(req, res) {
    const titles = new Map(items().listAll().map((found) => [`${found.kind}:${Number(found.core.id)}`, found.core.title]));
    const rows = [...stock().states(now()).values()].map((state) => ({
      kind: state.kind,
      id: state.id,
      title: titles.get(`${state.kind}:${state.id}`) || null,
      quantity: state.quantity,
      held: state.held,
      left: state.left,
      soldOut: state.soldOut,
      out: state.out,
      label: editorLabel(state),
    }));
    return res.json({ items: rows });
  }

  return {
    list, read, write, stockList,
  };
}

module.exports = { buildItemsController, itemInputError };
