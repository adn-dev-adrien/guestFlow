import { ADMIN, ACCOUNTANT, ROLES, ROLE_LABELS, userHasRole, roleLabel } from '../roles';

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
