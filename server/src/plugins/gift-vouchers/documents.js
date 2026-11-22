/**
 * The two printed documents, assembled from what is stored (specs/gift-voucher-campaigns.md rules 21, 33, 48-50): the voucher's PDF — the front frozen on the voucher when it
 * was issued, the back from the voucher, the company's settings and the permanent paths — and the merchant card of a campaign, from the campaign's current merchant visual.
 * The drawing is `voucherPdf`; this reads the voucher's code back, the image bytes and the company, and refuses with a code the controllers word.
 */

const rules = require('./voucherRules');
const images = require('./visualImages');
const pdf = require('./voucherPdf');

const refused = (code) => Object.assign(new Error(code), { code });

function createDocuments({
  visuals, campaigns, filesDir, company, linkBase, decrypt, render = pdf,
}) {
  /** The image of a version as it sits on disk; null when the version is unknown or its file is gone (the front is then plain, never a refusal). */
  function frontOf(versionId) {
    const version = versionId ? visuals.versionById(versionId) : null;
    if (!version || version.purgedAt) return null;
    try {
      return images.read(filesDir(), version.path);
    } catch {
      return null;
    }
  }

  async function companyAndOrigin() {
    const read = await company();
    if (!read.website) throw refused('NO_SITE_ORIGIN');
    return { company: read, origin: read.website };
  }

  /** Rules 21, 49 — the PDF of an issued voucher (a row of `vouchersModel`). */
  async function voucherPdf(voucher, { qr } = {}) {
    const plain = decrypt(voucher.codeEncrypted);
    if (!plain.ok) throw refused('CODE_UNREADABLE');
    const { company: who, origin } = await companyAndOrigin();
    const frozen = rules.parseJson(voucher.visualVersions, null);
    return render.renderVoucherPdf({
      voucher: { ...voucher, code: plain.value },
      front: frontOf(frozen && frozen.voucher),
      company: who,
      origin,
      linkBase: linkBase(),
    }, qr ? { qr } : undefined);
  }

  /** Rules 33, 49 — the merchant card of a campaign: refused without a slug, a merchant front or the website. */
  async function merchantCardPdf(campaign, { qr } = {}) {
    if (!campaign.slug) throw refused('CAMPAIGN_NO_SLUG');
    const visual = campaign.merchantVisualId ? visuals.find(campaign.merchantVisualId) : null;
    if (!visual || visual.deletedAt) throw refused('NO_MERCHANT_VISUAL');
    const { company: who, origin } = await companyAndOrigin();
    return render.renderMerchantCardPdf({
      campaign, front: frontOf(visual.current.id), company: who, origin, linkBase: linkBase(),
    }, qr ? { qr } : undefined);
  }

  return { voucherPdf, merchantCardPdf, frontOf };
}

module.exports = { createDocuments };
