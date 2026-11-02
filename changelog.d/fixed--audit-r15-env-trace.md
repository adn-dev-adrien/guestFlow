- **The server suite now traces what the app reads from the environment** (spec `server-test-isolation.md`
  rule 13, review of #927). Under `npm test`, each test process runs with `process.env` behind a recording
  Proxy; at the end the runner fails when code of `server/src/` read a variable that `appEnvNames.js` does not
  list, naming the line and the test files, and prints the lines that took the environment whole. It sees the
  forms rule 12's grep guard knowingly misses, but only where the suite runs that code against the real
  environment: not through a copy of it, not in a function the tests only call with an injected `env`, not on
  a path no test runs. About 1 % of the suite's time. Tests only: one server test file added.
