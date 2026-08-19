- **Échéancier de paiement et annulation pour impayé** (spec `payment-schedule-and-cancellation.md`,
  2026-08-19). Les réservations directes suivent désormais un échéancier unique : **l'acompte est dû à
  la réservation** (date de réservation + 7 jours, réglable par logement — il remplace l'ancien « jours
  avant l'arrivée » et ne bouge plus jamais une fois posé) et **le solde 30 jours avant l'arrivée**
  (7 auparavant), sans jamais tomber avant le jour de la réservation : un séjour réservé tardivement
  est intégralement exigible tout de suite. GuestFlow relance seul — demande d'acompte envoyée avec la
  réservation, relance à l'échéance de l'acompte, demande de solde à J-30 pour **toutes** les
  réservations directes (et plus seulement celles payées en ligne), relance du solde à J+3 annonçant
  la date d'annulation. Une carte **« Échéances de paiement »** sur le tableau de bord liste tout
  retard (acompte en retard / solde en retard / annulation possible / arrivée non réglée) avec
  « Relancer », « Reporter » (7 jours, sans déplacer l'échéance) et, 7 jours après l'échéance du solde,
  **« Annuler le séjour »** — jamais automatique, toujours d'un clic de l'opérateur. L'annulation
  libère les dates (calendrier, planning, ménage, linge, export iCal, Google Agenda), conserve
  l'acompte encaissé et le **requalifie en indemnité hors TVA** au mois de l'annulation : un avoir
  annule le CA hébergement + sa TVA, une fiche d'indemnité « Acompte conservé » le recrédite en
  `75880000`. Le mois d'origine de l'acompte, lui, ne bouge pas — rien n'est réécrit chez le comptable.
  Mail d'avis d'annulation au client en option. +54 tests serveur, +9 tests client.
