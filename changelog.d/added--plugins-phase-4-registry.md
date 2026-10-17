- **Plugins as packages, a signed registry, install and update from the Plugins page** (spec
  `plugins-phase-4-registry.md`, phase 4 of `plugins-inventory.md`). Each of the twelve plugins has a
  manifest and its own version, and is built into a package (`<id>-<version>.tgz`, server code + its
  own ES module) shipped in the release archive under `plugins-dist/`. A release loads every plugin
  from its package — the client bundle no longer contains any plugin code, and a plugin that is not
  installed costs nothing. The control plane gains a « Registre » page and serves a signed index;
  an instance with `GUESTFLOW_REGISTRY_URL` offers the newer versions it publishes. The Plugins page
  shows each version, a « Mise à jour x.y.z » chip with the changelog lines, « Tout mettre à jour »,
  refusals in plain French, an « Incompatible avec cette version » state and a 7-day rollback. An
  update restarts the instance (PM2). Release tooling: `scripts/build-plugin-packages.mjs`,
  `scripts/check-plugin-versions.mjs` (the `verify` job), `plugin:<id>` changelog bullets folded into
  the manifests. A production-build E2E suite (`npm run test:e2e:prod`) runs in CI.
- **Plugin packages, after review** (spec `plugins-phase-4-registry.md` rules 26–32): a plugin bundle
  uses the app's own MUI (its icons keep the GuestFlow theme) and the app loads only the MUI parts
  plugins use; plugin files are cached by content hash; a pull request that changes a plugin bumps its
  version and writes its French changelog lines in the manifest (CI checks it), so the release PR never
  edits a manifest; installs take the update lock and are all-or-nothing; a replayed registry index is
  refused; writes under `/api` from another site are refused (403); the rollback asks first and the
  restart wait gives up after 90 s with « Réessayer ».
