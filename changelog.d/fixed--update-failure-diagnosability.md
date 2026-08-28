- **Une mise à jour qui échoue dit enfin pourquoi.** Une installation morte pendant la préparation
  affichait « Command failed » et renvoyait vers un journal qui n'avait jamais été créé — il fallait
  lire les journaux du noyau pour comprendre. Trois corrections : le message d'erreur complet est
  conservé au lieu d'être tronqué au premier deux-points, le journal de mise à jour est écrit dès le
  début de l'opération et non par l'étape finale qu'un échec précoce n'atteint jamais, et un
  **contrôle de mémoire disponible** rejoint celui de l'espace disque en pré-vol. Sous 512 Mo
  disponibles l'application refuse la mise à jour en le disant, au lieu de laisser le noyau tuer
  `npm ci` en silence — ce qui est arrivé trois fois de suite sur une VM de 648 Mo sans swap.
  +8 tests serveur.
