- **The server-suite guard on app variables also sees an `env` taken whole** (spec `server-test-isolation.md`
  rule 12, reading of 2026-11-02, audit R14 L-1). The test that keeps `appEnvNames.js` equal to what `server/src/`
  reads now fails on `const { X } = env`, `'X' in env`, `{ ...env }`, `const e = env`, an `env` handed to a call
  whose callee does not name that parameter `env` (`Object.keys(env)`, `read(env)`), and `require('process').env`
  / `require('node:process').env`. The few existing uses, whose `env` is a plugin-range context or the Neat
  environment, are pinned by count with their reason. Since the review of #924 it also fails on `e = env || {}` /
  `e = env ?? {}`, on an `env` returned whole (`return env`, `=> env`, `f().env.X`), and on a call argument whose
  callee only shares its name with a function declaring `env` elsewhere: the callee is now the one the call reaches
  (the file's own function, or the one of the module it is imported from). The names only a plugin reads are keyed
  by plugin id (`PLUGIN_ENV_NAMES`), so the plugin removal matrix no longer turns this test red in 5 of its 16
  cells. Tests only: one server test added, 22 new probe forms.
