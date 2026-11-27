/**
 * The one path of the sale (specs/gift-voucher-campaigns.md rule 52): what is on offer, what it costs, the order, the payment link and the issue. The public controllers
 * (the site key, the proof of work, the per-visitor limits) and the admin controllers (the session, the « Payé » / « Offert » / « Envoyer un lien » outcomes) are thin
 * wrappers over it; neither re-implements a rule, so a voucher composed at the counter and one bought on the site are the same thing.
 *
 *   offer({ withOmitted })              → { campaigns, … } the campaigns on sale, each with its contents, add-ons and extra time (a campaign the engine cannot price is left
 *                                         out, rule 6; `omitted` lists them with their reason for the operator). The lodging campaign's bounds and ideas also sit at the top
 *                                         level, where the site's block has always read them. Each add-on carries `unitLabel`, `linear` and `prices: [{ qty, cents }]`, the extra time
 *                                         `prices: [{ minutes, cents }]`, each priced by the engine like the price request would (rule 64); `extrasCents` of a price is the extra-time and add-on lines' sum.
 *   price(request)                      → { ok: true, kind, title, contents, lines, totalCents, extrasCents, vat } | { ok: false, code, message }
 *   createOrder({ request, parties, … }) → { ok: true, order: { id, token }, price } | refusal — priced by the engine now, contents frozen on the order
 *   startPayment(orderId, { returnUrl }) → { ok: true, url, totalCents, label } | refusal — the order priced again, then its one-hour payment link (rule 19)
 *   issueDirect({ request, parties, … }) → { ok: true, voucherId } | refusal — « Payé » and « Offert » of the back-office: issued at once
 *
 * A request is `{ slug } | { composition, … }` (a one-shot, rule 46) plus `extraMinutes`, `addOns: [{ articleRef, qty }]` and, for a lodging campaign, `amountCents`.
 * Prices are never read from a campaign: the engine (`standaloneSale.quote`) is asked, for the outside customer, each time. Nothing exists before the bank confirms a
 * payment but the order (rule 19).
 */

const rules = require('./voucherRules');
const campaignRules = require('./campaignRules');
const { createIdeas } = require('./ideas');
const { createExtrasPricing } = require('./extrasPricing');
const { OFFERED_NOTE } = require('./issuance');

const MAX_NAME = 40;
const MAX_MESSAGE = 200;
const MAX_EMAIL = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK_MINUTES = 60;
const BAND_WORDS = Object.freeze({ day: 'journée', evening: 'soirée' });
// The HTTP status a refusal of this service is answered with; any other code is a 400.
const REFUSAL_STATUS = Object.freeze({
  CAMPAIGN_UNKNOWN: 404, CAMPAIGN_CLOSED: 409, ONLINE_SALE_UNAVAILABLE: 409, PAYMENT_PENDING: 409, PAYMENT_PROVIDER_ERROR: 502,
});
const statusOf = (code) => REFUSAL_STATUS[code] || 400;

const refuse = (code, message, extra = {}) => ({
  ok: false, code, message, ...extra,
});

const RESOURCE_ACTIVITY = 'resource';
const LODGING_ACTIVITY = 'lodging';
const activityOfCampaign = (campaign) => (campaign.kind === 'resource' ? RESOURCE_ACTIVITY : LODGING_ACTIVITY);

const asInt = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);

/** « 2 h », « 1 h 30 », « 45 min » — a duration the way the shop says it. */
function durationText(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${String(rest).padStart(2, '0')}`;
}

function createOfferService({
  campaigns, orders, issuance, catalogue, engine, quoteStay, payments, transaction, visuals = null, now = () => new Date(),
}) {
  const ideasByCampaign = new Map();
  const extrasPricing = createExtrasPricing({ engine, catalogue });

  function ideasFor(campaign) {
    if (!ideasByCampaign.has(campaign.id)) {
      ideasByCampaign.set(campaign.id, createIdeas({
        ideas: () => campaignRules.ideasOf((campaigns.find(campaign.id) || campaign).ideas),
        bounds: () => {
          const current = campaigns.find(campaign.id) || campaign;
          return { minAmountCents: current.minAmountCents, maxAmountCents: current.maxAmountCents };
        },
        quote: quoteStay,
        now,
        todayOf: rules.parisDate,
      }));
    }
    return ideasByCampaign.get(campaign.id);
  }

  /** The lodging ideas are priced by the stay engine: they are read again after a tariff change, or when the campaign's ideas or bounds change. */
  const invalidateIdeas = (campaignId) => {
    if (campaignId === undefined) ideasByCampaign.forEach((ideas) => ideas.invalidate());
    else if (ideasByCampaign.has(campaignId)) ideasByCampaign.get(campaignId).invalidate();
  };

  // ── pricing ───────────────────────────────────────────────────────────────────────────────────────────────────────

  const vatLinesOf = (lines, vatByRate) => {
    const grossByRate = new Map();
    lines.forEach((line) => grossByRate.set(line.vatRate, (grossByRate.get(line.vatRate) || 0) + line.totalCents));
    return vatByRate.filter((row) => grossByRate.has(row.rate)).map((row) => ({
      ratePercent: row.rate, htCents: grossByRate.get(row.rate) - row.vatCents, vatCents: row.vatCents,
    }));
  };

  /** What a composed voucher holds, as the pricing engine is asked for it: the included session, the extra time after it (its ranks continue), the options and the add-ons. */
  function engineRequestOf(contents) {
    const { resource } = contents;
    const period = resource.period || 'week';
    const lines = [{ articleRef: `resource:${resource.id}`, session: { band: resource.band, minutes: resource.includedMinutes, period } }];
    const descriptors = [{ kind: 'session', label: null }];
    if (resource.extraMinutes > 0) {
      lines.push({
        articleRef: `resource:${resource.id}`, session: {
          band: resource.band, minutes: resource.extraMinutes, rankOffsetMinutes: resource.includedMinutes, period,
        },
      });
      descriptors.push({ kind: 'extra', label: `Temps supplémentaire · ${durationText(resource.extraMinutes)}` });
    }
    contents.options.forEach((o) => { lines.push({ articleRef: o.articleRef, quantity: o.qty }); descriptors.push({ kind: 'option' }); });
    contents.addOns.forEach((o) => { lines.push({ articleRef: o.articleRef, quantity: o.qty }); descriptors.push({ kind: 'addOn' }); });
    return { lines, descriptors };
  }

  /** The priced lines a voucher keeps with its contents: the invoice-style recap of its mail reads them, never the engine (specs/gift-voucher-campaigns.md rule 20). */
  const frozenLines = (lines) => lines.map(({
    label, qty, unitCents, totalCents, vatRate,
  }) => ({
    label, qty, unitCents, totalCents, vatRate,
  }));

  /** Rules 5, 17 — the engine's price of frozen contents, for the outside customer. */
  function priceContents(contents) {
    const { lines, descriptors } = engineRequestOf(contents);
    const answer = engine.quote({ lines });
    if (answer.status !== 200) return refuse('PRICE_UNAVAILABLE', answer.body && answer.body.error ? answer.body.error : 'Prix indisponible.');
    if (answer.refusals.length) return refuse('PRICE_UNAVAILABLE', answer.refusals[0].message, { refusals: answer.refusals });
    const { document } = answer;
    if (document.lines.length !== descriptors.length) return refuse('PRICE_UNAVAILABLE', 'Prix indisponible.');
    const priced = document.lines.map((line, index) => ({
      kind: descriptors[index].kind,
      label: descriptors[index].label || (descriptors[index].kind === 'session' ? `${line.label} · ${BAND_WORDS[contents.resource.band]}` : line.label),
      detail: line.detail,
      qty: line.quantity,
      unitCents: line.unitCents,
      totalCents: line.totalCents,
      vatRate: line.vatRate,
    }));
    return {
      ok: true,
      lines: priced,
      totalCents: document.totals.totalCents,
      extrasCents: priced.filter((line) => line.kind === 'extra' || line.kind === 'addOn').reduce((sum, line) => sum + line.totalCents, 0),
      vat: document.vatByRate.map((row) => ({ rate: row.rate, cents: row.vatCents })),
      vatLines: vatLinesOf(priced, document.vatByRate),
    };
  }

  /** Rule 3 — a lodging voucher is a free amount inside the campaign's bounds, at the campaign's VAT rate. */
  function priceLodging(campaign, amountCents) {
    const amount = rules.checkAmountCents(amountCents, campaign);
    if (!amount.ok) return refuse(amount.code, amount.code === 'AMOUNT_INVALID' ? 'Montant invalide.' : 'Montant hors des bornes.');
    const split = rules.vatSplit(amount.cents, campaign.vatRatePercent);
    return {
      ok: true,
      lines: [{
        kind: 'amount', label: campaign.title, detail: null, qty: 1, unitCents: amount.cents, totalCents: amount.cents, vatRate: split.ratePercent,
      }],
      totalCents: amount.cents,
      extrasCents: 0,
      vat: [{ rate: split.ratePercent, cents: split.vatCents }],
      vatLines: null,
    };
  }

  // ── contents ──────────────────────────────────────────────────────────────────────────────────────────────────────

  const labelOf = (articleRef) => {
    const element = catalogue.element(articleRef);
    return element ? element.label : articleRef;
  };

  function addOnsProblem(campaign, asked) {
    if (asked === undefined || asked === null) return { value: [] };
    if (!Array.isArray(asked)) return { problem: refuse('ADDONS_INVALID', 'Options choisies : une liste est attendue.') };
    const value = [];
    for (const entry of asked) {
      const articleRef = entry && entry.articleRef;
      const qty = Number(asInt(entry && entry.qty === undefined ? 1 : entry && entry.qty));
      if (!campaign.addOns.includes(articleRef)) return { problem: refuse('ADDON_NOT_OFFERED', `Option choisie : « ${labelOf(articleRef)} » n’est pas proposée avec ce bon.`) };
      if (!Number.isInteger(qty) || qty < 1 || qty > campaignRules.MAX_QTY) return { problem: refuse('ADDON_QTY_INVALID', `Option choisie : la quantité de « ${labelOf(articleRef)} » va de 1 à ${campaignRules.MAX_QTY}.`) };
      if (value.some((v) => v.articleRef === articleRef)) return { problem: refuse('ADDON_DUPLICATE', `Option choisie : « ${labelOf(articleRef)} » figure deux fois.`) };
      value.push({ articleRef, label: labelOf(articleRef), qty });
    }
    return { value };
  }

  /** Rules 10-12 — the period asked: the one a campaign offers alone, the one chosen among two (required then), never one it does not offer. */
  function periodOf(campaign, asked, { cheapestWhenMissing = false } = {}) {
    const offered = campaign.periods && campaign.periods.length ? campaign.periods : ['week'];
    if (asked === undefined || asked === null || asked === '') {
      if (offered.length === 1) return { value: offered[0] };
      // The public routes stay backward compatible (K1): a caller that predates the period gets the cheapest one, what an older connector shows as « à partir de ».
      if (cheapestWhenMissing) {
        const priced = periodPrices(campaign);
        if (!priced.ok) return { problem: priced };
        return { value: priced.prices.reduce((best, p) => (p.priceCents < best.priceCents ? p : best), priced.prices[0]).period };
      }
      return { problem: refuse('PERIOD_REQUIRED', 'Période : semaine ou week-end est à choisir.') };
    }
    if (!rules.PERIODS.includes(asked) || !offered.includes(asked)) return { problem: refuse('PERIOD_NOT_OFFERED', 'Période : ce bon ne se vend pas pour cette période.') };
    return { value: asked };
  }

  /** The frozen contents a campaign sells for a request: the composition, the extra time asked (within what is offered) and the add-ons chosen. */
  function contentsFor(campaign, request, { cheapestWhenMissing = false } = {}) {
    if (campaign.kind === 'lodging') return { ok: true, contents: { kind: 'lodging' } };
    const comp = campaign.composition;
    const extra = request.extraMinutes === undefined || request.extraMinutes === null ? 0 : asInt(request.extraMinutes);
    if (!Number.isInteger(extra) || extra < 0) return refuse('EXTRA_TIME_INVALID', 'Temps supplémentaire : un nombre entier de minutes est attendu.');
    if (extra > campaign.extraTimeMaxMinutes) {
      return refuse('EXTRA_TIME_NOT_OFFERED', campaign.extraTimeMaxMinutes === 0
        ? 'Temps supplémentaire : non proposé avec ce bon.'
        : `Temps supplémentaire : ${durationText(campaign.extraTimeMaxMinutes)} au plus.`);
    }
    const addOns = addOnsProblem(campaign, request.addOns);
    if (addOns.problem) return addOns.problem;
    const period = periodOf(campaign, request.period, { cheapestWhenMissing, campaign });
    if (period.problem) return period.problem;
    return {
      ok: true,
      contents: {
        kind: 'resource',
        title: `${campaign.title} · ${rules.PERIOD_LABELS[period.value]}`,
        resource: {
          period: period.value,
          id: comp.resourceId,
          name: labelOf(`resource:${comp.resourceId}`),
          band: comp.band,
          minutes: comp.minutes + extra,
          includedMinutes: comp.minutes,
          extraMinutes: extra,
        },
        options: comp.options.map((o) => ({ articleRef: o.articleRef, label: labelOf(o.articleRef), qty: o.qty })),
        addOns: addOns.value,
      },
    };
  }

  /** Rules 17, 46 — the campaign a request names, or the one-shot it composes. `admin` may also use the lodging campaign by default, whatever its state. */
  function campaignOf(request, { admin }) {
    if (request.composition !== undefined && request.composition !== null) {
      if (!admin) return refuse('CAMPAIGN_UNKNOWN', 'Offre inconnue.');
      const composition = campaignRules.validateComposition(request.composition, { catalogue, periods: rules.PERIODS.includes(request.period) ? [request.period] : ['week'] });
      if (!composition.ok) return refuse('COMPOSITION_INVALID', composition.errors[0].message, { errors: composition.errors });
      // What the operator picks for one voucher is offered with it: the add-ons bought and the extra time asked are inside what the one-shot offers.
      const askedAddOns = (Array.isArray(request.addOns) ? request.addOns : []).map((entry) => entry && entry.articleRef).filter(Boolean);
      const candidate = {
        name: 'Bon sur mesure',
        title: typeof request.title === 'string' && request.title.trim() ? request.title.trim().slice(0, 80) : 'Bon sur mesure',
        kind: 'resource',
        state: 'closed',
        oneShot: true,
        slug: null,
        validityMonths: request.validityMonths === undefined ? rules.DEFAULT_VALIDITY_MONTHS : asInt(request.validityMonths),
        periods: rules.PERIODS.includes(request.period) ? [request.period] : ['week'],
        composition: composition.value,
        addOns: [...new Set([...(Array.isArray(request.offeredAddOns) ? request.offeredAddOns : []), ...askedAddOns])],
        extraTimeMaxMinutes: Math.max(Number(asInt(request.extraTimeMaxMinutes)) || 0, Number(asInt(request.extraMinutes)) || 0),
        ideas: [],
        minAmountCents: null,
        maxAmountCents: null,
        vatRatePercent: null,
        voucherVisualId: request.voucherVisualId,
      };
      const checked = campaignRules.validateCampaign(candidate, {
        catalogue, campaigns, visuals, oneShot: true,
      });
      if (!checked.ok) return refuse('COMPOSITION_INVALID', checked.errors[0].message, { errors: checked.errors });
      return { ok: true, campaign: checked.value };
    }
    if (request.slug === undefined || request.slug === null || request.slug === '') {
      const lodging = admin ? campaigns.firstLodging() : campaigns.onSale().find((c) => c.kind === 'lodging');
      return lodging ? withValidity(lodging, request, { admin }) : refuse('CAMPAIGN_UNKNOWN', 'Offre inconnue.');
    }
    const campaign = campaigns.findBySlug(request.slug);
    if (!campaign || campaign.oneShot) return refuse('CAMPAIGN_UNKNOWN', 'Offre inconnue.');
    if (campaign.state !== 'on_sale') return refuse('CAMPAIGN_CLOSED', 'Cette offre n’est plus en vente.');
    return withValidity(campaign, request, { admin });
  }

  /** Rule 13 — « Nouveau bon » prefills the campaign's validity and may change it, from the short list; the site's giver never chooses. */
  function withValidity(campaign, request, { admin }) {
    if (!admin || request.validityMonths === undefined || request.validityMonths === null || request.validityMonths === '') return { ok: true, campaign };
    const months = asInt(request.validityMonths);
    if (!rules.VALIDITY_CHOICES.includes(months)) return refuse('VALIDITY_INVALID', rules.VALIDITY_REFUSAL);
    return { ok: true, campaign: { ...campaign, validityMonths: months, validityAsked: true } };
  }

  // The validity an operator picked for this voucher is frozen with its contents; otherwise the voucher follows its campaign's.
  const validityOf = (campaign) => (campaign.validityAsked ? { validityMonths: campaign.validityMonths } : {});

  function priceRequest(campaign, request, { admin = false } = {}) {
    if (campaign.kind === 'lodging') {
      const priced = priceLodging(campaign, request.amountCents);
      return priced.ok ? { ...priced, contents: { kind: 'lodging', ...validityOf(campaign) } } : priced;
    }
    const contents = contentsFor(campaign, request, { cheapestWhenMissing: !admin });
    if (!contents.ok) return contents;
    const priced = priceContents(contents.contents);
    return priced.ok ? { ...priced, contents: { ...contents.contents, ...validityOf(campaign), lines: frozenLines(priced.lines) } } : priced;
  }

  /** Rules 5, 17, 26 — the price of a request, for the site and the back-office alike. */
  function price(request, { admin = false } = {}) {
    const body = request && typeof request === 'object' ? request : {};
    const found = campaignOf(body, { admin });
    if (!found.ok) return found;
    const priced = priceRequest(found.campaign, body, { admin });
    // Rule 13 — the end of the voucher is the server's to compute: the recap says « Valable jusqu'au … » from it.
    const validUntil = rules.expiryFor(rules.parisDate(now()), found.campaign.validityMonths);
    return priced.ok ? { ...priced, kind: found.campaign.kind, title: found.campaign.title, validUntil } : priced;
  }

  /**
   * Rule 66 — what a campaign sells before the buyer adds time or options, for one period (the cheapest when none is named): the frozen contents the back of its voucher is read
   * from. → `{ ok, contents }` | refusal.
   */
  const baseContents = (campaign, period) => contentsFor(campaign, period ? { period } : {}, { cheapestWhenMissing: true });

  // ── the offer ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The lines a buyer reads under « Votre bon comprend », in generic French: the session with its hours, then each option. */
  function contentLines(contents) {
    const { resource } = contents;
    const element = catalogue.element(`resource:${resource.id}`);
    const mode = element && element.modes.find((m) => m.band === resource.band);
    const hours = mode ? ` · de ${mode.from} à ${mode.to}` : '';
    return [
      { kind: 'session', label: resource.name, detail: `${durationText(resource.includedMinutes)} en ${BAND_WORDS[resource.band]}${rules.periodSuffix(resource)}${hours}`, qty: 1 },
      ...contents.options.map((o) => ({ kind: 'option', label: o.label, detail: null, qty: o.qty })),
    ];
  }

  // Rule 11 — what a period means for a voucher of this band, in the words the page shows under the period control (and as a fact when only one period is sold).
  const PERIOD_HINTS = Object.freeze({
    week: Object.freeze({
      day: 'Semaine : du lundi au vendredi en journée. Utilisable le week-end avec un supplément.',
      evening: 'Semaine : du lundi au jeudi en soirée. Utilisable le week-end avec un supplément.',
    }),
    weekend: Object.freeze({
      day: 'Week-end : samedi, dimanche et jours fériés, en journée. Utilisable tous les jours.',
      evening: 'Week-end : vendredi, samedi, dimanche et jours fériés, en soirée. Utilisable tous les jours.',
    }),
  });

  /** Rules 10-11 — the price of the base contents for each period the campaign sells, the cheapest first as « à partir de ». → `{ ok, periods: [{ period, priceCents, label }] }` | refusal. */
  function periodPrices(campaign) {
    const prices = [];
    for (const period of (campaign.periods && campaign.periods.length ? campaign.periods : ['week'])) {
      const base = contentsFor(campaign, { period });
      if (!base.ok) return base;
      const priced = priceContents(base.contents);
      if (!priced.ok) return priced;
      prices.push({
        period, priceCents: priced.totalCents, label: rules.PERIOD_LABELS[period], hint: PERIOD_HINTS[period][campaign.composition.band] || null, base: base.contents,
      });
    }
    return { ok: true, prices };
  }

  function describeResource(campaign) {
    const priced = periodPrices(campaign);
    if (!priced.ok) return priced;
    const cheapest = priced.prices.reduce((best, p) => (p.priceCents < best.priceCents ? p : best), priced.prices[0]);
    const element = catalogue.element(`resource:${campaign.composition.resourceId}`);
    const mode = element && element.modes.find((m) => m.band === campaign.composition.band);
    const step = mode ? mode.slotMinutes : null;
    const extraTimeFor = (period) => extrasPricing.extraTime({
      resourceId: campaign.composition.resourceId,
      band: campaign.composition.band,
      rankOffsetMinutes: campaign.composition.minutes,
      stepMinutes: step,
      maxMinutes: campaign.extraTimeMaxMinutes,
      period,
    });
    return {
      ok: true,
      view: {
        slug: campaign.slug,
        kind: 'resource',
        title: campaign.title,
        validityMonths: campaign.validityMonths,
        band: mode ? { key: mode.band, label: BAND_WORDS[mode.band], from: mode.from, to: mode.to } : null,
        contents: contentLines(cheapest.base),
        contentsByPeriod: Object.fromEntries(priced.prices.map((p) => [p.period, contentLines(p.base)])),
        addOns: extrasPricing.priced(campaign.addOns.map((articleRef) => ({ articleRef, label: labelOf(articleRef), maxQty: campaignRules.MAX_QTY }))),
        periods: priced.prices.map(({ period, priceCents, label, hint }) => ({ period, priceCents, label, hint })),
        extraTime: campaign.extraTimeMaxMinutes > 0 && step ? {
          maxMinutes: campaign.extraTimeMaxMinutes,
          stepMinutes: step,
          prices: extraTimeFor(cheapest.period),
          pricesByPeriod: Object.fromEntries(priced.prices.map((p) => [p.period, extraTimeFor(p.period)])),
        } : null,
        totalCents: cheapest.priceCents,
      },
    };
  }

  async function describeLodging(campaign) {
    return {
      slug: campaign.slug,
      kind: 'lodging',
      title: campaign.title,
      validityMonths: campaign.validityMonths,
      minAmountCents: campaign.minAmountCents,
      maxAmountCents: campaign.maxAmountCents,
      ideas: await ideasFor(campaign).read(),
    };
  }

  /** Rule 6 — whether a campaign can be offered now: `{ priceable: true, totalCents }` (a lodging campaign has no price of its own), or the engine's reason it cannot. */
  function campaignStatus(campaign) {
    if (campaign.kind === 'lodging') return { priceable: true, totalCents: null };
    const described = describeResource(campaign);
    return described.ok ? { priceable: true, totalCents: described.view.totalCents } : { priceable: false, reason: described.message };
  }

  async function offer({ withOmitted = false } = {}) {
    const views = [];
    const omitted = [];
    for (const campaign of campaigns.onSale()) {
      if (campaign.kind === 'lodging') {
        views.push(await describeLodging(campaign)); // eslint-disable-line no-await-in-loop
      } else {
        const described = describeResource(campaign);
        if (described.ok) views.push(described.view);
        else omitted.push({ id: campaign.id, name: campaign.name, reason: described.message });
      }
    }
    const lodging = views.find((v) => v.kind === 'lodging');
    return {
      campaigns: views,
      ...(lodging ? {
        minAmountCents: lodging.minAmountCents, maxAmountCents: lodging.maxAmountCents, validityMonths: lodging.validityMonths, ideas: lodging.ideas,
      } : {}),
      ...(withOmitted ? { omitted } : {}),
    };
  }

  // ── the parties of an order ───────────────────────────────────────────────────────────────────────────────────────

  const textProblem = (value, max) => value !== undefined && value !== null && (typeof value !== 'string' || value.length > max);

  /**
   * Rules 18, 41 and site-outside-resource-booking rule 32 — who the voucher is for (first and last name, both required) and from, the message and the e-mail. `emailRequired` for a site order and a payment link; `legacyName` (public orders only) still takes the single `recipientName` of a connector before 1.24.0 as the first name, optional as it was.
   * → `{ ok, value }` | `{ ok: false, code, field? }`.
   */
  function partiesOf(rawBody, { emailRequired, legacyName = false }) {
    const legacy = legacyName && rawBody.recipientFirstName === undefined && rawBody.recipientLastName === undefined && rawBody.recipientName !== undefined && rawBody.recipientName !== null;
    const body = legacy ? { ...rawBody, recipientFirstName: rawBody.recipientName, recipientLastName: '' } : rawBody;
    const names = [['recipientFirstName', 'RECIPIENT_FIRST_NAME_REQUIRED'], ['recipientLastName', 'RECIPIENT_LAST_NAME_REQUIRED']];
    for (const [field] of names) {
      if (textProblem(body[field], MAX_NAME)) return { ok: false, code: 'FIELD_INVALID', field };
    }
    if (textProblem(body.senderName, MAX_NAME) || textProblem(body.message, MAX_MESSAGE)) return { ok: false, code: 'FIELD_INVALID' };
    const clean = (value) => (typeof value === 'string' ? value.trim() : '');
    for (const [field, code] of names) {
      if (!legacy && !clean(body[field])) return { ok: false, code, field };
    }
    if (body.language !== undefined && body.language !== 'fr' && body.language !== 'en') return { ok: false, code: 'FIELD_INVALID' };
    if (body.email !== undefined && body.email !== null && typeof body.email !== 'string') return { ok: false, code: 'EMAIL_INVALID' };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email.length > MAX_EMAIL || (emailRequired && !email) || (email && !EMAIL.test(email))) return { ok: false, code: 'EMAIL_INVALID' };
    return {
      ok: true,
      value: {
        recipientFirstName: clean(body.recipientFirstName), recipientLastName: clean(body.recipientLastName), senderName: clean(body.senderName), message: clean(body.message), email, language: body.language === 'en' ? 'en' : 'fr',
      },
    };
  }

  // ── orders and payment ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The terms an order must be accepted under (rule 37): the campaign's activity — the lodging terms for a lodging campaign, the resource's for a composed one. → `{ ok, activity }`.
   */
  function activityOf(request, { admin = false } = {}) {
    const found = campaignOf(request && typeof request === 'object' ? request : {}, { admin });
    return found.ok ? { ok: true, activity: activityOfCampaign(found.campaign) } : found;
  }

  /**
   * `afterInsert(order, campaign)` runs in the transaction that writes the order, so what must exist with it (the buyer's acceptance of the terms) exists with it or not at all.
   */
  function createOrder({
    request, parties, source, createdBy = 'public', paymentMethod = null, visitorHash = null, afterInsert = null, admin = false, vatOverride,
  }) {
    const body = request && typeof request === 'object' ? request : {};
    const found = campaignOf(body, { admin });
    if (!found.ok) return found;
    const priced = priceRequest(found.campaign, body, { admin });
    if (!priced.ok) return priced;
    const vatLines = vatOverride === undefined ? priced.vatLines : vatOverride;
    const order = transaction(() => {
      const campaignId = found.campaign.id === undefined ? campaigns.insert(found.campaign) : found.campaign.id;
      const created = orders.create({
        amountCents: priced.totalCents,
        ...parties,
        visitorHash,
        source,
        paymentMethod,
        createdBy,
        campaignId,
        contents: priced.contents,
        vatLines,
      });
      if (afterInsert) afterInsert(created, { ...found.campaign, id: campaignId });
      return created;
    });
    return {
      ok: true, order, price: { ...priced, kind: found.campaign.kind, title: found.campaign.title },
    };
  }

  /** Rule 19 — an order whose campaign is not on sale (or whose composition cannot be priced) any more cannot be paid; otherwise it is priced again, right now. */
  function repriceOrder(order) {
    const campaign = order.campaignId ? campaigns.find(order.campaignId) : null;
    if (!campaign) return refuse('CAMPAIGN_UNKNOWN', 'Offre inconnue.');
    if (!campaign.oneShot && campaign.state !== 'on_sale') return refuse('CAMPAIGN_CLOSED', 'Cette offre n’est plus en vente.');
    const held = rules.contentsOf(order);
    const priced = held.kind === 'lodging' ? priceLodging(campaign, order.amountCents) : priceContents(held);
    if (!priced.ok) return priced;
    const contents = held.kind === 'lodging' ? held : { ...held, lines: frozenLines(priced.lines) };
    if (priced.totalCents !== order.amountCents || JSON.stringify(contents) !== order.contents || (priced.vatLines && JSON.stringify(priced.vatLines) !== order.vatLines)) {
      orders.reprice(order.id, { amountCents: priced.totalCents, contents, vatLines: priced.vatLines });
    }
    return {
      ok: true,
      totalCents: priced.totalCents,
      label: contents.kind === 'resource' ? `${contents.title} · ${rules.formatEuros(priced.totalCents)}` : `Bon cadeau de ${rules.formatEuros(priced.totalCents)}`,
    };
  }

  /** Rule 19 — the order priced again and its one-hour payment link minted; `returnUrl` is where the bank sends the buyer back (null for a link mailed by the operator). */
  async function startPayment(orderId, { returnUrl = null } = {}) {
    const order = orders.find(orderId);
    if (!order) return refuse('VOUCHER_ORDER_NOT_FOUND', 'Bon introuvable.');
    const repriced = repriceOrder(order);
    if (!repriced.ok) return repriced;
    let link;
    try {
      link = await payments.saleLink({
        ref: order.id, title: repriced.label, amountCents: repriced.totalCents, validityMinutes: LINK_MINUTES,
      }, { redirectUrl: returnUrl });
    } catch (error) {
      if (error && error.error === 'LINK_ALREADY_PAID') return refuse('PAYMENT_PENDING', 'Un paiement est en cours de confirmation.');
      if (error && error.error === 'NO_PAYMENT_PROVIDER') return refuse('ONLINE_SALE_UNAVAILABLE', 'La vente en ligne n’est pas disponible pour le moment.');
      return refuse('PAYMENT_PROVIDER_ERROR', 'Le paiement n’a pas pu être préparé.');
    }
    orders.setLink(order.id, link.linkId);
    return {
      ok: true, url: link.url, totalCents: repriced.totalCents, label: repriced.label,
    };
  }

  /**
   * Rule 41 — « Payé » and « Offert »: the order and its voucher in one transaction. « Offert » records no sale and no VAT: its amount is the value of the contents, its
   * ledger reads « Offert par l'établissement » with the operator's name, and the books skip it.
   */
  function issueDirect({
    request, parties, outcome, paymentMethod, actor, issueDate = null,
  }) {
    const offered = outcome === 'offered';
    return transaction(() => {
      const created = createOrder({
        request, parties, source: 'manual', createdBy: actor, paymentMethod: offered ? rules.OFFERED_METHOD : paymentMethod, admin: true, vatOverride: offered ? [] : undefined,
      });
      if (!created.ok) return created;
      const issued = issuance.issue({
        orderId: created.order.id, actor, issueDate, note: offered ? OFFERED_NOTE : null,
      });
      return { ok: true, voucherId: issued.voucherId, price: created.price };
    });
  }

  return {
    offer, baseContents, price, campaignStatus, activityOf, createOrder, repriceOrder, startPayment, issueDirect, partiesOf, invalidateIdeas, durationText,
  };
}

module.exports = {
  createOfferService, durationText, statusOf, activityOfCampaign, LINK_MINUTES,
};
