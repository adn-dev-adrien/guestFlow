- **Deployment layout (production hosts only).** `~/guestflow/current/` becomes a symbolic link into
  `~/guestflow/releases/<version>/`, and the PM2 environment moves into a persistent
  `~/guestflow/ecosystem.config.js`. Run `bash ~/guestflow/current/scripts/bootstrap-vm.sh` once on
  the host, as the user that owns the deployment; it never touches `data/`. Until it has run, the
  app reports that it cannot update itself and says why. The GitHub Actions runner must then be
  uninstalled from the host — the script prints the commands.
