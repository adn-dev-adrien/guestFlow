- **The self-hosted CI runner and the `release` deployment branch are gone.** A push on `release`
  used to run a workflow on a GitHub Actions runner installed on the production machine — an agent
  executing code from a public repository, on the host that holds the guest database, the encryption
  key and the session secret. Production now only makes outbound calls to GitHub and installs a
  release when its operator asks for it. (specs/self-update-and-releases.md §1.2)
