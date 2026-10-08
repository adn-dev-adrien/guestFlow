/**
 * Email mentions controller — « Options citées » of « Textes des mails »
 * (specs/plugins-phase-p-productisation.md §3.B rules 7–9, §4.3).
 *
 *   GET    /api/email-mentions                     { mentions, confirmationOrder }
 *   POST   /api/email-mentions                     create → 201 | 400 | 422 { field, message }
 *   PUT    /api/email-mentions/order               { ids } — the proposal order
 *   PUT    /api/email-mentions/confirmation-order  { items } — `mention:<id>`, `babyBed`, `towels`
 *   PUT    /api/email-mentions/:id                 update
 *   DELETE /api/email-mentions/:id
 *   POST   /api/email-mentions/preview             { propertyId, children, startDate } → { fr, en }
 *
 * The preview is rendered by the server, through the same stay content as the emails: the J-7 offers
 * as proposed to a stay with nothing booked, and the J-2 confirmations as if every mention were booked.
 */

const emailMentionsModel = require('../models/emailMentionsModel');
const { loadStayFacts } = require('../models/stayFactsModel');
const { buildStayContent } = require('../utils/stayContentContext');
const { MENTION_OFFER, MENTION_BOOKED } = require('../utils/stayTextCatalogue');
const { tokenError } = require('./stayTextsController');

const SECTIONS = ['local', 'extras', 'kids'];
const PRICE_SOURCES = ['min', 'option'];
const TYPED_ITEMS = ['babyBed', 'towels'];

function validate(body, optionExists) {
  const m = body || {};
  if (!SECTIONS.includes(m.section)) return { status: 400, error: { field: 'section', message: 'Section inconnue' } };
  const optionIds = Array.isArray(m.optionIds) ? [...new Set(m.optionIds.map(Number))] : [];
  if (!optionIds.length) return { status: 400, error: { field: 'optionIds', message: 'Au moins une option' } };
  if (optionIds.some((id) => !optionExists(id))) return { status: 400, error: { field: 'optionIds', message: 'Option inconnue' } };
  const priceSource = m.priceSource || 'min';
  if (!PRICE_SOURCES.includes(priceSource)) return { status: 400, error: { field: 'priceSource', message: 'Prix inconnu' } };
  const priceOptionId = priceSource === 'option' ? Number(m.priceOptionId) : null;
  if (priceSource === 'option' && !optionIds.includes(priceOptionId)) {
    return { status: 400, error: { field: 'priceOptionId', message: 'Choisir une des options citées' } };
  }
  const text = (k) => (m[k] == null ? '' : String(m[k]));
  const mention = {
    section: m.section, optionIds, priceSource, priceOptionId,
    offerFr: text('offerFr'), offerEn: text('offerEn'), bookedFr: text('bookedFr'), bookedEn: text('bookedEn'),
  };
  if (!mention.offerFr.trim()) return { status: 400, error: { field: 'offerFr', message: 'Texte obligatoire' } };
  const error = tokenError('offerFr', mention.offerFr, MENTION_OFFER)
    || tokenError('offerEn', mention.offerEn, MENTION_OFFER)
    || tokenError('bookedFr', mention.bookedFr, MENTION_BOOKED)
    || tokenError('bookedEn', mention.bookedEn, MENTION_BOOKED);
  if (error) return { status: 422, error };
  return { mention };
}

function buildController({ database }) {
  const model = () => emailMentionsModel.buildModel(database);
  const optionExists = (id) => Boolean(database.prepare('SELECT 1 FROM options WHERE id = ?').get(Number(id)));

  function list(req, res) {
    const m = model();
    res.json({ mentions: m.list(), confirmationOrder: m.confirmationOrder() });
  }

  function create(req, res) {
    const result = validate(req.body, optionExists);
    if (result.error) return res.status(result.status).json(result.error);
    return res.status(201).json(model().create(result.mention));
  }

  function update(req, res) {
    const result = validate(req.body, optionExists);
    if (result.error) return res.status(result.status).json(result.error);
    const updated = model().update(req.params.id, result.mention);
    if (!updated) return res.status(404).json({ error: 'MENTION_NOT_FOUND' });
    return res.json(updated);
  }

  function remove(req, res) {
    if (!model().remove(req.params.id)) return res.status(404).json({ error: 'MENTION_NOT_FOUND' });
    return res.status(204).end();
  }

  function reorder(req, res) {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number) : null;
    const known = new Set(model().list().map((m) => m.id));
    if (!ids || ids.length !== known.size || ids.some((id) => !known.has(id))) {
      return res.status(400).json({ error: 'ORDER_MUST_LIST_EVERY_MENTION' });
    }
    model().reorder(ids);
    return res.json({ mentions: model().list() });
  }

  function setConfirmationOrder(req, res) {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items.map(String) : null;
    const known = new Set(model().list().map((m) => `mention:${m.id}`));
    if (!items || items.some((item) => !TYPED_ITEMS.includes(item) && !known.has(item)) || new Set(items).size !== items.length) {
      return res.status(400).json({ error: 'INVALID_CONFIRMATION_ORDER' });
    }
    model().setConfirmationOrder(items);
    return res.json({ confirmationOrder: model().confirmationOrder() });
  }

  function preview(req, res) {
    const body = req.body || {};
    const propertyId = Number(body.propertyId);
    const property = database.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
    if (!property) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate || '')) ? body.startDate : new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
    const reservation = { propertyId, startDate, endDate, adults: 2, children: Math.max(0, Number(body.children) || 0), babies: 1 };
    const facts = loadStayFacts(database, reservation);
    // Every mention booked through one of its available options, plus the typed ones, for the J-2.
    const availableIds = new Set((facts.available || []).map((o) => Number(o.id)));
    const bookedIds = new Set();
    for (const m of facts.mentions) {
      const first = (m.optionIds || []).find((id) => availableIds.has(Number(id)));
      if (first != null) bookedIds.add(Number(first));
    }
    for (const o of facts.available || []) {
      if (o.autoOptionType === 'baby_bed' || o.autoOptionType === 'bathroom_linen') bookedIds.add(Number(o.id));
    }
    const bookedLines = [...bookedIds].map((optionId) => ({ optionId, offered: 0 }));
    const render = (lang) => {
      const base = { reservation, property, facts, settings: {}, lang };
      const proposed = buildStayContent({ ...base, options: [] }).vars;
      const booked = buildStayContent({ ...base, options: bookedLines }).vars;
      return {
        offers: [proposed.localProductsParagraph, proposed.kidsParagraph].filter(Boolean).join('\n\n'),
        confirmations: booked.bookedOptionsParagraph,
      };
    };
    return res.json({ fr: render('fr'), en: render('en') });
  }

  return { list, create, update, remove, reorder, setConfirmationOrder, preview };
}

module.exports = { buildController };
