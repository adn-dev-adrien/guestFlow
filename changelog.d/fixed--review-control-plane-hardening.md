- **Console security hardening** (security review of `inte/plugins`, `specs/control-plane-plans-and-access.md`
  rules 27, 31, 39; `specs/hosting-h2-account-security.md` rule 36):
  - a stolen operator cookie can no longer guess the password through « changer de méthode »: a wrong
    password there counts toward the five-failure lock, the lock ends the session, and `/mfa/start` /
    `/mfa/confirm` share the login's per-IP limit;
  - the TOTP code that confirmed the authenticator app is spent and cannot open a session; a typed
    password opens the second step for 10 minutes only; the login page's `/go` is rate-limited;
  - the console refuses to start outside `NODE_ENV=development`/`test` without `CP_SESSION_SECRET`
    and `CP_PROXY_SECRET` (it used to fall back to a public session secret and non-Secure cookies);
  - a managed instance refuses to start with the E2E suite's test-only public key;
  - `ip-address` 10.7.4 (GHSA-rxp7-6hxx-x8q5) in the console server, `vite` 8.3.5 in the console client.
