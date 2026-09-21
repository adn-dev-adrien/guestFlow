/**
 * Automatic-send policy — the single place that answers « may GuestFlow mail a guest with nobody in
 * the loop? » (specs/no-automatic-email-without-approval.md §3 rule 1).
 *
 * Since specs/settings-rationalization.md rule 17b there is no master switch any more: each template
 * decides with its own mode. A template sends by itself only when it is enabled AND in « auto »
 * mode; everything else is proposed in « Emails à envoyer » and leaves on the operator's click.
 *
 * Callers, none of which re-reads a template's mode themselves:
 *   - `utils/emailAutoSendScheduler` — schedules the daily 08:00 pass only while one template is auto;
 *   - `utils/emailAutoSendRunner` / `utils/guestEmailSequenceRunner` — send the auto templates only;
 *   - `utils/reservationEmailSender` — the confirmation fired by a confirmed online payment.
 *
 * Operator-triggered sends (the « Envoyer » button, a payment request, a cancellation notice) never
 * consult this module: an explicit click IS the approval.
 *
 * Fails closed on purpose. A missing template, a partially-migrated row, a read that throws — all
 * resolve to `false`. The safe default is « ask me », never « mail the guest ».
 */

function templateAutoSends(template) {
  try {
    if (!template) return false;
    const enabled = template.enabled === true || Number(template.enabled) === 1;
    return enabled && String(template.sendMode) === 'auto';
  } catch {
    return false;
  }
}

/** True when the template stored under `stableKey` sends by itself. */
function stableKeyAutoSends(templatesModel, stableKey) {
  try {
    return templateAutoSends(templatesModel.findByStableKey(stableKey));
  } catch {
    return false;
  }
}

/** True when at least one enabled template is in « auto » mode — the daily pass has work to do. */
function anyTemplateAutoSends(templatesModel) {
  try {
    return templatesModel.listEnabled().some(templateAutoSends);
  } catch {
    return false;
  }
}

module.exports = { templateAutoSends, stableKeyAutoSends, anyTemplateAutoSends };
