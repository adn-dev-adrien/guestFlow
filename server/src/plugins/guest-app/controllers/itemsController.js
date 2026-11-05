/**
 * `GET /api/guest-app/items`, `GET/PUT /api/guest-app/items/:kind/:id` — the sell switch and its fields,
 * as the option and resource editors and the studio show them (specs/guest-app.md rules 22, 23, 39).
 * Admin only: the guard refuses every role but admin on a path no role has listed. The boundary validates
 * everything; French messages reach the operator as they are.
 */

const { sellabilityOf } = require('../sellable');

const KINDS = Object.freeze(['option', 'resource']);
const FIELDS = Object.freeze(['sold', 'mediaId', 'shortDescriptionFr', 'shortDescriptionEn', 'maxQuantity', 'needsStaff', 'leadMinutes']);
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
  return patch;
}

const toView = ({ kind, core, item }) => ({
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
});

function buildItemsController({ items }) {
  /** → `{ kind, id }`, or the 400 to answer. */
  function target(req) {
    const { kind } = req.params;
    const id = Number(req.params.id);
    if (!KINDS.includes(kind)) return { error: 'Type d’article inconnu.' };
    if (!Number.isInteger(id) || id <= 0) return { error: 'Identifiant invalide' };
    return { kind, id };
  }

  function list(req, res) {
    return res.json(items().listAll().map(toView));
  }

  function read(req, res) {
    const at = target(req);
    if (at.error) return res.status(400).json({ error: at.error });
    const found = items().get(at.kind, at.id);
    if (!found) return res.status(404).json({ error: 'Article introuvable' });
    return res.json(toView(found));
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
    return res.json(toView(items().save(at.kind, at.id, toPatch(at.kind, req.body))));
  }

  return { list, read, write };
}

module.exports = { buildItemsController, itemInputError };
