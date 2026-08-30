- **Un seul encaissement quand le client règle tout à l'arrivée** (spec
  `single-payment-at-check-in.md`, 2026-08-30). Depuis la 2.8.0 le SAS d'arrivée peut percevoir deux
  choses — le séjour et le complément d'arrivée — et il les réglait séparément : deux boutons dans le
  récapitulatif, deux « payé » sur la fiche, **deux écritures en comptabilité** pour une seule ligne
  sur le relevé bancaire. Or à la porte, un client de dernière minute qui prend un repas pendant le
  check-in tend **une carte, une fois**. Quand les deux côtés sont à percevoir, le récapitulatif ne
  pose donc plus qu'une question : « Total à percevoir à l'arrivée », puis **CB / Chèque**, **Payé en
  liquide** ou **Plus tard**. La fiche affiche « Encaissé à l'arrivée : paiement unique de 802,00 € »
  au-dessus des postes, et la Comptabilité regroupe les écritures sous une carte « Encaissé le … ».
  Le complément vendu **pendant** le check-in est compté, c'est le cas visé. La ventilation comptable
  est inchangée — hébergement et prestations complémentaires gardent leurs comptes et leurs taux de
  TVA — et « Régler séparément » reste à un tap pour encaisser un côté et reporter l'autre.
  +24 tests serveur, +11 tests client.
