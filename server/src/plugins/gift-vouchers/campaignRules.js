/**
 * What a campaign may be (specs/gift-voucher-campaigns.md rules 2-6, 9, 46): one judgement shared by the campaign form, « Sur mesure » and, later, the recipe
 * import. Every refusal names its field and says why in French; nothing is written when one field fails.
 *
 *   validateCampaign(input, { catalogue, campaigns, existing, oneShot }) → { ok: true, value } | { ok: false, errors: [{ field, message }] }
 *   validateComposition(composition, { catalogue }, field)               → the same, for a composition alone (« Sur mesure », the price preview)
 *
 * `catalogue` answers `element(articleRef)` (the element with its sellability and reason, `catalogueView.js`) and `sessionRefusal({ resourceId, band, minutes,
 * rankOffsetMinutes })` — the sentence the pricing engine's hourly family gives for a session that cannot be sold, so the form never judges a slot by itself.
 * `campaigns` answers `findBySlug(slug)`. Pure otherwise: no database, no clock.
 */

const rules = require('./voucherRules');

const MAX_NAME = 80;
const MAX_SLUG = 60;
const MAX_QTY = 20;
const MAX_IDEAS = 6;
const MAX_IDEA_LABEL = 60;
const MAX_NIGHTS = 60;
const MAX_GUESTS = 30;
const MAX_ADD_ONS = 12;
const MAX_OPTIONS = 12;
const STATES = Object.freeze(['draft', 'on_sale', 'closed']);
const KINDS = Object.freeze(['lodging', 'resource']);
const BANDS = Object.freeze(['day', 'evening']);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const IDEA_KEYS = Object.freeze(['label', 'propertyId', 'nights', 'guests']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const asInt = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);

/** The ideas as a list, from the stored JSON or a list: null when it is neither. */
function parseIdeas(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Rule 3 (specs/gift-vouchers.md rule 14) — an idea is always a stay to price, never a bare amount (Adrien, 2026-11-15). */
function ideasError(value) {
  const list = parseIdeas(value);
  if (!list) return 'Les idées doivent être une liste de séjours.';
  if (list.length > MAX_IDEAS) return `Au plus ${MAX_IDEAS} idées.`;
  for (const idea of list) {
    if (!isObject(idea)) return 'Chaque idée est un séjour : libellé, logement, nuits, personnes.';
    if (Object.keys(idea).some((k) => !IDEA_KEYS.includes(k))) return 'Une idée est un séjour à chiffrer, jamais un montant : libellé, logement, nuits, personnes.';
    if (typeof idea.label !== 'string' || !idea.label.trim() || idea.label.length > MAX_IDEA_LABEL) return `Le libellé d’une idée fait de 1 à ${MAX_IDEA_LABEL} caractères.`;
    if (!isPositiveInt(idea.propertyId)) return 'Chaque idée désigne un logement.';
    if (!isPositiveInt(idea.nights) || idea.nights > MAX_NIGHTS) return `Le nombre de nuits d’une idée va de 1 à ${MAX_NIGHTS}.`;
    if (!isPositiveInt(idea.guests) || idea.guests > MAX_GUESTS) return `Le nombre de personnes d’une idée va de 1 à ${MAX_GUESTS}.`;
  }
  return null;
}

/** The stored ideas, as a list; an unreadable value is no idea at all. */
const ideasOf = (value) => (ideasError(value) ? [] : parseIdeas(value));

const requiredText = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_NAME) return `${label} : un texte de 1 à ${MAX_NAME} caractères est attendu.`;
  return null;
};

function validateCentsBound(value, label) {
  const n = asInt(value);
  return Number.isInteger(n) && n >= 100 && n <= 10000000 ? null : `${label} : un nombre entier de centimes, de 1 € à 100 000 €.`;
}

/** An element picked in the catalogue: known, of the expected kind and sellable to an outside customer — else the sentence that says why not. */
function elementProblem(catalogue, articleRef, { kind, label }) {
  const element = typeof articleRef === 'string' ? catalogue.element(articleRef) : null;
  if (!element || element.kind !== kind) return { message: `${label} : « ${articleRef} » n’est pas dans le catalogue.` };
  if (!element.sellable) return { message: `${label} : « ${element.label} » ne peut pas être vendu : ${element.reason}` };
  return { element };
}

function qtyProblem(qty, name, label) {
  const n = asInt(qty);
  return Number.isInteger(n) && n >= 1 && n <= MAX_QTY ? null : `${label} : la quantité de « ${name} » va de 1 à ${MAX_QTY}.`;
}

function validateOptions(list, { catalogue }, field, label) {
  const errors = [];
  const value = [];
  if (list === undefined || list === null) return { errors, value };
  if (!Array.isArray(list) || list.length > MAX_OPTIONS) return { errors: [{ field, message: `${label} : une liste de ${MAX_OPTIONS} options au plus est attendue.` }], value };
  const seen = new Set();
  list.forEach((entry, index) => {
    const at = `${field}[${index}]`;
    if (!isObject(entry)) { errors.push({ field: at, message: `${label} : ligne ${index + 1} invalide.` }); return; }
    const found = elementProblem(catalogue, entry.articleRef, { kind: 'option', label });
    if (found.message) { errors.push({ field: `${at}.articleRef`, message: found.message }); return; }
    if (seen.has(entry.articleRef)) { errors.push({ field: `${at}.articleRef`, message: `${label} : « ${found.element.label} » figure deux fois.` }); return; }
    seen.add(entry.articleRef);
    const bad = qtyProblem(entry.qty === undefined ? 1 : entry.qty, found.element.label, label);
    if (bad) { errors.push({ field: `${at}.qty`, message: bad }); return; }
    value.push({ articleRef: entry.articleRef, qty: Number(asInt(entry.qty === undefined ? 1 : entry.qty)) });
  });
  return { errors, value };
}

/** Rule 4 — exactly one hourly resource (its band and its included minutes) and any options. */
function validateComposition(composition, { catalogue }, field = 'composition') {
  if (!isObject(composition)) return { ok: false, errors: [{ field, message: 'Composition : une ressource à l’heure est à choisir.' }] };
  const errors = [];
  const resourceRef = `resource:${composition.resourceId}`;
  const found = elementProblem(catalogue, resourceRef, { kind: 'resource', label: 'Ressource' });
  let resource = null;
  if (found.message) {
    errors.push({ field: `${field}.resourceId`, message: found.message });
  } else if (!found.element.hourly) {
    errors.push({ field: `${field}.resourceId`, message: `Ressource : « ${found.element.label} » n’est pas une ressource à l’heure : un bon en compose exactement une.` });
  } else {
    resource = found.element;
  }
  const band = composition.band;
  if (!BANDS.includes(band)) errors.push({ field: `${field}.band`, message: 'Tranche : « journée » ou « soirée » est attendu.' });
  const minutes = asInt(composition.minutes);
  if (resource && BANDS.includes(band)) {
    const refusal = catalogue.sessionRefusal({ resourceId: resource.id, band, minutes });
    if (refusal) errors.push({ field: `${field}.minutes`, message: `Durée incluse : ${refusal}` });
  } else if (!Number.isInteger(minutes) || minutes <= 0) {
    errors.push({ field: `${field}.minutes`, message: 'Durée incluse : un nombre entier de minutes est attendu.' });
  }
  const options = validateOptions(composition.options, { catalogue }, `${field}.options`, 'Compris dans le bon');
  errors.push(...options.errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      resourceId: resource.id, band, minutes, options: options.value,
    },
  };
}

function validateAddOns(list, composition, { catalogue }) {
  const errors = [];
  const value = [];
  if (list === undefined || list === null) return { errors, value };
  if (!Array.isArray(list) || list.length > MAX_ADD_ONS) return { errors: [{ field: 'addOns', message: `Options proposées : une liste de ${MAX_ADD_ONS} options au plus est attendue.` }], value };
  const included = new Set(((composition && composition.options) || []).map((o) => o.articleRef));
  list.forEach((articleRef, index) => {
    const found = elementProblem(catalogue, articleRef, { kind: 'option', label: 'Options proposées' });
    if (found.message) { errors.push({ field: `addOns[${index}]`, message: found.message }); return; }
    if (value.includes(articleRef)) { errors.push({ field: `addOns[${index}]`, message: `Options proposées : « ${found.element.label} » figure deux fois.` }); return; }
    if (included.has(articleRef)) { errors.push({ field: `addOns[${index}]`, message: `Options proposées : « ${found.element.label} » est déjà comprise dans le bon.` }); return; }
    value.push(articleRef);
  });
  return { errors, value };
}

function validateExtraTime(extra, composition, { catalogue }) {
  const n = extra === undefined || extra === null ? 0 : asInt(extra);
  if (!Number.isInteger(n) || n < 0) return { error: { field: 'extraTimeMaxMinutes', message: 'Temps supplémentaire : un nombre entier de minutes (0 pour ne pas en proposer).' } };
  if (n === 0 || !composition) return { value: n };
  const refusal = catalogue.sessionRefusal({
    resourceId: composition.resourceId, band: composition.band, minutes: n, rankOffsetMinutes: composition.minutes,
  });
  return refusal ? { error: { field: 'extraTimeMaxMinutes', message: `Temps supplémentaire : ${refusal}` } } : { value: n };
}

function slugProblem(slug, { campaigns, existing }) {
  if (slug === undefined || slug === null || slug === '') return null;
  if (typeof slug !== 'string' || slug.length > MAX_SLUG || !SLUG.test(slug)) return `Lien permanent : minuscules, chiffres et tirets (${MAX_SLUG} caractères au plus), par exemple « bain-nordique ».`;
  if (existing && existing.slugLockedAt && existing.slug !== slug) return 'Lien permanent : verrouillé, une carte du commerçant a été imprimée avec ce lien.';
  const taken = campaigns.findBySlug(slug);
  if (taken && (!existing || taken.id !== existing.id)) return `Lien permanent : « ${slug} » est déjà pris par la campagne « ${taken.name} ».`;
  return null;
}

/** Rule 7 — a front picked in the library: a visual still in it, meant for that front. `null` when none is picked. */
function visualProblem(id, { visuals, field, label, uses }) {
  if (id === undefined || id === null || id === '') return { value: null };
  const n = asInt(id);
  const visual = Number.isInteger(n) && n > 0 && visuals ? visuals.find(n) : null;
  if (!visual || visual.deletedAt) return { error: { field, message: `${label} : ce visuel n’est pas dans la bibliothèque.` } };
  if (!uses.includes(visual.use)) return { error: { field, message: `${label} : « ${visual.name} » n’est pas prévu pour cette face.` } };
  return { value: n };
}

function validateCampaign(input, {
  catalogue, campaigns, visuals = null, existing = null, oneShot = false,
}) {
  if (!isObject(input)) return { ok: false, errors: [{ field: 'body', message: 'Corps de requête invalide.' }] };
  const errors = [];
  const push = (field, message) => { if (message) errors.push({ field, message }); };
  push('name', requiredText(input.name, 'Nom'));
  push('title', requiredText(input.title, 'Titre public'));
  if (!KINDS.includes(input.kind)) push('kind', 'Type : « séjour » (montant libre) ou « ressource » (composé) est attendu.');
  if (oneShot && input.kind !== 'resource') push('kind', 'Type : un bon sur mesure se compose d’une ressource.');
  const state = oneShot ? 'closed' : (input.state === undefined ? 'draft' : input.state);
  if (!STATES.includes(state)) push('state', 'État : brouillon, en vente ou clos.');
  const months = asInt(input.validityMonths);
  if (!Number.isInteger(months) || months < 1 || months > rules.MAX_VALIDITY_MONTHS) push('validityMonths', `Validité : un nombre entier de mois, de 1 à ${rules.MAX_VALIDITY_MONTHS}.`);
  if (oneShot) {
    if (input.slug) push('slug', 'Lien permanent : un bon sur mesure n’a pas de lien.');
  } else {
    push('slug', slugProblem(input.slug, { campaigns, existing }));
  }

  const voucherFront = visualProblem(input.voucherVisualId, {
    visuals, field: 'voucherVisualId', label: 'Face du bon', uses: ['voucher', 'both'],
  });
  const merchantFront = visualProblem(input.merchantVisualId, {
    visuals, field: 'merchantVisualId', label: 'Face de la carte commerçant', uses: ['merchant', 'both'],
  });
  [voucherFront, merchantFront].forEach((front) => { if (front.error) errors.push(front.error); });
  // Rule 7 — the voucher's front is what the mailed PDF shows first: a campaign goes on sale with one.
  if (state === 'on_sale' && !voucherFront.error && voucherFront.value == null) push('voucherVisualId', 'Face du bon : un visuel est nécessaire pour mettre la campagne en vente.');

  const value = {
    name: typeof input.name === 'string' ? input.name.trim() : '',
    title: typeof input.title === 'string' ? input.title.trim() : '',
    kind: input.kind,
    state,
    oneShot,
    slug: oneShot || input.slug === undefined || input.slug === '' ? null : input.slug,
    validityMonths: months,
    composition: null,
    addOns: [],
    extraTimeMaxMinutes: 0,
    minAmountCents: null,
    maxAmountCents: null,
    ideas: [],
    vatRatePercent: null,
    voucherVisualId: voucherFront.value === undefined ? null : voucherFront.value,
    merchantVisualId: merchantFront.value === undefined ? null : merchantFront.value,
  };

  if (input.kind === 'lodging') {
    push('minAmountCents', validateCentsBound(input.minAmountCents, 'Montant minimal'));
    push('maxAmountCents', validateCentsBound(input.maxAmountCents, 'Montant maximal'));
    if (!errors.some((e) => e.field === 'minAmountCents' || e.field === 'maxAmountCents') && Number(input.minAmountCents) > Number(input.maxAmountCents)) {
      push('minAmountCents', 'Montant minimal : au plus le montant maximal.');
    }
    const vat = rules.checkVatRate(input.vatRatePercent);
    if (!vat.ok) push('vatRatePercent', `Taux de TVA : ${vat.message}`);
    push('ideas', ideasError(input.ideas === undefined ? [] : input.ideas));
    if (input.composition !== undefined && input.composition !== null) push('composition', 'Composition : un bon séjour n’a pas de contenu composé.');
    Object.assign(value, {
      minAmountCents: Number(asInt(input.minAmountCents)),
      maxAmountCents: Number(asInt(input.maxAmountCents)),
      vatRatePercent: vat.ok ? vat.percent : null,
      ideas: ideasOf(input.ideas === undefined ? [] : input.ideas),
    });
  }

  if (input.kind === 'resource') {
    const composition = validateComposition(input.composition, { catalogue });
    errors.push(...(composition.ok ? [] : composition.errors));
    const addOns = validateAddOns(input.addOns, composition.ok ? composition.value : null, { catalogue });
    errors.push(...addOns.errors);
    const extra = validateExtraTime(input.extraTimeMaxMinutes, composition.ok ? composition.value : null, { catalogue });
    if (extra.error) errors.push(extra.error);
    if (composition.ok) value.composition = composition.value;
    value.addOns = addOns.value;
    value.extraTimeMaxMinutes = extra.value || 0;
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}

module.exports = {
  validateCampaign, validateComposition, ideasError, ideasOf, parseIdeas, STATES, KINDS, BANDS, MAX_QTY,
};
