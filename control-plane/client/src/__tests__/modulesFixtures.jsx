// A « Modules » payload as the server sends it (ModulesSection suites).
export const line = (over = {}) => ({
  id: 'linen', name: 'Linge et blanchisserie', on: true, switchable: true, state: 'active', stateLabel: 'Actif · 1.2.0', detail: null,
  canRetry: false, needsSetup: false, setupLabel: null, stale: false, canErase: false, eraseLines: [], eraseWarnings: [], planChip: null, ...over,
});

export const modulesView = (over = {}) => {
  const view = {
    seeded: true,
    seedLabel: null,
    header: '2 actifs',
    counts: { active: 2, toConfigure: 0, failed: 0, blocked: 0 },
    empty: null,
    included: [
      line(),
      line({ id: 'sas', name: 'Arrivée et départ guidés', stateLabel: 'Actif · 1.0.3' }),
      line({ id: 'school-holidays', name: 'Vacances scolaires', on: false, state: 'inactive', stateLabel: 'Inactif' }),
    ],
    outOfPlan: [
      line({ id: 'neat', name: 'Assurance annulation Neat', on: false, switchable: false, state: 'outOfPlan', stateLabel: null, planChip: 'Forfait Premium' }),
    ],
    ...over,
  };
  return { headerParts: [{ text: view.header, tone: null }], ...view };
};
