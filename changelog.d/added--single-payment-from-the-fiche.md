- **Encaisser le séjour et le complément en une fois depuis la fiche** (spec
  `single-payment-from-the-fiche.md`, 2026-08-31). La 2.9.0 sait enregistrer un paiement unique, mais
  seulement dans le SAS, au moment du check-in. Quand le client a payé à la porte et que rien n'a été
  saisi sur le coup, il fallait **rouvrir tout l'assistant** — onze pages, des questions dont une
  mauvaise réponse *retire* une vente, et la perte des coches « préparé » du planning. La fiche porte
  désormais le geste : dès que le séjour **et** le complément restent à percevoir, un bloc
  « Encaisser en une fois » annonce le total et ce qu'il couvre, avec **la date d'encaissement au
  choix** — un client qui a payé avant-hier est enregistré avant-hier, et l'écriture part dans le mois
  de cette date. Un bouton **CB / Chèque**, un bouton **Caisse interne**, et « Annuler ce paiement »
  pour revenir en arrière. Rien d'autre n'est touché : aucune page du SAS ne tourne, donc les
  prestations vendues, la composition du petit déjeuner et les cartes du planning restent
  exactement en l'état. Une date dans le futur, ou antérieure à la réservation, est refusée avec sa
  raison. +20 tests serveur, +7 tests client.
