/**
 * `/api/gift-vouchers/{catalogue,campaigns,offer}` — the operator's campaigns (specs/gift-voucher-campaigns.md rules 2-9, 46, 52, §4.4). Thin: the form is judged by
 * `campaignRules`, stored by `campaignsModel`, priced and described by `offerService` — the same service the site's controllers call, so the operator reads what the
 * giver will read.
 */

const campaignRules = require('../campaignRules');
const { statusOf } = require('../offerService');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function buildCampaignsController({ campaigns, catalogue, offerService }) {
  const idOf = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const notFound = (res) => res.status(404).json({ error: 'Campagne introuvable.', code: 'CAMPAIGN_NOT_FOUND' });
  const invalid = (res, errors) => res.status(422).json({ error: errors[0].message, code: 'CAMPAIGN_INVALID', errors });
  const bodyOf = (req) => (isObject(req.body) ? req.body : null);

  /** Rule 6 — the campaign as the page reads it, with whether the engine can price it now and why not. */
  const view = (campaign) => ({ ...campaign, pricing: offerService.campaignStatus(campaign) });

  const catalogueRead = (req, res) => res.json({ elements: catalogue.list() });

  const list = (req, res) => res.json({ items: campaigns.list().map(view) });

  const read = (req, res) => {
    const campaign = campaigns.find(idOf(req));
    return campaign && !campaign.oneShot ? res.json(view(campaign)) : notFound(res);
  };

  const create = (req, res) => {
    const body = bodyOf(req);
    const checked = campaignRules.validateCampaign(body, { catalogue, campaigns });
    if (!checked.ok) return invalid(res, checked.errors);
    return res.status(201).json(view(campaigns.find(campaigns.insert(checked.value))));
  };

  const update = (req, res) => {
    const existing = campaigns.find(idOf(req));
    if (!existing || existing.oneShot) return notFound(res);
    const body = bodyOf(req);
    const checked = campaignRules.validateCampaign(body ? { ...existing, ...body } : body, { catalogue, campaigns, existing });
    if (!checked.ok) return invalid(res, checked.errors);
    const updated = campaigns.update(existing.id, checked.value);
    offerService.invalidateIdeas(existing.id);
    return res.json(view(updated));
  };

  const duplicate = (req, res) => {
    const copy = campaigns.duplicate(idOf(req));
    return copy ? res.status(201).json(view(copy)) : notFound(res);
  };

  /** Rule 5 — the engine's price of a composition being edited, before it is saved: the campaign editor's preview. */
  const previewPrice = (req, res) => {
    const answered = offerService.price(bodyOf(req) || {}, { admin: true });
    return answered.ok ? res.json(answered) : res.status(statusOf(answered.code)).json({ error: answered.message, code: answered.code, ...(answered.errors ? { errors: answered.errors } : {}) });
  };

  const offer = async (req, res) => res.json(await offerService.offer({ withOmitted: true }));

  const offerPrice = (req, res) => previewPrice(req, res);

  return {
    catalogue: catalogueRead, list, read, create, update, duplicate, previewPrice, offer, offerPrice,
  };
}

module.exports = { buildCampaignsController };
