- **Échéancier de paiement** (spec `payment-schedule-and-cancellation.md`). Au démarrage :
  `properties.depositDueDays` (défaut 7) et `properties.cancelAfterBalanceDueDays` (défaut 7) sont
  ajoutées, `balanceDaysBefore` passe **une seule fois** à 30 pour les logements en dessous (migration
  `balance_days_before_30_v1`, une valeur choisie ensuite n'est plus écrasée), et `depositDaysBefore`
  est supprimée — plus aucun lecteur. `reservations` gagne `cancelledAt`, `cancellationReason`,
  `cancelledBy` et `paymentAlertSnoozedUntil` ; son `kind` accepte la valeur `cancelled`, qui retire la
  ligne de toutes les lectures opérationnelles tout en la laissant visible à la comptabilité.
  `cancellation_compensations` gagne `origin` (`platform` | `retained_deposit`). Le mail
  « Relance acompte », déjà installé, est recalé sur l'échéance d'acompte (migration
  `deposit_reminder_anchor_v1`) : sans cela il aurait cessé d'être programmé en silence. Aucune
  réservation existante ne voit ses dates d'échéance recalculées.
