- Dépendances : lot de mises à jour mineures et correctives sur les trois paquets — MUI 9.0.1 → 9.3.1
  (`material`, `icons-material`, `x-date-pickers` 9.4 → 9.11), React 19.2.7 → 19.2.8, Recharts
  3.8 → 3.10, les polices Fontsource, `@testing-library/user-event`, côté serveur `helmet`,
  `express-rate-limit` et `pdfkit` 0.18 → 0.19, et `@playwright/test` 1.60 → 1.62 à la racine.
  Aucun changement fonctionnel : les trois suites passent inchangées. Les deux montées visibles par
  l'utilisateur ont été contrôlées à l'œil, parce que les tests ne les rendent pas — un devis PDF
  généré et relu page à page (bandeau, tableau tarifaire avec ligne « offerte » barrée, coordonnées
  bancaires, modalités de règlement) et quatre écrans denses de l'application, sans erreur console.
