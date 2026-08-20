- **Aucun email de paiement n'est envoyé automatiquement** (spec `payment-schedule-and-cancellation.md`
  §1 amendement du 2026-08-20). Les quatre emails d'argent — demande d'acompte, relance acompte,
  demande de solde, relance solde — sont désormais *proposés* par GuestFlow et *envoyés* par
  l'opérateur. La demande d'acompte ne part plus toute seule à la création d'une réservation et la
  passe quotidienne de demande de solde est supprimée ; les deux relances passent en mode manuel et
  attendent dans la file d'emails, où leur corps rendu peut être relu avant l'envoi. Les emails de
  séjour (rappels d'arrivée, SAS, petit-déjeuner) gardent leur envoi automatique : la règle porte sur
  l'argent, pas sur l'email. L'annulation d'un séjour restait déjà, et reste, une confirmation
  manuelle. Un test verrouille la règle : aucun modèle qui réclame de l'argent ne peut être livré en
  mode automatique.
- **Carte « Échéances de paiement » — deux nouveaux états.** Puisque plus rien ne réclame à la place
  de l'opérateur, la carte devient la liste des choses à faire : « Acompte à demander » apparaît dès
  la création d'une réservation directe, « Solde à demander » le jour de l'échéance du solde. Le
  bouton s'appelle « Envoyer la demande » tant que le client n'a jamais été sollicité, « Relancer »
  ensuite, et le titre de la carte compte les deux catégories séparément. Un séjour n'est plus jamais
  proposé à l'annulation pour un solde qui n'a jamais été réclamé.
