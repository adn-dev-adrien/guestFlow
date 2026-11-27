/**
 * `/api/gift-vouchers/{catalogue,campaigns,offer}` — the operator's campaigns (specs/gift-vouchers/gift-voucher-campaigns.md rules 2-9, 46, 52, §4.4). Thin: the form is judged by
 * `campaignRules`, stored by `campaignsModel`, priced and described by `offerService` — the same service the site's controllers call, so the operator reads what the
 * giver will read.
 */

const multer = require('multer');
const campaignRules = require('../campaignRules');
const { statusOf, durationText } = require('../offerService');
const rules = require('../voucherRules');
const { DEFAULT_LINK_BASE } = require('../settings');
const { DOCUMENT_REFUSALS } = require('../documentRefusals');

const MAX_RECIPE_BYTES = 80 * 1024 * 1024;
const uploadRecipe = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RECIPE_BYTES, files: 1, fields: 0 } });

/** Reads the recipe archive of a multipart body, one `file`. */
function receiveRecipe(req, res, next) {
  uploadRecipe.single('file')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Recette trop volumineuse (80 Mo au plus).' : 'Une seule archive à la fois.';
    return res.status(400).json({ error: message, code: 'UPLOAD_INVALID' });
  });
}

const BAND_WORDS = Object.freeze({ day: 'en journée', evening: 'en soirée' });
const countOf = (qty, label) => (qty > 1 ? `${qty} × ${label}` : label);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function buildCampaignsController({
  campaigns, catalogue, offerService, visuals, documents, recipe, linkBase = () => DEFAULT_LINK_BASE, paymentMethods = () => [],
}) {
  const idOf = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const notFound = (res) => res.status(404).json({ error: 'Campagne introuvable.', code: 'CAMPAIGN_NOT_FOUND' });
  const invalid = (res, errors) => res.status(422).json({ error: errors[0].message, code: 'CAMPAIGN_INVALID', errors });
  const bodyOf = (req) => (isObject(req.body) ? req.body : null);

  /** Rule 6 — the campaign as the page reads it, with whether the engine can price it now and why not. */
  const view = (campaign) => ({
    ...campaign, pricing: offerService.campaignStatus(campaign), summary: summaryOf(campaign), links: linksOf(campaign), withdrawn: withdrawnOf(campaign),
  });

  /** Rule 65 — the options of the campaign (add-ons, then composition) that the catalogue no longer sells, reported and never removed: `[{ articleRef, label, reason }]`. */
  function withdrawnOf(campaign) {
    const refs = [...(campaign.addOns || []), ...((campaign.composition && campaign.composition.options) || []).map((o) => o.articleRef)];
    return refs.map((articleRef) => catalogue.element(articleRef)).filter((element) => element && !element.sellable)
      .map(({ articleRef, label, reason }) => ({ articleRef, label, reason }));
  }

  /** The contents of a campaign in one line, for the list: what the giver buys, read from the catalogue's current names. */
  function summaryOf(campaign) {
    if (campaign.kind === 'lodging') return `Montant libre de ${rules.formatEuros(campaign.minAmountCents)} à ${rules.formatEuros(campaign.maxAmountCents)}`;
    const comp = campaign.composition;
    if (!comp) return '';
    const resource = catalogue.element(`resource:${comp.resourceId}`);
    const options = comp.options.map((o) => countOf(o.qty, (catalogue.element(o.articleRef) || {}).label || o.articleRef));
    return [`${resource ? resource.label : 'Ressource'} : ${durationText(comp.minutes)} ${BAND_WORDS[comp.band] || ''}`.trim(), ...options].join(' · ');
  }

  /** Rule 9 — the two permanent paths of a campaign (the offer's only once it has a slug). */
  const linksOf = (campaign) => ({ offer: campaign.slug ? `/${linkBase()}/offrir/${campaign.slug}` : null, use: `/${linkBase()}/utiliser` });

  const catalogueRead = (req, res) => res.json({ elements: catalogue.list() });

  const list = (req, res) => res.json({ items: campaigns.list().map(view) });

  const read = (req, res) => {
    const campaign = campaigns.find(idOf(req));
    return campaign && !campaign.oneShot ? res.json(view(campaign)) : notFound(res);
  };

  const create = (req, res) => {
    const body = bodyOf(req);
    const checked = campaignRules.validateCampaign(body, { catalogue, campaigns, visuals });
    if (!checked.ok) return invalid(res, checked.errors);
    return res.status(201).json(view(campaigns.find(campaigns.insert(checked.value))));
  };

  const update = (req, res) => {
    const existing = campaigns.find(idOf(req));
    if (!existing || existing.oneShot) return notFound(res);
    const body = bodyOf(req);
    const checked = campaignRules.validateCampaign(body ? { ...existing, ...body } : body, { catalogue, campaigns, visuals, existing });
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

  /** Rule 21 of the week-weekend spec — the lowest price the campaign offers today, the one printed on the card's front; none for a campaign the engine cannot price (a lodging one has no price of its own). */
  const fromCentsOf = (campaign) => {
    const status = offerService.campaignStatus(campaign);
    return status.priceable && status.totalCents ? status.totalCents : null;
  };

  const printOptionsOf = (req) => ({
    mode: req.query.mode, perSheet: req.query.perSheet, count: req.query.count, flip: req.query.flip,
  });
  const printRefusal = (res, error) => {
    if (error && error.code === 'PRINT_INVALID') return res.status(400).json({ error: error.message, code: error.code, field: error.field });
    const refusal = DOCUMENT_REFUSALS[error && error.code];
    if (!refusal) throw error;
    return res.status(refusal[0]).json({ error: refusal[1], code: error.code });
  };

  /** Rule 27 — the layout of the print sheets, the preview of the dialog: the very layout the PDF is drawn from. */
  const printLayout = (req, res) => {
    const campaign = campaigns.find(idOf(req));
    if (!campaign || campaign.oneShot) return notFound(res);
    try {
      return res.json(documents.layoutOf(printOptionsOf(req)));
    } catch (error) {
      return printRefusal(res, error);
    }
  };

  /** Rules 22-27 — merchant cards on A4 sheets. Printing them prints the link: the slug is locked from then on, as for the merchant card. */
  const printPdf = async (req, res) => {
    const campaign = campaigns.find(idOf(req));
    if (!campaign || campaign.oneShot) return notFound(res);
    try {
      const buffer = await documents.merchantPrintPdf(campaign, printOptionsOf(req), { fromCents: fromCentsOf(campaign) });
      campaigns.lockSlug(campaign.id);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="cartes-commercant-${campaign.slug}.pdf"`, 'Cache-Control': 'no-store' });
      return res.send(buffer);
    } catch (error) {
      return printRefusal(res, error);
    }
  };

  /** Rules 33, 49 — the merchant card for the printer. Serving it prints the link: the slug is locked from then on, and only once the PDF exists. */
  const merchantCard = async (req, res) => {
    const campaign = campaigns.find(idOf(req));
    if (!campaign || campaign.oneShot) return notFound(res);
    try {
      const buffer = await documents.merchantCardPdf(campaign, { fromCents: fromCentsOf(campaign) });
      campaigns.lockSlug(campaign.id);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="carte-commercant-${campaign.slug}.pdf"`, 'Cache-Control': 'no-store' });
      return res.send(buffer);
    } catch (error) {
      const refusal = DOCUMENT_REFUSALS[error && error.code];
      if (!refusal) throw error;
      return res.status(refusal[0]).json({ error: refusal[1], code: error.code });
    }
  };

  /** Rule 10 — the campaign as a `.zip` recipe. */
  const exportRecipe = (req, res) => {
    const campaign = campaigns.find(idOf(req));
    if (!campaign || campaign.oneShot) return notFound(res);
    const exported = recipe.exportCampaign(campaign);
    if (!exported.ok) return res.status(409).json({ error: exported.message, code: exported.code });
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${exported.filename}"`, 'Cache-Control': 'no-store' });
    return res.send(exported.buffer);
  };

  /** Rule 10 — a recipe imported as a draft campaign, or refused whole with the field of each problem. */
  const importRecipe = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Une archive .zip est attendue.', code: 'UPLOAD_INVALID' });
    const imported = await recipe.importArchive(req.file.buffer);
    return imported.ok ? res.status(201).json(view(imported.campaign)) : invalid(res, imported.errors);
  };

  const offer = async (req, res) => res.json({ ...(await offerService.offer({ withOmitted: true })), paymentMethods: paymentMethods() });

  const offerPrice = (req, res) => previewPrice(req, res);

  return {
    catalogue: catalogueRead, list, read, create, update, duplicate, previewPrice, offer, offerPrice, merchantCard, printLayout, printPdf, exportRecipe, importRecipe,
  };
}

module.exports = { buildCampaignsController, receiveRecipe };
