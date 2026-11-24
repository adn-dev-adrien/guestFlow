/**
 * The voucher front a campaign sells, as the website shows it (specs/gift-voucher-campaigns.md rule 62). `describe` is what the offer says of it — the current version and
 * the size of the web picture — so the site builds a versioned address and reserves the card's room before it loads. `image` answers that picture: the print file of the
 * library resized for a screen, never the file itself. Only the front of a campaign on sale; a one-shot's and a merchant card's stay off the site.
 */

const sharp = require('sharp');
const images = require('./visualImages');

const WEB_WIDTH = 720;
const KEPT_PICTURES = 32;

function createSiteVisual({ campaigns, visuals, filesDir }) {
  const pictures = new Map();

  function frontOf(campaign) {
    if (!campaign || campaign.oneShot || campaign.state !== 'on_sale' || !campaign.voucherVisualId) return null;
    const visual = visuals.find(campaign.voucherVisualId);
    return visual && visual.current && !visual.current.purgedAt ? visual.current : null;
  }

  /** → `{ versionId, width, height }` of the web picture, or `null` when the campaign shows none. */
  function describe(campaign) {
    const version = frontOf(campaign);
    if (!version) return null;
    return { versionId: version.id, width: WEB_WIDTH, height: Math.round((version.height * WEB_WIDTH) / version.width) };
  }

  async function pictureOf(version) {
    if (pictures.has(version.id)) return pictures.get(version.id);
    const buffer = await sharp(images.read(filesDir(), version.path)).rotate().resize({ width: WEB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    if (pictures.size >= KEPT_PICTURES) pictures.delete(pictures.keys().next().value);
    pictures.set(version.id, buffer);
    return buffer;
  }

  /** → `{ buffer, current }` — `current` when the asked version is the one on sale, so the answer may be kept for good — or `null`. */
  async function image(slug, versionId) {
    const version = frontOf(campaigns.findBySlug(String(slug || '')));
    if (!version) return null;
    let buffer;
    try {
      buffer = await pictureOf(version);
    } catch {
      return null;
    }
    return { buffer, current: String(versionId) === String(version.id) };
  }

  return { describe, image };
}

module.exports = { createSiteVisual, WEB_WIDTH };
