import {
  ADMIN, ACCOUNTANT, ROLES, ROLE_LABELS, userHasRole, roleLabel,
  ROUTE_ROLES, canSeeRoute, canSeeAnyRoute,
} from '../roles';

describe('roles constants', () => {
  test('exports the frozen taxonomy', () => {
    expect(ADMIN).toBe('admin');
    expect(ACCOUNTANT).toBe('accountant');
    expect([...ROLES]).toEqual(['admin', 'accountant']);
    expect(() => ROLES.push('hacker')).toThrow();
  });

  test('roleLabel returns the French label, or echoes back unknown roles', () => {
    expect(roleLabel(ADMIN)).toBe('Admin');
    expect(roleLabel(ACCOUNTANT)).toBe('Comptable');
    expect(roleLabel('unknown-role')).toBe('unknown-role');
    expect(ROLE_LABELS[ADMIN]).toBe('Admin');
  });
});

describe('userHasRole', () => {
  // The default contract: post-M2 sessions carry `roles: string[]`.
  test('matches on the post-M2 roles array', () => {
    expect(userHasRole({ roles: ['admin'] }, ADMIN)).toBe(true);
    expect(userHasRole({ roles: ['accountant'] }, ADMIN)).toBe(false);
    expect(userHasRole({ roles: ['admin', 'accountant'] }, ACCOUNTANT)).toBe(true);
  });

  // Back-compat shim for in-flight legacy sessions that still carry `role: string`. Mirrors the
  // server-side shim in server/src/constants/roles.js. Documented so it's not silently regressed
  // when we eventually drop legacy support.
  test('falls back to the legacy `role` string when no roles array is present', () => {
    expect(userHasRole({ role: 'admin' }, ADMIN)).toBe(true);
    expect(userHasRole({ role: 'accountant' }, ADMIN)).toBe(false);
    expect(userHasRole({ role: 'accountant' }, ACCOUNTANT)).toBe(true);
  });

  // The post-M2 array always wins — even when both shapes are present, we never read the legacy
  // field. Protects against a malformed session re-grafting an old role onto a fresh user.
  test('post-M2 array takes precedence over a legacy `role` string', () => {
    const both = { roles: ['accountant'], role: 'admin' };
    expect(userHasRole(both, ADMIN)).toBe(false);
    expect(userHasRole(both, ACCOUNTANT)).toBe(true);
  });

  test('returns false for null / undefined / empty payloads', () => {
    expect(userHasRole(null, ADMIN)).toBe(false);
    expect(userHasRole(undefined, ADMIN)).toBe(false);
    expect(userHasRole({}, ADMIN)).toBe(false);
    expect(userHasRole({ roles: [] }, ADMIN)).toBe(false);
    expect(userHasRole({ role: '' }, ADMIN)).toBe(false);
  });
});

describe('ROUTE_ROLES + canSeeRoute', () => {
  // Server `enforceRoleAccess` is the authoritative gate; ROUTE_ROLES is the UI projection. Each
  // accountant-visible route MUST also be in the server's accountant allowlist
  // (see server/src/middleware/enforceRoleAccess.js). The test below pins the accountant scope so
  // any drift is caught here before it ships.

  const admin = { roles: ['admin'] };
  const accountant = { roles: ['accountant'] };
  const both = { roles: ['admin', 'accountant'] };

  test('admin can see every registered route', () => {
    for (const path of Object.keys(ROUTE_ROLES)) {
      expect(canSeeRoute(admin, path)).toBe(true);
    }
  });

  test('accountant sees ONLY /comptabilite and /account', () => {
    const visible = Object.keys(ROUTE_ROLES).filter((p) => canSeeRoute(accountant, p));
    expect(visible.sort()).toEqual(['/account', '/comptabilite']);
  });

  test('multi-role admin+accountant: admin scope (everything) wins', () => {
    for (const path of Object.keys(ROUTE_ROLES)) {
      expect(canSeeRoute(both, path)).toBe(true);
    }
  });

  test('unknown route → false (deny by default)', () => {
    expect(canSeeRoute(admin, '/no-such-route')).toBe(false);
    expect(canSeeRoute(accountant, '/no-such-route')).toBe(false);
  });

  test('null user → false', () => {
    expect(canSeeRoute(null, '/account')).toBe(false);
  });
});

describe('canSeeAnyRoute', () => {
  const admin = { roles: ['admin'] };
  const accountant = { roles: ['accountant'] };

  test('returns true when at least one path is visible', () => {
    // Settings group: accountant can reach /account but not /properties, /options, etc.
    expect(canSeeAnyRoute(accountant, ['/settings', '/options', '/account'])).toBe(true);
  });

  test('returns false when no path is visible', () => {
    // Calendar group: accountant has no visible child → parent hides.
    expect(canSeeAnyRoute(accountant, ['/calendar', '/resource-planning'])).toBe(false);
  });

  test('admin sees the full group', () => {
    expect(canSeeAnyRoute(admin, ['/calendar', '/resource-planning'])).toBe(true);
  });
});
