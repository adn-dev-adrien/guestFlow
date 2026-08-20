- **Versioned releases.** Pushing the tag `vX.Y.Z` on `master` builds and publishes a GitHub release
  — archive, checksums and the WordPress plugin — from a GitHub-hosted runner. The workflow refuses
  to publish unless the tag, the three `package.json` versions and the `CHANGELOG.md` section agree,
  and unless the server, client and end-to-end suites are green. The new `/guestflow-release` skill
  drives the whole sequence. (specs/self-update-and-releases.md)
