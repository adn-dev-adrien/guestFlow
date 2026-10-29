// specs/plugins-phase-1-sdk.md rule 28 — the client mirrors the server: an e-mail is one address.
import { describe, expect, it } from 'vitest';
import { isValidEmail } from '../validation';

describe('isValidEmail', () => {
  it('accepts one address and an empty field', () => {
    ['claire.dupont@example.org', 'a+b@sub.example.org', '', '  '].forEach((v) => expect(isValidEmail(v)).toBe(true));
  });

  it('refuses a list, an angle address, a quote or a missing domain', () => {
    ['a@x.test,b@evil.test', 'a@x.test;b@evil.test', 'Claire <a@x.test>', 'a"b@x.test', 'a@x'].forEach((v) => expect(isValidEmail(v)).toBe(false));
  });
});
