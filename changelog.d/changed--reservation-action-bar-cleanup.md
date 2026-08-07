- Fiche de réservation : le bouton **« Nouvelle note »** est remonté dans la **barre d'actions
  collante**, en tête. Il n'existait que dans le bloc « Encaissements en séjour », situé à 81 % du
  défilement d'une fiche de 4500 px — introuvable pour ce qui est l'action la plus fréquente d'un
  séjour en cours. Le bloc et son historique restent en place ; les deux points d'entrée partagent la
  même règle d'affichage (`utils/midStayNoteAccess.js`, 9 tests) pour ne jamais diverger.
- Fiche de réservation : sur une réservation **plateforme**, les boutons **« Transformer en devis »**
  et **« Envoyer la demande de solde »** disparaissent. Le premier n'a pas de sens — le tarif vient de
  la plateforme, nous ne devisons pas ce séjour ; le second était dangereux — le solde est encaissé
  par la plateforme puis reversé, le réclamer au client aurait été une double demande de paiement.
  Les réservations directes ne changent pas.
