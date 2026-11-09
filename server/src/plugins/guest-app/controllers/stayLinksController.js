/**
 * The stay link on the operator's side (specs/guest-app.md rules 1, 9bis): the SAS « Mon séjour » step and the
 * fiche read it (created the first time it is needed) and regenerate it; the SAS payload and the J-7 / J-1
 * e-mails ask for it through `available` and `emailUrl`.
 *
 * `GET /api/guest-app/reservations/:id/stay-link` · `POST …/stay-link/regenerate` — admin and reception (the
 * reception runs the SAS). The link exists only for a live reservation of a lodging in the app, once the
 * guest host is set: otherwise 409 with the reason, and the SAS keeps today's gate step.
 */

const QRCode = require('qrcode');
const sdk = require('../../sdk');
const { isLiveStay } = require('../currentStay');
const { timeLabel } = require('../homeHighlight');
const { stayLinkUrl } = require('../qrPoster');

const { computeWindow } = sdk.coreModule('stayWindow');

const DAY = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short',
});

/** « Le lien vaut jusqu’au lun. 9 nov., 12 h. » — the end of the stay window (rule 2). */
const validUntilLabel = (end) => `Le lien vaut jusqu’au ${DAY.format(end)}, ${timeLabel(end, 'fr')}.`;

function buildStayLinksController({
  stayLinks, stays, lodgings, guestHost, now,
}) {
  /** → { stay, host } or { status, error }: why this reservation has no link. */
  function eligibility(reservationId) {
    const stay = stays().byId(reservationId);
    if (!stay) return { status: 404, error: 'Réservation introuvable' };
    if (!isLiveStay(stay)) return { status: 409, error: 'Ce séjour n’est pas une réservation en cours : il n’a pas de lien Mon séjour.' };
    if (!lodgings().findEnabled(stay.propertyId)) return { status: 409, error: 'Ce logement n’est pas dans l’application clients.' };
    const host = guestHost();
    if (!host) return { status: 409, error: 'Renseignez d’abord l’adresse de l’application (Paramètres › Intégrations).' };
    return { stay, host };
  }

  async function view({ stay, host }, link) {
    const url = stayLinkUrl(host, link.token);
    const window = computeWindow(stay);
    return {
      url,
      qrDataUri: await QRCode.toDataURL(url, { margin: 1, width: 440, errorCorrectionLevel: 'M' }),
      createdAt: link.createdAt,
      ...(window ? { validUntil: window.end.toISOString(), validUntilLabel: validUntilLabel(window.end) } : {}),
    };
  }

  const reservationIdOf = (req) => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  const handle = (write) => async (req, res, next) => {
    const id = reservationIdOf(req);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
    const eligible = eligibility(id);
    if (eligible.error) return res.status(eligible.status).json({ error: eligible.error });
    try {
      const link = write ? stayLinks().regenerate(id, now()) : stayLinks().ensure(id, now());
      res.set('Cache-Control', 'no-store');
      return res.json(await view(eligible, link));
    } catch (error) {
      return next(error);
    }
  };

  /** Rule 9bis (a) — whether the SAS shows « Mon séjour » for this stay. Reads only: the SAS read never writes. */
  const available = (reservationId) => !eligibility(reservationId).error;

  /**
   * Rule 9bis (b) — the link the reminder e-mails carry, created on first need; '' when the stay has none or
   * no e-mail address to receive it (the e-mails then keep the gate link).
   */
  function emailUrl(reservationId) {
    const eligible = eligibility(reservationId);
    if (eligible.error || !stayLinks().clientHasEmail(reservationId)) return '';
    return stayLinkUrl(eligible.host, stayLinks().ensure(reservationId, now()).token);
  }

  return {
    available, emailUrl, read: handle(false), regenerate: handle(true),
  };
}

module.exports = { buildStayLinksController, validUntilLabel };
