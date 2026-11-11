// The Booking extranet reservation page for 6300000001 (Granja, 6-8 Nov 2026, 10 adults), as
// `document.body.innerText` renders it on 2026-10-15, with a fictitious guest (the repository is public).
// Only the part from « Détails de la réservation » on: the extranet menu above it is of no interest.
const PAGE_6300000001 = `Revenir à la synthèse des réservations
Détails de la réservation

Date d'arrivée

ven. 6 nov. 2026

Date de départ

dim. 8 nov. 2026

Durée de séjour :

2 nuits

Nombre de personnes :

10 adultes

Nombre d'hébergements

1

Montant total

€ 721,82

Nom du client :

Camille Sierra
 fr
csierra.123456@guest.booking.com

Contactez vos clients ! Indiquez-leur l'heure à laquelle vous souhaitez les accueillir ou l'endroit où ils récupéreront leurs clés. Un simple appel suffit : 
+33 6 12 34 56 78
Vous pouvez également leur envoyer un e-mail ou un message.

Langue préférée

français

Canal :

Booking.com

Code IATA/TIDS :

PC029090

Numéro de réservation :

6300000001

Montant soumis à commission :

€ 701,80

Reçue

jeu. 15 oct. 2026

Commission et frais :

€ 115,38 

Paiement du client

Le paiement est facilité par l’intermédiaire des Paiements par Booking.com. Pour en savoir plus, consultez cette Page d’aide (comptabilité).

Bloc-notes (usage interne)

Ajoutez une note ici

Informations importantes sur ce client

Est ce possible d’avoir 2 lits d’appoints (nous ne sommes pas certains d’en avoir besoin)

Heure d'arrivée approximative :

Entre 20:00 et 21:00

Informations de paiement
Virement bancaire
Pas encore effectué

Booking.com débitera € 721,82 sur le compte du client. Nous vous ferons un virement bancaire pour cette réservation d'ici le 12 novembre 2026. En fonction des délais de traitement de votre banque, les fonds peuvent mettre jusqu'à 10 jours à apparaître sur votre compte. Le versement est soumis à vos conditions d'annulation.

Maison 4 Chambres (Domaine Solio - gite confort, nature, animaux)
€ 721,82

 ven. 6 nov. 2026  dim. 8 nov. 2026

Nom du client

Camille Sierra

Occupation réservée

10 adultes

Occupation maximum

10 adultes, 9 enfants (10 personnes max.)

Photo de l'hébergement

Date	Tarif	Tarif par nuit
06 - 07 novembre	
Peu flexible
	€ 350,90
07 - 08 novembre	
Peu flexible
	€ 350,90
Sous-total	€ 701,80
Taxe de séjour	4.4 %	€ 20,02
Tarif total de l'hébergement	€ 721,82
Le tarif comprend	10 % de TVA
Demandes des clients 1

Demande relative à l'arrivée: Le client a demandé s'il pouvait arriver entre 20:00 - 21:00.
Confirmé sans supplément
Demande de lit d'appoint: Le client a demandé un lit d'appoint pour un bébé de adult an.
Répondre
Conversation avec le client

Aujourd'hui
Est ce possible d’avoir 2 lits d’appoints (nous ne sommes pas certains d’en avoir besoin)
Aucune réponse requise
Répondre
11h19
Je voudrais un lit d'appoint dans mon hébergement (Maison 4 Chambres) pour un bébé de adult an et pour toute la durée de mon séjour. C'est possible ?
Répondre
11h19
J'aimerais m'enregistrer à 20:00 - 21:00. C'est possible ?
11h19
Demande acceptée
Envoyé
11h19
Protégez la sécurité de votre compte

Ne partagez pas d'informations sensibles par message ou par e-mail. Si vous recevez des messages ou des liens qui vous semblent suspects, veuillez nous les signaler en contactant l'Assistance Partenaires.

En savoir plus
Signaler un problème
Photos
Modèles
Aidez-moi à répondre
Envoyer

Booking.com reçoit tous les messages écrits ici et les traite selon sa Charte de confidentialité et informations sur les cookies`;

// What the extranet really does to the text: a narrow no-break space before every « : », zero-width
// spaces between the children's ages, a no-break space inside amounts.
const withBookingWhitespace = (text) => text
  .replace(/ :$/gm, '\u202f:')
  .replace(/, /g, ',\u200b ')
  .replace(/€ /g, '€\u00a0');

const replaceOnce = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`fixture does not contain: ${from}`);
  return text.replace(from, to);
};

module.exports = { PAGE_6300000001, withBookingWhitespace, replaceOnce };
