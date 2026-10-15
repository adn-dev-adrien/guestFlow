// Shared fixtures of the IntakeBanner suites — the block GET /api/gdf-intake/reservation/:id returns.
export const BASE = {
  id: 1,
  receivedAt: '2026-10-14T16:32:00.000Z',
  receivedLabel: '14/10 à 18:32',
  dossierNumber: '11773',
  netRent: 454,
  rentCandidates: [{ rent: 504, commission: 50 }, { rent: 505, commission: 51 }],
  customLines: [],
  iteaUrl: 'https://prop.itea.fr/v5/liste_resas.php?goto=2026_11773_centrale_309700',
  error: null,
};
