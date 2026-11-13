/**
 * The three catalogue fields of an article sold outside a stay (owner Q-C11; specs/pricing-components.md §3 rules 53, 88): « Vendable hors séjour » (`sellableExternally`), its VAT class
 * (`vatClass`: `options`, `resources`, `drinks`, `catering`; empty = the class of its kind) and the external rate of that class (`externalVatRate`, in percent, the one rate of the whole class).
 * Authoritative validation (the only one that can reject a write) and the write, shared by the option and the resource forms.
 *
 *   validate(body, { kind, stored })   → [{ field, message, code? }] — `sellableExternally` needs a family that needs no stay (`NEEDS_STAY`) and, outside the franchise, an external rate for the
 *                                        class, sent or already set (`EXTERNAL_RATE_REQUIRED`)
 *   persist(kind, id, body)            writes what the payload carries (`sellableExternally`, `vatClass`, the class's external rate); a key the save does not send keeps the stored value
 */
const articles = require('./pricing/articles');
const { ARTICLE_VAT_CLASSES } = require('./pricing/vat/settingsSchema');
const settingsProvider = require('../models/ports/settingsProvider');
const vatRegimeModel = require('../models/vatRegimeModel');
const sales = require('../models/standaloneSalesModel');

const database = () => require('../database');
const TABLE = { option: 'options', resource: 'resources' };
const COUNTER_FAMILIES = ['fixed', 'perUnit', 'hourly'];
const sent = (value) => value !== undefined && value !== null && value !== '';
const truthy = (value) => value === true || value === 1 || value === '1' || value === 'true';

const classOf = (kind, body, stored) => {
  const own = sent(body.vatClass) ? body.vatClass : (stored && stored.vatClass);
  return ARTICLE_VAT_CLASSES.includes(own) ? own : (kind === 'resource' ? 'resources' : 'options');
};

function validate(body, { kind, stored = null } = {}) {
  const payload = body || {};
  const details = [];
  if (sent(payload.sellableExternally) && ![true, false, 0, 1, '0', '1', 'true', 'false'].includes(payload.sellableExternally)) details.push({ field: 'sellableExternally', message: 'Choix invalide' });
  if (sent(payload.vatClass) && !ARTICLE_VAT_CLASSES.includes(payload.vatClass)) details.push({ field: 'vatClass', message: 'Choix invalide' });
  const rate = Number(payload.externalVatRate);
  if (sent(payload.externalVatRate) && !(Number.isFinite(rate) && rate >= 0 && rate < 100 && Math.abs(Math.round(rate * 100) - rate * 100) < 1e-6)) {
    details.push({ field: 'externalVatRate', message: 'Un taux entre 0 et 100, 2 décimales au plus' });
  }
  if (details.length) return details;
  const selling = sent(payload.sellableExternally) ? truthy(payload.sellableExternally) : Boolean(stored && Number(stored.sellableExternally) === 1);
  if (!selling) return details;
  const row = { ...(stored || {}), ...payload, id: (stored && stored.id) || 0 };
  const article = articles.makeArticle(row, { kind });
  if (!COUNTER_FAMILIES.includes(article.family)) {
    details.push({ field: 'sellableExternally', message: 'Un article lié au séjour ne se vend pas hors séjour.', code: 'NEEDS_STAY' });
    return details;
  }
  const db = database();
  const franchise = vatRegimeModel.forRow(db, null).regime === 'not_subject';
  const known = Number.isFinite(settingsProvider.create(db).for('vat', {})[`vat.rate.${classOf(kind, payload, stored)}.external`]);
  if (!franchise && !sent(payload.externalVatRate) && !known) {
    details.push({ field: 'externalVatRate', message: 'Taux du client extérieur requis pour cette classe.', code: 'EXTERNAL_RATE_REQUIRED' });
  }
  return details;
}

function persist(kind, id, body) {
  const payload = body || {};
  const table = TABLE[kind];
  if (sent(payload.sellableExternally)) database().prepare(`UPDATE ${table} SET sellableExternally = ? WHERE id = ?`).run(truthy(payload.sellableExternally) ? 1 : 0, Number(id));
  if (sent(payload.vatClass)) database().prepare(`UPDATE ${table} SET vatClass = ? WHERE id = ?`).run(payload.vatClass, Number(id));
  if (sent(payload.externalVatRate)) {
    const stored = database().prepare(`SELECT vatClass FROM ${table} WHERE id = ?`).get(Number(id));
    sales.setExternalRate(classOf(kind, payload, stored), Number(payload.externalVatRate));
  }
}

module.exports = { validate, persist };
