/**
 * The e-mail of a voucher (specs/gift-vouchers.md rule 23, specs/gift-voucher-campaigns.md rules 20, 48-49). One delivery path for the operator's « Renvoyer » and for the
 * receipt sent on its own when a voucher sold on the site is issued: the template, the voucher link, the `mail` movement
 * and the « Mail non parti » flag (`mailError`) are the same; the voucher's PDF travels attached, with its code in the body. A voucher sold on the site is mailed automatically — the
 * receipt of a payment the buyer just made (specs/no-automatic-email-without-approval.md); a failed send is retried by a job.
 */

const crypto = require('crypto');
const rules = require('./voucherRules');
const { renderMail } = require('./mailTemplate');

const RETRY_FOR_MS = 3 * 24 * 60 * 60 * 1000;
const SETTLE_MS = 60 * 1000;
const SYSTEM = 'system';

const refused = (code) => Object.assign(new Error(code), { code });

function createReceipt({
  vouchers, orders, movements, campaigns, documents, decrypt, transaction, sendMail, pageUrl, now = () => new Date(),
}) {
  const inflight = new Map();

  /** The page that shows the voucher, for the buyer: `?gf_voucher=<order>&gf_token=<token>`. Null when it cannot be built. */
  function linkOf(voucher) {
    const base = pageUrl();
    const token = orders.tokenOf(voucher.orderId);
    if (!base || !token) return null;
    return `${base.replace(/#.*$/, '')}${base.includes('?') ? '&' : '?'}gf_voucher=${voucher.orderId}&gf_token=${token}`;
  }

  /** The public title of the campaign a voucher was sold from, as the mail names it. */
  function titleOf(voucher) {
    const contents = rules.contentsOf(voucher);
    if (contents.kind === 'resource' && contents.title) return contents.title;
    const campaign = voucher.campaignId ? campaigns.find(voucher.campaignId) : null;
    return campaign ? campaign.title : 'Bon cadeau';
  }

  /**
   * Sends the mail of `voucher` with its PDF attached and records it. `to` is the address the operator typed, the giver's by default; a resend names it in the history.
   * Throws a refusal whose `code` is `NO_EMAIL`, `NO_SITE_ORIGIN`, `CODE_UNREADABLE` or `MAIL_FAILED` (the last one after flagging the voucher).
   */
  async function deliver(voucher, {
    actor, idempotencyKey, to = null,
  }) {
    const address = to || voucher.email;
    if (!address) throw refused('NO_EMAIL');
    const plain = decrypt(voucher.codeEncrypted);
    if (!plain.ok) throw refused('CODE_UNREADABLE');
    const pdf = await documents.voucherPdf(voucher);
    const mail = renderMail({
      voucher, title: titleOf(voucher), plainCode: plain.value, link: linkOf(voucher), language: voucher.language,
    });
    try {
      await sendMail({
        to: address,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: [{ filename: mail.filename, content: pdf, contentType: 'application/pdf' }],
        key: `gift-voucher:${voucher.id}`,
      });
    } catch (error) {
      vouchers.setMail(voucher.id, { error: String(error && error.message ? error.message : error).slice(0, 200) });
      throw refused('MAIL_FAILED');
    }
    transaction(() => {
      vouchers.setMail(voucher.id, { sentAt: now().toISOString() });
      movements.append({
        voucherId: voucher.id, kind: 'mail', actor, idempotencyKey, note: to && to !== voucher.email ? `Renvoyé à ${to}` : null,
      });
    });
  }

  /** The receipt of a voucher sold on the site: at most one at a time per voucher, never twice once it has left. */
  function deliverReceipt(voucherId) {
    if (inflight.has(voucherId)) return inflight.get(voucherId);
    const run = (async () => {
      const voucher = vouchers.find(voucherId);
      if (!voucher || voucher.source !== 'site' || voucher.mailSentAt || voucher.cancelledAt) return;
      try {
        await deliver(voucher, { actor: SYSTEM, idempotencyKey: `mail:receipt:${voucher.id}` });
      } catch (error) {
        if (error.code === 'NO_EMAIL' || error.code === 'NO_SITE_ORIGIN') vouchers.setMail(voucher.id, { error: error.code });
      }
    })().finally(() => inflight.delete(voucherId));
    inflight.set(voucherId, run);
    return run;
  }

  /** Rule 23 — the job: receipts that did not leave (a failed send, a restart in between), for three days after issue. */
  async function retryPending() {
    const at = now().getTime();
    const waiting = vouchers.awaitingMail({
      since: new Date(at - RETRY_FOR_MS).toISOString(), before: new Date(at - SETTLE_MS).toISOString(),
    });
    for (const voucher of waiting) await deliverReceipt(voucher.id); // eslint-disable-line no-await-in-loop
    return waiting.length;
  }

  const idle = () => Promise.all([...inflight.values()]);
  const manualKey = (voucherId) => `mail:${voucherId}:${crypto.randomUUID()}`;

  return {
    linkOf, deliver, deliverReceipt, retryPending, idle, manualKey,
  };
}

module.exports = { createReceipt, SYSTEM };
