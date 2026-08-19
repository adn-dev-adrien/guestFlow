- **Indemnité d'annulation versée par la plateforme** (spec `cancellation-compensation.md`, 2026-08-19).
  Valider une annulation iCal demande désormais si la plateforme doit une indemnité pour le séjour
  annulé : la réservation est supprimée comme avant, mais un instantané (logement, plateforme, client,
  dates, prix du séjour perdu) est figé dans la même transaction. L'indemnité reste **modifiable tant
  qu'elle n'est pas versée**, est rappelée sur le tableau de bord (badge « En retard » passé la date
  prévue), puis s'encaisse à sa date réelle — moment où elle produit une écriture équilibrée (débit
  compte client / crédit `75880000`, hors TVA par défaut) dans le journal **et** le CSV du mois du
  versement. Nouvelle section « Indemnités d'annulation » sur la page Comptabilité (lecture seule pour
  le rôle comptable), compte paramétrable dans le Plan comptable, taux de TVA dans Réglages → Général.
  +48 tests serveur, +11 tests client.
