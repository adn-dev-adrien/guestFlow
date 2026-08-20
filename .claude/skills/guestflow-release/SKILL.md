---
name: guestflow-release
description: |
  Cuts a new GuestFlow release. Use when:
  - the user asks to "release", "publish", "tag", "faire une release", "publier une version"
  Pre-flight checks, changelog fold, version bump via PR, tag on master, CI monitoring.
disable-model-invocation: true
argument-hint: "<version> (e.g. 1.2.0, 1.1.1)"
---

# GuestFlow release workflow

Release version: $ARGUMENTS

Follow EVERY step IN ORDER. Each has a CHECK — verify it before moving on.

`master` is the release branch; a release is therefore a **PR merge followed by a tag on master**.
Never push the version bump straight to master (CLAUDE.md §5.2).

**Publishing a release does NOT deploy it.** The archive sits on the GitHub release until the
operator installs it from the app (Réglages → Système et mises à jour). Never SSH into the
production host to "finish" a release.

---

## Step 1 — Validate the version

Parse `$ARGUMENTS`: it must be strict semver (`1.2.0`, `1.1.1` — no `v`, no suffix).

If no version was given, read the current one from `package.json`, propose the next patch and the
next minor, and **ask via `AskUserQuestion`** (CLAUDE.md §3.4). Rule of thumb:
- `patch` — fixes only,
- `minor` — any new feature or behaviour change,
- `major` — only on the user's explicit call.

> **CHECK**: the version is confirmed and strictly greater than the current one.

---

## Step 2 — Pre-flight

```bash
git checkout master && git pull
git status --porcelain          # must be empty
```

If the tree is dirty → **stop and ask** (CLAUDE.md §5.4). Never stash.

Then everything the release workflow will run, run it here first — a red suite discovered by CI
after the tag costs a forced re-tag:

```bash
cd server && npm test && cd ..
cd client && npm test && npm run build && cd ..
npm run test:e2e
```

The E2E suite needs ports 3000/4000 free; free them, then restore whatever was running.

> **CHECK**: on an up-to-date master, clean tree, server + client + E2E green.

---

## Step 3 — Changelog (MANDATORY)

The GitHub release body IS the CHANGELOG section, and that section is what the operator reads in the
update dialog before clicking "Installer". No section, no release.

```bash
node scripts/build-changelog.mjs                 # preview the pending fragments
node scripts/build-changelog.mjs --release X.Y.Z  # fold them into a dated section
```

Then **read the produced section** and fix it: it is user-facing French-to-English prose for an
operator, not a commit dump. Every bullet should say what changed for the user.

If the section comes out empty, there is nothing to release — stop and say so.

> **CHECK**: `CHANGELOG.md` has `## [X.Y.Z] - YYYY-MM-DD`, `changelog.d/` holds only `README.md`.

---

## Step 4 — Version bump

The three files must agree, or the `verify` job fails the release:

- `package.json` (the one the running app reads — the source of truth)
- `server/package.json`
- `client/package.json`

Bump the WordPress plugin **only if it changed** since the last release:

```bash
git diff v<previous>..HEAD --stat -- integrations/wordpress/guestflow-booking
```

If it did, bump `Version:` in the header AND `GF_BOOKING_VERSION` AND `Stable tag` in `readme.txt`
(they must match), then ask the user to confirm the plugin version.

> **CHECK**: `node -p "require('./package.json').version"` and both others print X.Y.Z.

---

## Step 5 — Release PR

```bash
git checkout -b release/vX.Y.Z
git add package.json server/package.json client/package.json CHANGELOG.md changelog.d
# plus the plugin files if it was bumped
git commit -m "release: vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --base master --title "release: vX.Y.Z" --body "..."
```

Hand the PR URL to the user and **STOP**. They squash-merge it. Never merge yourself.

> **CHECK**: PR created, URL given to the user.

---

## Step 6 — Tag the merged commit

Only after the user confirms the merge:

```bash
git checkout master && git pull
git log -1 --oneline            # must be the release commit
node -p "require('./package.json').version"   # must be X.Y.Z
git tag vX.Y.Z
git push origin vX.Y.Z
```

Tag the commit **on master**, never the branch-side commit.

> **CHECK**: `git ls-remote --tags origin | grep vX.Y.Z` returns the tag.

---

## Step 7 — Watch the release workflow

```bash
gh run list --workflow=Release --limit 3
gh run view <run-id> --log-failed    # if it fails
```

Job order: `verify` → (`tests` ‖ `e2e`) → `package` → `publish`.

Recovery when `verify` fails (missing changelog section, version mismatch): fix on master through a
normal PR, then re-point the tag:

```bash
git tag -f vX.Y.Z && git push --force origin vX.Y.Z
```

That force-push is on a **tag**, and is the one exception to the never-force-push rule — the
CLAUDE.md §5.2 ban on force-pushing branches still stands.

> **CHECK**: the workflow is green and `gh release view vX.Y.Z` lists three assets:
> `guestflow-X.Y.Z.tar.gz`, `SHA256SUMS`, `guestflow-booking-<v>.zip`.

---

## Step 8 — Report

```
Release vX.Y.Z publiée :
- https://github.com/adn-dev-adrien/guestFlow/releases/tag/vX.Y.Z
- Archive : guestflow-X.Y.Z.tar.gz (+ SHA256SUMS)
- Plugin WordPress : <version ou « inchangé »>

La production ne se met PAS à jour toute seule : l'application proposera la version dans l'heure
(ou tout de suite via Réglages → Système et mises à jour → Vérifier maintenant).
```

> **CHECK**: the user has the release URL and knows the install is theirs to trigger.
