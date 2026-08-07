- `better-sqlite3` passe de **11 à 13.0.3** (serveur + racine), et les trois workflows repassent sur
  la majeure flottante `node-version: '24'` — l'épinglage `24.18.0` de la veille n'était qu'un
  garrot, qui gelait aussi les correctifs de sécurité de Node. C'est ce retard de deux majeures sur
  le driver qui avait fait crasher tous les processus de tests à leur fermeture dès la sortie de Node
  24.19.0. Aucun changement applicatif : les API utilisées (`prepare`, `transaction`, `exec`,
  `pragma`, bases `:memory:`) sont identiques, aucun test modifié. Vérifié sur base neuve, sur copie
  de la base réelle (`integrity_check: ok`) et **sur le Pi lui-même** (Node v24.15.0/aarch64, la
  commande de déploiement compile et le module tourne). Voir `specs/better-sqlite3-upgrade.md`.
