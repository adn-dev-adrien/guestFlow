// specs/stay-profile.md §3 rule 17 — « Profil des séjours » sits right after « Vue générale » in the
// « Suivi financier » menu, admin only, like the dashboard.
import { financeMenu } from '../financeMenu';
import { ROUTE_ROLES } from '../roles';
import { STAY_PROFILE_PATH } from '../stayProfile';

test('rule 17 — the menu entry follows « Vue générale », its route is the dashboard\'s roles', () => {
  const labels = financeMenu([]).map((e) => e.label);
  expect(labels.slice(0, 2)).toEqual(['Vue générale', 'Profil des séjours']);
  expect(financeMenu([]).find((e) => e.key === 'stay-profile').path).toBe(STAY_PROFILE_PATH);
  expect(STAY_PROFILE_PATH).toBe('/finance/profil');
  expect(ROUTE_ROLES[STAY_PROFILE_PATH]).toEqual(ROUTE_ROLES['/finance']);
});
