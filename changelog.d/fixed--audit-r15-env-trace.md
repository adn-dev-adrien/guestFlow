- **The server suite now traces what the app reads from the environment** (spec `server-test-isolation.md`
  rule 13, review of #927). Under `npm test`, each test process runs with `process.env` behind a recording
  Proxy; at the end the runner fails when code of `server/src/` read a variable that `appEnvNames.js` does not
  list, naming the line and the test files, and prints the lines that took the environment whole. It catches
  every syntax the grep guard of rule 12 can miss, on the code the suite runs, for about 1 % of the suite's
  time. Tests only: one server test file added.
