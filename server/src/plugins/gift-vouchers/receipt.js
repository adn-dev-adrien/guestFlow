/**
 * The e-mail of a voucher (specs/gift-vouchers.md rule 23). One delivery path for the operator's « Renvoyer » and for the
 * receipt sent on its own when a voucher sold on the site is issued: the template, the voucher link, the `mail` movement
 * and the « Mail non parti » flag (`mailError`) are the same. A voucher sold on the site is mailed automatically — the
 * receipt of a payment the buyer just made (specs/no-automatic-email-without-approval.md); a failed send is retried by a job.
 */

const crypto = require('crypto');
const { renderMail } = require('./mailTemplate');

const RETRY_FOR_MS = 3 * 24 * 60 * 60 * 1000;
const SETTLE_MS = 60 * 1000;
const SYSTEM = 'system';

const refused = (code) => Object.assign(new Error(code), { code });

function createReceipt({
  vouchers, orders, movements, transaction, sendMail, settingsGet, pageUrl, now = () => new Date(),
}) {
  const inflight = new Map();

  /** The page that shows the voucher, for the buyer: `?gf_voucher=<order>&gf_token=<token>`. Null when it cannot be built. */
  function linkOf(voucher) {
    const base = pageUrl();
    const token = orders.tokenOf(voucher.orderId);
    if (!base || !token) return null;
    return `${base.replace(/#.*$/, '')}${base.includes('?') ? '&' : '?'}gf_voucher=${voucher.orderId}&gf_token=${token}`;
  }

  /**
   * Sends the mail of `voucher` and records it. Throws a refusal whose `code` is `NO_EMAIL`, `NO_PAGE_URL` or `MAIL_FAILED`
   * (the last one after flagging the voucher).
   */
  async function deliver(voucher, { actor, idempotencyKey }) {
    if (!voucher.email) throw refused('NO_EMAIL');
    const link = linkOf(voucher);
    if (!link) throw refused('NO_PAGE_URL');
    const mail = renderMail({ voucher, link, language: voucher.language }, settingsGet);
    try {
      await sendMail({ to: voucher.email, ...mail, key: `gift-voucher:${voucher.id}` });
    } catch (error) {
      vouchers.setMail(voucher.id, { error: String(error && error.message ? error.message : error).slice(0, 200) });
      throw refused('MAIL_FAILED');
    }
    transaction(() => {
      vouchers.setMail(voucher.id, { sentAt: now().toISOString() });
      movements.append({
        voucherId: voucher.id, kind: 'mail', actor, idempotencyKey,
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
        if (error.code === 'NO_EMAIL' || error.code === 'NO_PAGE_URL') vouchers.setMail(voucher.id, { error: error.code });
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
