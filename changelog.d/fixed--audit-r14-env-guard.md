- **The server-suite guard on app variables also sees an `env` taken whole** (spec `server-test-isolation.md`
  rule 12, reading of 2026-11-02, audit R14 L-1). The test that keeps `appEnvNames.js` equal to what `server/src/`
  reads now fails on `const { X } = env`, `'X' in env`, `{ ...env }`, `const e = env`, an `env` handed to a call
  whose callee does not name that parameter `env` (`Object.keys(env)`, `read(env)`), and `require('process').env`
  / `require('node:process').env`. The few existing uses, whose `env` is a plugin-range context or the Neat
  environment, are pinned by count with their reason. Tests only, no server test added (12 new probe forms).
