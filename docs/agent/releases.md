# Releases and production updates

_Moved out of `CLAUDE.md` to keep the always-loaded context small; `CLAUDE.md` keeps the short rule and links here._

Production runs **published releases**, never a branch. The full model lives in
`specs/hosting/self-update-and-releases.md`; the operating rules:

- **`X.Y.Z` has a defined meaning** (`specs/hosting/self-update-and-releases.md` §3.A rule 2), and the skill
  derives the number from it: **X** = a structural change or a contract lost for a consumer outside
  this repository (`/public/v1/**` for the WordPress plugin, the iCal export feeds) — never derived,
  always the user's explicit call; **Y** = an improvement, the ordinary case; **Z** = bug fixes and
  nothing else. A change to `/api/**` is not an X: client and server ship in one archive and install
  together, so no consumer can lag behind them.
- **Claude squash-merges the release PR, and only the release PR** (granted 2026-08-22). The
  authorisation is narrow on purpose: it covers a `release: vX.Y.Z` PR that the release skill itself
  opened in the current run, on a `release/vX.Y.Z` branch, containing nothing but the three version
  bumps and the changelog fold. Every other PR in this repository stays the user's to merge. The
  merge is **squash**, and it happens **only once every check reports `pass`** — re-read immediately
  before merging, never trusted from an earlier look. `--admin` is forbidden: bypassing a pending or
  failing check is exactly what this authorisation is not.
- A release is cut with the **`/guestflow-release` skill**: pre-flight suites → fold `changelog.d/`
  into a `CHANGELOG.md` section → write the operator digest → bump the three `package.json` files →
  `release/vX.Y.Z` PR → the user squash-merges → Claude tags `vX.Y.Z` on `master` →
  `.github/workflows/release.yml` publishes the archive, its `SHA256SUMS` and the WordPress plugin.
  Since 2026-08-22 the skill merges that PR itself once the CI is green, so a release runs end to
  end from a single request; never end a release turn asking to be told the PR was merged.
- **The release notes are mandatory.** The GitHub release body IS the `CHANGELOG.md` section, and
  that section is what the operator reads in the update dialog before clicking "Installer". The
  `verify` job fails the release when it is missing, when the three versions disagree with the tag,
  or when a `changelog.d/` fragment was left unfolded. Never bypass that job.
- **Every section opens with its operator digest** — a `### Summary` block of at most 6 lines of at
  most 160 characters, and it is the *only* thing the update dialog shows; the rest is folded behind
  « Tout le changelog » (`specs/hosting/self-update-and-releases.md` rule 20c). It is written **in French**,
  the single exception to §2 in this repository, because it exists to be read inside the application
  by a French operator. `node scripts/build-changelog.mjs --check-digest X.Y.Z` judges it, and the
  `verify` job runs that same command.
- **Publishing is not deploying.** GuestFlow polls GitHub hourly and offers the version; the
  operator installs it from Réglages → Système et mises à jour. Claude never triggers an install,
  and never SSHes into production to "finish" a release.
- **Never re-introduce a self-hosted CI runner.** The repository is public and the production host
  holds the guest database, the encryption key and the session secret; a runner there is arbitrary
  code execution from GitHub into the LAN. Production makes outbound calls only. Any PR adding
  `runs-on: self-hosted` to this repository is a security regression, whatever it automates.
- The only sanctioned force-push in this repository is `git push --force origin vX.Y.Z` to re-point
  a **tag** after a failed `verify`. §5.2's ban on force-pushing branches stands.

---
