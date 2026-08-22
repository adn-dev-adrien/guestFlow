/**
 * Automatic-send policy — the single place that answers « may GuestFlow mail a guest with nobody in
 * the loop? » (specs/no-automatic-email-without-approval.md §3 rule 1).
 *
 * Four callers ask, and none of them re-reads the setting themselves:
 *   - `utils/emailAutoSendScheduler` — decides whether the daily 08:00 pass is scheduled at all;
 *   - `utils/emailAutoSendRunner`   — the pass itself, guarding again on the way in;
 *   - `utils/paymentEffectDeps`     — the confirmation email fired by a confirmed online payment;
 *   - `controllers/emailsController` + `controllers/emailTemplatesController` — which flip the
 *     pending queue and the templates list to their « proposed, not sent » shape.
 *
 * Operator-triggered sends (the « Envoyer » button, a payment request, a cancellation notice) never
 * consult this module: an explicit click IS the approval.
 *
 * Fails closed on purpose. A missing accessor, a partially-migrated database, a settings read that
 * throws — all resolve to `false`. The safe default is « ask me », never « mail the guest ».
 */

function autoSendAllowed(settingsModel) {
  if (!settingsModel) return false;
  try {
    if (typeof settingsModel.emailAutoSendEnabled === 'function') {
      return settingsModel.emailAutoSendEnabled() === true;
    }
    // Fallback for a model built before the accessor existed (test doubles, minimal schemas):
    // read the raw column, and treat anything but an explicit 1 as OFF.
    const row = typeof settingsModel.read === 'function' ? settingsModel.read() : null;
    return Number(row && row.emailAutoSendEnabled) === 1;
  } catch {
    return false;
  }
}

module.exports = { autoSendAllowed };
