- CI : les workflows épinglent **Node 24.18.0** au lieu de la majeure flottante `24`. Le 2026-08-06,
  la sortie du patch 24.19.0 a rendu `master` rouge — 214 fichiers de tests serveur signalés en
  échec alors que toutes les assertions passaient : les processus crashaient **à la fermeture**, dans
  le code natif de better-sqlite3 (`RemoveEnvironmentCleanupHook … Assertion failed: (env) != nullptr`
  depuis `Statement::~Statement()`). Le même code était vert quelques heures plus tôt sur 24.18.0.
  Correctif d'attente : la vraie sortie est la montée de `better-sqlite3` (encore en `^11` alors que
  la 13.x est publiée) — voir `specs/better-sqlite3-upgrade.md`.
