// specs/plugins-phase-p-productisation.md rule 45 (audit 2026-10-27) — once onboarding is done,
// `/demarrage` reached by accident goes home; reopening it from Réglages › Système still works.
import { onboardingRoute } from '../onboardingRoute';

const admin = { isAdmin: true, onboardingOpen: false };

test('rule 20: an admin is sent to the assistant while onboarding is open, wherever the URL', () => {
  expect(onboardingRoute({ ...admin, onboardingOpen: true, pathname: '/', state: null })).toBe('assistant');
  expect(onboardingRoute({ ...admin, onboardingOpen: true, pathname: '/demarrage', state: null })).toBe('assistant');
});

test('rule 45: done, `/demarrage` typed or reached with « Précédent » goes home', () => {
  expect(onboardingRoute({ ...admin, pathname: '/demarrage', state: null })).toBe('home');
  expect(onboardingRoute({ isAdmin: false, onboardingOpen: false, pathname: '/demarrage', state: { reopen: true } })).toBe('home');
});

test('rule 22: reopened on purpose from Réglages › Système, the assistant opens', () => {
  expect(onboardingRoute({ ...admin, pathname: '/demarrage', state: { reopen: true } })).toBe('assistant');
});

test('any other page is the app as usual', () => {
  expect(onboardingRoute({ ...admin, pathname: '/reservations', state: { reopen: true } })).toBe(null);
});
