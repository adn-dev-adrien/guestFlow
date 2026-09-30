/**
 * The email templates of the renewal and their mode (specs/control-plane-plans-and-access.md rule
 * 33). The preview is the server's own rendering on a sample customer, so what the operator reads
 * while typing is what the customer would receive.
 */

const { KINDS, PLACEHOLDERS, templateError, render } = require('../utils/templates');
const { httpError } = require('../utils/httpError');

const SAMPLE = {
  contactName: 'Claire',
  companyName: 'Domaine Ombre',
  planName: 'Pro',
  period: '07/10/2026 → 07/11/2026',
  amount: '70,80 €',
  deadline: '07/10/2026',
  invoiceNumber: 'F-2026-0051',
  invoiceUrl: 'https://…/facture',
  payUrl: 'https://…/lien-de-paiement',
  spaceUrl: 'https://domaine-ombre.guestflow.fr',
};

// « Relancer maintenant » has no mode: the click is the approval.
const CLICK_ONLY = 'reminder_manual';

function createTemplatesController(ctx) {
  const { models, now } = ctx;
  const { emails } = models;

  const card = (t) => ({
    key: t.key,
    name: KINDS[t.key].name,
    day: KINDS[t.key].day,
    subject: t.subject,
    body: t.body,
    sendMode: t.key === CLICK_ONLY ? null : t.sendMode,
    modeLabel: t.key === CLICK_ONLY ? 'Le clic vaut validation' : (t.sendMode === 'auto' ? 'Automatique' : 'Manuel'),
  });

  function list() {
    const byKey = new Map(emails.templates().map((t) => [t.key, t]));
    return {
      templates: Object.keys(KINDS).filter((k) => byKey.has(k)).map((k) => card(byKey.get(k))),
      placeholders: PLACEHOLDERS,
    };
  }

  function preview(key, body) {
    if (!KINDS[key]) throw httpError(404, 'NOT_FOUND', 'Modèle inconnu.');
    const error = templateError(body.subject, body.body);
    return {
      error: error ? error.message : null,
      subject: render(body.subject || '', SAMPLE),
      body: render(body.body || '', SAMPLE),
    };
  }

  function save(key, body, operator) {
    const current = emails.template(key);
    if (!current || !KINDS[key]) throw httpError(404, 'NOT_FOUND', 'Modèle inconnu.');
    const subject = body.subject === undefined ? current.subject : String(body.subject);
    const text = body.body === undefined ? current.body : String(body.body);
    const error = templateError(subject, text);
    if (error) throw httpError(400, error.code, error.message);
    let sendMode = current.sendMode;
    if (body.sendMode !== undefined && key !== CLICK_ONLY) {
      if (!['manual', 'auto'].includes(body.sendMode)) throw httpError(400, 'INVALID', 'Mode : Manuel ou Automatique.');
      sendMode = body.sendMode;
    }
    emails.saveTemplate({ key, subject, body: text, sendMode, at: now().toISOString(), operator });
    return { template: card(emails.template(key)), notice: `Modèle « ${KINDS[key].name} » enregistré${sendMode !== current.sendMode ? ` : ${sendMode === 'auto' ? 'il partira seul' : 'il attendra votre validation'}` : ''}.` };
  }

  return { list, preview, save };
}

module.exports = { createTemplatesController };
