/**
 * The voucher's back for the website (specs/gift-voucher-campaigns.md rule 66). The site draws the back in HTML, millimetre for millimetre as `voucherPdf.js` draws it, and writes
 * nothing of it itself: this module sends the dimensions and the fixed words the PDF reads (`BACK_LAYOUT`, `BACK_TEXTS`), the company's logo, name, town and website, the link
 * printed beside the QR code, the lines « Votre bon comprend » (`contentLines`, the PDF's own function) and the validity (`rules.expiryFor`, the issuance's own). The page only
 * adds what the buyer types.
 *
 *   offer()                    → the part shared by every campaign, with the QR code of the site's home page — `null` when the company has no website
 *   campaign(view, campaign)   → what one campaign adds: its lines, the line each extra time and each quantity of an option adds (written here, never by the page), and the validity of a
 *                                purchase made today; a lodging campaign sends a template holding the amount instead
 *   voucher(voucher, code)     → the back of an issued voucher: its lines, validity, link and the QR code of its real redemption link
 *   logo()                     → the logo as a PNG with the hash of its bytes, or `null`
 */

const crypto = require('crypto');
const QRCode = require('qrcode');
const rules = require('./voucherRules');
const {
  contentLines, LODGING_LINE, extraTimeLine, countOf,
} = require('./contentsText');
const {
  BACK_LAYOUT, BACK_TEXTS, redeemUrl, shortLink,
} = require('./voucherPdf');

const LOGO_PATH = '/public/v1/gift-vouchers/logo';
const COMPANY_KEPT_MS = 60 * 1000;

const qrSvg = (url) => QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });

function createCardBack({
  company, linkBase, baseContents, now = () => new Date(),
}) {
  let kept = null;

  /** The company's settings, read at most once a minute: the logo is decoded and resized each time it is read. */
  async function companyRead() {
    const at = now().getTime();
    if (kept && at - kept.at < COMPANY_KEPT_MS) return kept.value;
    const value = await company();
    kept = { at, value };
    return value;
  }

  /** → `{ company, origin }`, or `null` when there is no website: the site then draws the front only. */
  async function siteOf() {
    const read = await companyRead();
    return read && read.website ? { company: read, origin: read.website } : null;
  }

  const hashOf = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

  async function logo() {
    const read = await companyRead();
    return read && read.logo ? { buffer: read.logo, hash: hashOf(read.logo) } : null;
  }

  async function offer() {
    const site = await siteOf();
    if (!site) return null;
    const { company: who, origin } = site;
    const mark = who.logo ? hashOf(who.logo) : null;
    return {
      layout: BACK_LAYOUT,
      texts: BACK_TEXTS,
      logoUrl: mark ? `${LOGO_PATH}?v=${mark}` : null,
      companyName: who.name,
      identity: [who.name, who.town, who.department].filter(Boolean).join(' · '),
      website: shortLink(origin),
      link: shortLink(redeemUrl({ origin, linkBase: linkBase() })),
      previewQrSvg: await qrSvg(origin),
    };
  }

  /** `view` is the campaign as the offer describes it (its title, kind and validity), `campaign` the stored row. */
  function campaign(view, stored) {
    const validUntil = rules.formatFrDate(rules.expiryFor(rules.parisDate(now()), view.validityMonths));
    if (view.kind === 'lodging') return { lineTemplate: LODGING_LINE, validUntil, title: BACK_TEXTS.lodgingTitle, steps: BACK_TEXTS.lodgingSteps };
    // Rule 20 — a campaign that sells two periods has the lines of each (« · semaine » / « · week-end »); `lines` are the cheapest period's, for a page that predates them.
    const linesOf = (period) => {
      const read = baseContents(stored, period);
      return read.ok ? contentLines({ contents: JSON.stringify(read.contents) }) : [];
    };
    const linesByPeriod = Object.fromEntries((view.periods || []).map((p) => [p.period, linesOf(p.period)]));
    const addOns = Object.fromEntries((view.addOns || []).map((a) => [a.articleRef, Object.fromEntries((a.prices || []).map((p) => [p.qty, countOf(p.qty, a.label)]))]));
    const extraTime = Object.fromEntries(((view.extraTime && view.extraTime.prices) || []).map((p) => [p.minutes, extraTimeLine(p.minutes)]));
    // Rule 20 of the week-weekend spec — the back's title is the campaign's, with the period the giver picks: one title per period the campaign sells.
    const titles = Object.fromEntries((view.periods || []).map((p) => [p.period, `${view.title} · ${rules.PERIOD_LABELS[p.period]}`]));
    return {
      lines: linesOf(), linesByPeriod, extraTime, addOns, validUntil, titles,
    };
  }

  async function voucher(issued, plainCode) {
    const site = await siteOf();
    if (!site) return null;
    const { origin } = site;
    const base = { origin, linkBase: linkBase() };
    const contents = rules.contentsOf(issued);
    return {
      title: contents && contents.title ? contents.title : BACK_TEXTS.lodgingTitle,
      steps: contents && contents.kind === 'lodging' ? BACK_TEXTS.lodgingSteps : BACK_TEXTS.steps,
      lines: contentLines(issued),
      validUntil: rules.formatFrDate(issued.expiresOn),
      link: shortLink(redeemUrl(base)),
      qrSvg: await qrSvg(redeemUrl(base, plainCode)),
    };
  }

  return {
    offer, campaign, voucher, logo,
  };
}

module.exports = { createCardBack, LOGO_PATH };
