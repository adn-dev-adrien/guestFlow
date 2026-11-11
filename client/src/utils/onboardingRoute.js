/**
 * Where `/demarrage` leads (specs/plugins-phase-p-productisation.md rules 20, 22, 45).
 *
 *  - 'assistant' — an administrator while onboarding is open, or one who reopened it on purpose
 *    from Réglages › Système (router state `{ reopen: true }`);
 *  - 'home'      — `/demarrage` typed, bookmarked or reached with « Précédent » once it is done:
 *    the assistant does not start over at step 1 by accident;
 *  - null        — anything else: the app as usual.
 */
export const ONBOARDING_PATH = '/demarrage';

export function onboardingRoute({ isAdmin, onboardingOpen, pathname, state }) {
  const reopened = pathname === ONBOARDING_PATH && Boolean(state && state.reopen);
  if (isAdmin && (onboardingOpen || reopened)) return 'assistant';
  if (pathname === ONBOARDING_PATH) return 'home';
  return null;
}
