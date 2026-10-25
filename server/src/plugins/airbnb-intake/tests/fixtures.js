// The plain-text part of a real « Réservation confirmée » mail (réservation 202610003, raw .eml saved on
// 2026-10-25), with a fictitious guest, code, listing and thread (public repository) and the tracking
// parameters dropped. The non-breaking (U+00A0) and narrow non-breaking (U+202F) spaces are the mail's own.

const NB = ' ';
const NNB = ' ';

const SUBJECT = 'Réservation confirmée : Camille Martin arrive le 26 déc.';
const SENT_AT = '2026-10-24T16:44:00.000Z';

function bookingMail({
  guestColumn = [`288,65${NB}€ x 4${NB}nuits   1${NNB}154,60${NB}€`, `Frais de service voyageur   0,00${NB}€`, `Taxes   81,66${NB}€`],
  total = `1${NNB}236,26${NB}€`,
  hostColumn = [`Taxes   52,80${NB}€`, `Frais de chambre pour 4${NB}nuits   1${NNB}598,00${NB}€`, `Ajustement du tarif par nuit   -443,40${NB}€`, `Frais de service hôte (15,5${NB}%)   -178,96${NB}€`],
  payout = `1${NNB}028,44${NB}€`,
  dates = ['sam. 26 déc.', 'mer. 30 déc.'],
  party = `5${NB}adultes, 6${NB}enfants, 2 bébés`,
} = {}) {
  return [
    '%opentrack%',
    '',
    'NOUVELLE RÉSERVATION CONFIRMÉE ! CAMILLE ARRIVERA LE 26 DÉC.',
    '',
    'Envoyez un message pour confirmer les détails de l\'entrée',
    'dans les lieux ou pour souhaiter la bienvenue à Camille.',
    '',
    'https://www.airbnb.fr/hosting/reservations/details/HMTEST1234?isPending=true   Camille Martin',
    '',
    '[https://www.airbnb.fr/hosting/reservations/details/HMTEST1234?isPending=true]',
    '',
    'Identité vérifiée · 1 commentaire',
    '',
    'Sur Airbnb depuis 2024',
    '',
    'Bonjour,',
    'Nous souhaitons passer Noël en famille dans votre beau gite',
    '!',
    'Il y aura 5 adultes, 6 enfants et deux bébés.',
    'Bien cordialement,',
    '',
    'Envoyer un message à CamilleEnvoyer un message à Camille',
    '[https://www.airbnb.fr/hosting/thread/1111111111?thread_type=home_booking]',
    '',
    'https://www.airbnb.fr/rooms/1234567890123456789?c=x',
    '',
    'GÎTE 3* 10 PERS., VUE, BAIN NORDIQUE, ÂNE, CHÈVRE',
    '',
    'Logement entier',
    '',
    'Arrivée        Départ',
    '               ',
    `${dates[0]}   ${dates[1]}`,
    '               ',
    '16:00          10:00',
    '',
    'VOYAGEURS',
    '',
    party,
    '',
    'PLUS D\'INFORMATIONS CONCERNANT LES VOYAGEURS',
    '',
    'CODE DE CONFIRMATION',
    'HMTEST1234',
    '',
    'LE VOYAGEUR A PAYÉ',
    '',
    ...guestColumn.flatMap((l) => [l, '']),
    `TOTAL (EUR)   ${total}`,
    '',
    'VERSEMENT DE L\'HÔTE',
    '',
    ...hostColumn.flatMap((l) => [l, '']),
    `VOUS GAGNEZ   ${payout}`,
    '',
    'CONDITIONS D\'ANNULATION',
  ].join('\n');
}

// The figures of réservation 202609003 (2 nights, cleaning fee), read on Airbnb's « Revenus » panel.
const WITH_CLEANING = {
  guestColumn: [`362,50${NB}€ x 2${NB}nuits   725,00${NB}€`, `Frais de ménage   80,00${NB}€`, `Frais de service voyageur   0,00${NB}€`, `Taxes   63,87${NB}€`],
  total: `868,87${NB}€`,
  hostColumn: [`Taxes   24,00${NB}€`, `Frais de chambre pour 2${NB}nuits   725,00${NB}€`, `Frais de ménage   80,00${NB}€`, `Frais de service hôte (15,5${NB}%)   -124,78${NB}€`],
  payout: `704,22${NB}€`,
  dates: ['ven. 9 oct.', 'dim. 11 oct.'],
  party: `10${NB}adultes`,
};

module.exports = { SUBJECT, SENT_AT, bookingMail, WITH_CLEANING, NB, NNB };
