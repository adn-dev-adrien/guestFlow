- **Aucun email client ne part sans votre validation.** Deux mécanismes pouvaient écrire à un client
  sans que personne ne l'ait relu : le passage quotidien de 08:00, qui envoyait tout modèle réglé sur
  « Automatique », et la confirmation de réservation, expédiée dès qu'un paiement en ligne était
  confirmé. Un réglage — *Réglages → Envoi automatique des emails* — décide désormais si GuestFlow a
  le droit de le faire, et il est **désactivé** par défaut. Tant qu'il l'est, ces emails ne sont plus
  envoyés : ils sont **proposés** dans « Emails à envoyer », où vous les relisez et les envoyez d'un
  clic. Rien n'est perdu au passage — un modèle « Automatique » arrivé à échéance rejoint la file au
  lieu de disparaître, et la confirmation d'un paiement vous y attend. La page Emails le dit
  clairement : un bandeau explique la situation et les modèles concernés portent la mention « Auto
  désactivé » au lieu de « Auto ». Vos propres notifications de réservation et les emails de compte
  (mot de passe oublié) ne sont pas concernés : ils gardent leur fonctionnement et leur réglage
  dédié. (spec `no-automatic-email-without-approval.md`, +35 tests serveur, +16 tests client.)
