- **Onglets unifiés dans toute l'application** (spec `ds-tabs.md`, 2026-09-23). Un composant
  `PageTabs` unique remplace les quatre rendus qui coexistaient : les onglets de page vivent
  désormais dans la barre collante (centrés sur écran large, deuxième ligne du même bloc sur
  mobile), les onglets de carte partagent la même typographie et le même rythme. Libellés en casse
  normale, cible tactile 44 px, indicateur vert sapin. Touche la fiche logement, Options &
  ressources, Vacances & fermetures, Clients, l'historique des emails, le suivi financier, les CGV
  et le dialogue d'archive. +7 tests client, +2 tests E2E.
- **Suite E2E : le port du client est réglable** (`E2E_CLIENT_PORT`, défaut 3000). Le serveur de
  test refuse désormais de démarrer sur un port déjà occupé (`--strictPort`) au lieu de jouer la
  suite contre l'application d'un voisin.
