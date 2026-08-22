---
name: guestflow-release
description: |
  Cuts a new GuestFlow release. Use when:
  - the user asks to "release", "publish", "tag", "faire une release", "publier une version"
  Derives the version, runs the pre-flight suites, folds the changelog, writes the operator digest,
  opens the release PR, waits for the merge on its own, tags, and watches the workflow.
disable-model-invocation: true
argument-hint: "[version] (e.g. 1.2.0 — omit it and the skill derives it)"
---

# GuestFlow release workflow

Release version: $ARGUMENTS

**A release runs end to end from one request.** The user asks, and next hears from you when the
release is published. Version number, suites, changelog, digest, PR, **merge**, tag, workflow: all
yours. Do not stop to ask for confirmation between steps; §11 lists the only situations that justify
stopping.

**The merge authorisation is narrow, and step 6 is where it is spent.** It covers the release PR of
the run you are in, and nothing else in this repository — read §6 before using it.

`master` is the release branch, so a release is a **PR merge followed by a tag on master**. Never
push the version bump straight to master (CLAUDE.md §5.2).

**Publishing a release does NOT deploy it.** The archive sits on the GitHub release until the
operator installs it from Réglages → Système et mises à jour. Never SSH into the production host to
"finish" a release.

---

## Step 1 — Settle the version

If `$ARGUMENTS` carries a strict semver (`1.2.0`, `1.1.1` — no `v`, no suffix), use it.

Otherwise **derive it and say which one you took** — do not ask.

```bash
ls changelog.d/*.md | grep -v README        # the pending fragments
node -p "require('./package.json').version" # the current version
```

### What each digit means

`X.Y.Z` is not three counters. Each digit answers a different question
(specs/self-update-and-releases.md §3.A rule 2):

| | Meaning | Derived from |
|---|---|---|
| **X** — major | A structural change, or a **contract lost or broken for someone outside this repository**. | **Never derived — the user's explicit call.** |
| **Y** — minor | An **improvement**: a feature, a behaviour change, a migration, a removal nobody outside depends on. | Any `added--`, `changed--`, `removed--` or `migration--` fragment. |
| **Z** — patch | **Bug fixes only.** One non-fix in the lot and it is not a patch. | `fixed--` fragments, and nothing else. |

So: `fixed--` only → bump **Z**. Anything else in the lot → bump **Y**. Never bump **X** on your own.

### The one check the fragment categories cannot make

A category tells you what a change *is*, not who it *breaks*. Before settling on Y, ask whether the
lot removes or reshapes a surface that something outside this repository calls on its own schedule:

- `server/src/routes/public/**` (`/public/v1/…`) — the **WordPress plugin** calls these;
- the **iCal export** feeds — the booking platforms read these;
- `/public/v1/plugin-update` — the plugin's own updater polls it.

If it does, that is an **X**, whatever the fragment says, and X is the user's call: stop and ask via
`AskUserQuestion`.

`/api/**` is *not* such a surface. The client and the server ship in one archive and install
together, so an internal endpoint has no consumer that can lag behind it. The question is never « did
a signature change? » but « who updates on a different schedule than we do? ».

Ask as well when the fragments genuinely contradict the rule — a `fixed--` lot that nonetheless
changes behaviour on existing installations is a Y wearing a Z's clothes.

> **CHECK**: the version is strict semver, strictly greater than the current one, and its digit
> matches the table above.

---

## Step 2 — Pre-flight

```bash
git checkout master && git pull
git status --porcelain
```

**Tracked** modifications (`M`, `A`, `D`, `R`) → stop and ask (CLAUDE.md §5.4). Never stash.
**Untracked** files (`??`) do not block a release — the archive is built from a clean CI checkout —
but list them in the final report so they are not forgotten.

Watch for a parallel session: this repository is often open in more than one Claude session, and a
`git checkout` here yanks the branch out from under the other one. If the tree is on a feature
branch with uncommitted work, that is someone else's session — stop and ask before switching.

Then run everything the release workflow will run, because a red suite discovered by CI *after* the
tag costs a forced re-tag:

```bash
cd server && npm test && cd ..
cd client && npm test && npm run build && cd ..
npm run test:e2e
```

The E2E suite needs ports 3000/4000. Free them without asking (`npm run stop`), then **restart
`npm run dev` in the background afterwards** if it was running — and say so, since the suite wipes
the dev database on the way through.

> **CHECK**: up-to-date master, no tracked change, server + client + build + E2E green.

---

## Step 3 — Changelog and digest (MANDATORY)

The GitHub release body IS the CHANGELOG section, and the operator reads it in the update dialog
before clicking « Installer ». No section, no release.

```bash
node scripts/build-changelog.mjs                  # preview the pending fragments
node scripts/build-changelog.mjs --release X.Y.Z   # fold them into a dated section
```

Then do the two pieces of writing this step exists for.

**3a — the sections, in English.** Read what came out and fix it: it is prose for an operator, not a
commit dump. Every bullet says what changed for the user. Fragments are sometimes drafted in French;
translate them, because `## [2.0.0]` onwards is English and a section that mixes the two reads as an
accident. If the section is empty there is nothing to release — stop and say so.

**3b — the digest, in French.** `--release` scaffolds a `### Summary` block holding a TODO. Replace
it (specs/self-update-and-releases.md rule 20c):

- **French**, unlike the rest of the file — it is the one block written to be read inside the
  application, under the French heading « En bref », by a French operator;
- at most **6 lines**, each at most **160 characters**, each a single sentence;
- one line per thing that changes *for the operator* — not per commit, not per spec;
- a migration that changes behaviour on existing installations earns a line, always;
- the heading stays the English `### Summary`: the parser keys off it.

```bash
node scripts/build-changelog.mjs --check-digest X.Y.Z
```

That command is the same rule the release workflow's `verify` job applies. It failing here means the
release would have failed there.

> **CHECK**: `CHANGELOG.md` has `## [X.Y.Z] - YYYY-MM-DD` opening on a written `### Summary`,
> `--check-digest` passes, and `changelog.d/` holds only `README.md`.

---

## Step 4 — Version bump

The three files must agree, or `verify` fails the release:

- `package.json` (the one the running app reads — the source of truth)
- `server/package.json`
- `client/package.json`

Bump the WordPress plugin **only if it changed** since the last release:

```bash
git diff v<previous>..HEAD --stat -- integrations/wordpress/guestflow-booking
```

If it did, bump `Version:` in the header AND `GF_BOOKING_VERSION` AND `Stable tag` in `readme.txt`
(all three must match), and say which version you chose in the report.

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

Stage explicit paths only, never `git add -A` (CLAUDE.md §5.1). The PR body carries what ships, the
digest **verbatim as the operator will read it**, and the four suite results from step 2.

Then wait for the PR's own CI before handing it over — a PR you know is red is not ready to review:

```bash
gh pr checks <n> --watch --interval 20
```

Give the user the URL so they can read what is about to ship — for information, not for action: you
merge it yourself at step 6. Say so, and say the release will carry on without them.

> **CHECK**: PR created, its checks green, URL handed over.

---

## Step 6 — Merge it yourself, green first

CLAUDE.md §5.2 forbids merging PRs. §5.6 carves out exactly one exception, granted 2026-08-22, and
this step is it.

**What the authorisation covers**, and nothing beyond:

- the `release: vX.Y.Z` PR **this run** opened, on its `release/vX.Y.Z` branch,
- containing nothing but the three version bumps and the changelog fold,
- merged with `--squash`,
- **only once every check reports `pass`**.

Any other PR in this repository — including a fix you had to make to unblock this release — is still
the user's to merge. If you find yourself reaching for `gh pr merge` on anything else, stop.

**Re-read the checks immediately before merging.** A green result from step 5 is a memory, not a
fact: a check can be re-run, a branch can be updated, a required check can be added. Ask again.

```bash
gh pr checks <n> --json bucket -q '[.[] | select(.bucket != "pass")] | length'   # must print 0
gh pr view <n> --json state,mergeable,mergeStateStatus \
  -q '.state + " " + .mergeable + " " + .mergeStateStatus'                        # OPEN MERGEABLE CLEAN
gh pr merge <n> --squash --delete-branch
```

`--admin` is **forbidden**. It bypasses branch protection, which is to say it bypasses the one
condition this authorisation was given under. A check that is pending is not a check that passed: if
the count is anything but `0`, wait for it, and if it is red, stop and tell the user (§11).

If the PR is already `CLOSED` when you get here, the user declined the release: say so and stop.

> **CHECK**: `gh pr view <n> --json state` reads `MERGED`, and every check was `pass` before you
> ran the merge.

---

## Step 7 — Tag the merged commit

```bash
git checkout master && git pull
git log -1 --oneline                          # must be the release commit
node -p "require('./package.json').version"   # must be X.Y.Z
git tag vX.Y.Z
git push origin vX.Y.Z
```

Verify by **content**, never by ancestry: the user squash-merges, so the branch's commits are never
ancestors of master and `git branch --merged` lies (CLAUDE.md §5.5). The version reading X.Y.Z on
master is the proof.

Tag the commit **on master**, never the branch-side commit.

> **CHECK**: `git ls-remote --tags origin | grep vX.Y.Z` returns the tag.

---

## Step 8 — Watch the release workflow

```bash
gh run list --workflow=Release --limit 3
gh run watch <run-id> --interval 20 --exit-status
gh run view <run-id> --log-failed    # if it fails
```

Job order: `verify` → (`tests` ‖ `e2e`) → `package` → `publish`.

Recovery when `verify` fails (missing changelog section, missing or over-long digest, version
mismatch): fix on master through a normal PR, then re-point the tag:

```bash
git tag -f vX.Y.Z && git push --force origin vX.Y.Z
```

That force-push is on a **tag**, and is the one exception to the never-force-push rule — the
CLAUDE.md §5.2 ban on force-pushing branches still stands.

> **CHECK**: the workflow is green and `gh release view vX.Y.Z` lists three assets:
> `guestflow-X.Y.Z.tar.gz`, `SHA256SUMS`, `guestflow-booking-<v>.zip`.

---

## Step 9 — Report

```
Release vX.Y.Z publiée :
- https://github.com/adn-dev-adrien/guestFlow/releases/tag/vX.Y.Z
- Archive : guestflow-X.Y.Z.tar.gz (+ SHA256SUMS)
- Plugin WordPress : <version ou « inchangé »>

En bref (ce que tu liras dans la fenêtre de mise à jour) :
<the digest, verbatim>

La production ne se met PAS à jour toute seule : l'application proposera la version dans l'heure
(ou tout de suite via Réglages → Système et mises à jour → Vérifier maintenant).
```

Add any migration that changes behaviour on an existing installation, and the untracked files seen
at step 2.

> **CHECK**: the user has the release URL, the digest, and knows the install is theirs to trigger.

---

## Step 10 — Clean up

```bash
git checkout master && git pull
```

The release branch is deleted by GitHub on merge. Restart the dev server if step 2 stopped one.

---

## Step 11 — When to stop and ask

Only these. Everything else you decide and report.

| Situation | Why it is not yours to decide |
|---|---|
| Tracked modifications in the working tree | They are someone's unfinished work — possibly another session's |
| A suite is red at step 2 | A release is not the moment to debug; the user chooses to fix or defer |
| The fragments contradict the version rule | A behaviour change hiding in a `fixed--` lot is a judgement call |
| The lot breaks or drops a `/public/v1/**` endpoint, an iCal feed or the plugin contract | That is a major, and a major is never derived |
| The WordPress plugin changed | Its version is independent; the user picks it |
| The release PR's CI is not green | The merge authorisation is granted on a green CI and on nothing else |
| The release PR was closed before you merged it | The user declined |
| Any PR that is not this run's release PR needs merging | The authorisation is that narrow (CLAUDE.md §5.2) |
| `verify` fails for a reason a normal PR cannot fix | Re-pointing a tag past a structural problem hides it |
| A major version | Always the user's explicit call |
