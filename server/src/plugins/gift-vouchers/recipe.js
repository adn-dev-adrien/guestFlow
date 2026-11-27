/**
 * A campaign as a recipe (specs/gift-vouchers/gift-voucher-campaigns.md rule 10): a `.zip` holding `campaign.json` and its images. The recipe names what the campaign contains — the resource, the
 * options, the add-ons — by their names in GuestFlow and the tariff mode by its band, never by a price or an internal id, so it can be read, edited and carried to another instance.
 * An import is all-or-nothing: the names are resolved to the catalogue, the whole campaign goes through the same `campaignRules` as the form, the images through the same judgement as
 * the visual library, and only when every field passes is anything written — the campaign as a draft, its images joining the library.
 */

const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const campaignRules = require('./campaignRules');
const images = require('./visualImages');

const FORMAT = 'gift-voucher-campaign';
const VERSION = 1;
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const MAX_JSON_BYTES = 200 * 1024;
const IMAGE_NAME = /^images\/[A-Za-z0-9._-]{1,80}\.(jpg|jpeg|png)$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const extensionOf = (path) => (path.endsWith('.png') ? '.png' : '.jpg');

function createRecipe({
  campaigns, catalogue, visuals, filesDir, transaction,
}) {
  const bytesOf = (visualId) => {
    const visual = visualId ? visuals.find(visualId) : null;
    return visual && !visual.deletedAt && visual.current ? { visual, bytes: images.read(filesDir(), visual.current.path) } : null;
  };

  /** → `{ ok: true, filename, buffer }`, or a refusal for a campaign that has no recipe (a lodging campaign carries ideas of stays, not a composition). */
  function exportCampaign(campaign) {
    if (!campaign || campaign.oneShot || campaign.kind !== 'resource') {
      return { ok: false, code: 'RECIPE_NOT_AVAILABLE', message: 'Seule une campagne composée s’exporte en recette.' };
    }
    const nameOf = (articleRef) => (catalogue.element(articleRef) || {}).label || articleRef;
    const { composition } = campaign;
    const files = {};
    const pictures = {};
    const voucher = bytesOf(campaign.voucherVisualId);
    const merchant = bytesOf(campaign.merchantVisualId);
    const addPicture = (role, found, use) => {
      const file = `images/${role}${extensionOf(found.visual.current.path)}`;
      files[file] = new Uint8Array(found.bytes);
      pictures[role] = { name: found.visual.name, use, file };
    };
    if (voucher) addPicture('voucher', voucher, campaign.merchantVisualId === campaign.voucherVisualId ? 'both' : 'voucher');
    if (merchant && campaign.merchantVisualId !== campaign.voucherVisualId) addPicture('merchant', merchant, 'merchant');
    const recipe = {
      format: FORMAT,
      version: VERSION,
      campaign: {
        name: campaign.name,
        title: campaign.title,
        kind: campaign.kind,
        slug: campaign.slug,
        validityMonths: campaign.validityMonths,
        periods: campaign.periods,
        frontPricePosition: campaign.frontPricePosition,
        composition: {
          resource: nameOf(`resource:${composition.resourceId}`),
          band: composition.band,
          minutes: composition.minutes,
          options: composition.options.map((o) => ({ option: nameOf(o.articleRef), qty: o.qty })),
        },
        addOns: campaign.addOns.map(nameOf),
        extraTimeMaxMinutes: campaign.extraTimeMaxMinutes,
        images: pictures,
      },
    };
    const buffer = Buffer.from(zipSync({ 'campaign.json': strToU8(`${JSON.stringify(recipe, null, 2)}\n`), ...files }, { level: 0 }));
    return { ok: true, filename: `${campaign.slug || 'campagne'}.zip`, buffer };
  }

  /** The element of the catalogue a recipe names, by its label: one exactly, else the sentence that says it is not there (or not alone). */
  function resolve(kind, name, field) {
    const wanted = String(name === undefined || name === null ? '' : name).trim().toLowerCase();
    const found = catalogue.list().filter((e) => e.kind === kind && e.label.trim().toLowerCase() === wanted);
    if (found.length === 1) return { element: found[0] };
    return { error: { field, message: found.length ? `Article ambigu : ${name}` : `Article introuvable : ${name}` } };
  }

  /** The recipe's names resolved to catalogue ids, in the shape `validateCampaign` reads. Every name that does not resolve is reported. */
  function inputFrom(recipe) {
    const errors = [];
    const c = recipe.campaign;
    const comp = isObject(c.composition) ? c.composition : {};
    const resource = resolve('resource', comp.resource, 'composition.resource');
    if (resource.error) errors.push(resource.error);
    const options = (Array.isArray(comp.options) ? comp.options : []).map((entry, index) => {
      const found = resolve('option', isObject(entry) ? entry.option : undefined, `composition.options[${index}]`);
      if (found.error) errors.push(found.error);
      return found.element ? { articleRef: found.element.articleRef, qty: entry.qty } : null;
    });
    const addOns = (Array.isArray(c.addOns) ? c.addOns : []).map((name, index) => {
      const found = resolve('option', name, `addOns[${index}]`);
      if (found.error) errors.push(found.error);
      return found.element ? found.element.articleRef : null;
    });
    return {
      errors,
      input: {
        name: c.name,
        title: c.title,
        kind: c.kind,
        state: 'draft',
        slug: c.slug === null ? undefined : c.slug,
        validityMonths: c.validityMonths,
        // A recipe written before the weekend grid names neither: both periods and the default corner then apply (the rules' own defaults).
        periods: c.periods,
        frontPricePosition: c.frontPricePosition,
        composition: { resourceId: resource.element ? resource.element.id : undefined, band: comp.band, minutes: comp.minutes, options: options.filter(Boolean) },
        addOns: addOns.filter(Boolean),
        extraTimeMaxMinutes: c.extraTimeMaxMinutes,
      },
    };
  }

  /** The archive's content, or the sentence that says why it is not a recipe. */
  function open(buffer) {
    let files;
    try {
      files = unzipSync(new Uint8Array(buffer), { filter: (file) => file.originalSize <= MAX_ARCHIVE_BYTES });
    } catch {
      return { error: 'Ce fichier n’est pas une recette : une archive .zip est attendue.' };
    }
    const raw = files['campaign.json'];
    if (!raw || raw.length > MAX_JSON_BYTES) return { error: 'Cette archive ne contient pas de campaign.json lisible.' };
    let recipe;
    try {
      recipe = JSON.parse(strFromU8(raw));
    } catch {
      return { error: 'campaign.json n’est pas un JSON valide.' };
    }
    if (!isObject(recipe) || recipe.format !== FORMAT || recipe.version !== VERSION || !isObject(recipe.campaign)) {
      return { error: `campaign.json n’est pas une recette de campagne (format « ${FORMAT} », version ${VERSION}).` };
    }
    return { recipe, files };
  }

  /** Each image the recipe names: present in the archive and accepted by the library's rule. → `{ pictures: [{ role, name, use, bytes, checked }], errors }`. */
  async function picturesOf(recipe, files) {
    const errors = [];
    const pictures = [];
    const declared = isObject(recipe.campaign.images) ? recipe.campaign.images : {};
    for (const role of ['voucher', 'merchant']) {
      const entry = declared[role];
      if (entry === undefined) continue; // eslint-disable-line no-continue
      const field = `images.${role}`;
      if (!isObject(entry) || typeof entry.file !== 'string' || !IMAGE_NAME.test(entry.file) || !files[entry.file]) {
        errors.push({ field, message: `Image introuvable dans l’archive : ${isObject(entry) ? entry.file : role}` });
        continue; // eslint-disable-line no-continue
      }
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 80) : `Visuel ${recipe.campaign.name}`;
      const use = ['voucher', 'merchant', 'both'].includes(entry.use) ? entry.use : role;
      const bytes = Buffer.from(files[entry.file]);
      const checked = await images.inspect(bytes); // eslint-disable-line no-await-in-loop
      if (!checked.ok) errors.push({ field, message: `${entry.file} : ${checked.message}` });
      else pictures.push({ role, name, use, bytes, checked });
    }
    return { pictures, errors };
  }

  /** → `{ ok: true, campaign }` (a draft) or `{ ok: false, errors: [{ field, message }] }`; nothing is written unless every field passes. */
  async function importArchive(buffer) {
    const opened = open(buffer);
    if (opened.error) return { ok: false, errors: [{ field: 'archive', message: opened.error }] };
    const { recipe, files } = opened;
    const resolved = inputFrom(recipe);
    const checked = campaignRules.validateCampaign(resolved.input, { catalogue, campaigns, visuals });
    const stored = await picturesOf(recipe, files);
    // Names that did not resolve already explain the composition errors they cause: they are reported alone.
    const errors = resolved.errors.length ? resolved.errors : [...(checked.ok ? [] : checked.errors), ...stored.errors];
    if (errors.length || !checked.ok) return { ok: false, errors };
    const written = [];
    try {
      const id = transaction(() => {
        const value = { ...checked.value };
        stored.pictures.forEach((picture) => {
          const path = images.store(picture.bytes, filesDir(), picture.checked.format);
          written.push(path);
          const visualId = visuals.insert({
            name: picture.name, use: picture.use, file: { path, width: picture.checked.width, height: picture.checked.height },
          });
          if (picture.role === 'voucher') {
            value.voucherVisualId = visualId;
            if (picture.use === 'both') value.merchantVisualId = visualId;
          } else {
            value.merchantVisualId = visualId;
          }
        });
        return campaigns.insert(value);
      });
      return { ok: true, campaign: campaigns.find(id) };
    } catch (error) {
      written.forEach((path) => images.remove(filesDir(), path));
      throw error;
    }
  }

  return { exportCampaign, importArchive };
}

module.exports = { createRecipe, FORMAT, VERSION };
