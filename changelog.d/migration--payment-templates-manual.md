- **Modèles d'email `deposit_reminder` et `balance_reminder` basculés en envoi manuel**
  (`payment_templates_manual_v1`). Les modèles n'étant semés qu'une fois, une base existante conserve
  le mode avec lequel ils sont nés : sans cette migration les deux relances auraient continué de
  partir seules à 8 h après le déploiement. Seul `sendMode` est touché — le texte, l'ancre, le décalage
  et l'activation restent ceux de l'opérateur, et une relance désactivée le reste.
