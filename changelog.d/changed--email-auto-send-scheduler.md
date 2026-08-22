- **Rien ne tourne en arrière-plan pour l'envoi automatique tant qu'il n'est pas activé**
  (specs/no-automatic-email-without-approval.md §3 rule 2b). L'interrupteur des Réglages est livré
  sur « désactivé », mais la passe quotidienne de 08:00 restait planifiée : chaque minute de 08:00 à
  minuit, elle s'ouvrait, relisait le réglage et repartait sans rien faire — près de 960 passes à
  vide par jour. Le minuteur n'est désormais enregistré que pendant que l'envoi automatique est
  autorisé. Activer l'interrupteur le démarre **et** lance la passe du jour immédiatement, sans
  redémarrer l'application ; le désactiver l'arrête aussitôt. Le garde-fou qui refusait d'envoyer
  reste en place à l'intérieur de la passe. +5 tests serveur (net).
