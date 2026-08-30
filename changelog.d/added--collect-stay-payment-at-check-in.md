- **Encaisser le séjour au check-in** (spec `collect-stay-payment-at-check-in.md`, 2026-08-30). Une
  réservation de dernière minute arrive non payée : le SAS d'arrivée affiche désormais une étape
  « Séjour à régler » (après la caution) avec le reste dû brut du séjour — acompte non payé + solde
  non payé — et les mêmes boutons que le complément : **CB / Chèque**, **Payé en liquide** (caisse
  interne) et **Pas maintenant**, pré-sélectionné. Le récapitulatif reprend le choix dans un bloc
  « Séjour » distinct du complément, avec un total à percevoir à l'arrivée. Sur une réservation
  plateforme, l'étape prévient que le solde est versé par la plateforme après le séjour. Le geste est
  annulable en ré-ouvrant le SAS, sans jamais toucher un acompte réglé par virement, et l'étape reste
  invisible pour le rôle réception. +33 tests serveur, +6 tests client.
