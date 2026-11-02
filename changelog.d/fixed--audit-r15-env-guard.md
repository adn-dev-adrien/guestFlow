- **The server-suite guard on app variables also sees an `env` as a ternary branch and `process` handed whole to
  a call** (spec `server-test-isolation.md` rule 12, reading of 2026-11-02, audit R15 L-1). The test that keeps
  `appEnvNames.js` equal to what `server/src/` reads now fails on `x ? env : {}` / `x ? {} : env`, on
  `read(process)`, and on a call whose callee shares its name with a nested function declaring `env`: the callee
  is now the declaration of the innermost block around the call. The spec no longer says the guard « fails open
  in one case »: it is a heuristic that catches the probed forms, and the forms it knowingly lets through are
  listed. No new hit or pin in `server/src/`. Tests only: 5 new probe forms, 3 new quiet forms.
