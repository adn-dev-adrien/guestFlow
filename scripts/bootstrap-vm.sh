#!/usr/bin/env bash
#
# One-shot migration of a GuestFlow host to the self-updatable layout
# (specs/self-update-and-releases.md §4.6).
#
# Run it ONCE on the production machine, as the user that owns ~/guestflow and the PM2 daemon —
# never as root. It is idempotent: re-running it on an already-migrated host changes nothing.
#
#   ssh <user>@<host>
#   bash ~/guestflow/current/scripts/bootstrap-vm.sh        # or scp this file over
#
# Before:                          After:
#   ~/guestflow/current/  (dir)      ~/guestflow/current -> releases/<version>
#                                    ~/guestflow/releases/<version>/
#                                    ~/guestflow/ecosystem.config.js
#                                    ~/guestflow/logs/
#   ~/guestflow/data/     (kept, never touched — database, .env.local, backups)
#
# The symlink is what makes the swap atomic and the rollback instant; the ecosystem file is what
# makes a restart independent of any CI environment.

set -euo pipefail

ROOT="${GUESTFLOW_ROOT:-$HOME/guestflow}"
APP_NAME="${GUESTFLOW_PM2_NAME:-guestflow}"

# Defaults mirror what the retired deploy workflow passed to `pm2 start`. Override by exporting the
# variable before running, e.g. `HTTPS_ENABLED=true bash bootstrap-vm.sh`.
NODE_ENV_VALUE="${NODE_ENV:-production}"
HTTPS_ENABLED_VALUE="${HTTPS_ENABLED:-false}"
TRUST_PROXY_HOPS_VALUE="${TRUST_PROXY_HOPS:-1}"
PORT_VALUE="${PORT:-4000}"

say() { printf '  %s\n' "$*"; }

if [ "$(id -u)" = "0" ]; then
  echo "Refusing to run as root: PM2 and ~/guestflow belong to the application user." >&2
  exit 1
fi

echo "GuestFlow — migration vers la mise à jour intégrée"
echo "Racine : $ROOT"

if [ ! -d "$ROOT" ]; then
  echo "Introuvable : $ROOT. Rien à migrer." >&2
  exit 1
fi

mkdir -p "$ROOT/releases" "$ROOT/logs" "$ROOT/data/backups"
chmod 700 "$ROOT/data/backups" 2>/dev/null || true

# ── 1. current/ : directory → releases/<version> + symlink ───────────────────────────────────
if [ -L "$ROOT/current" ]; then
  say "✓ current est déjà un lien symbolique ($(readlink "$ROOT/current"))"
elif [ -d "$ROOT/current" ]; then
  VERSION="$(node -p "require('$ROOT/current/package.json').version" 2>/dev/null || echo '')"
  if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    say "⚠ version illisible dans current/package.json — utilisation de 0.0.0"
    VERSION="0.0.0"
  fi
  TARGET="$ROOT/releases/$VERSION"
  if [ -e "$TARGET" ]; then
    say "⚠ $TARGET existe déjà — conservé, current/ archivé en current.pre-bootstrap"
    mv "$ROOT/current" "$ROOT/current.pre-bootstrap"
  else
    say "→ déplacement de current/ vers releases/$VERSION"
    mv "$ROOT/current" "$TARGET"
  fi
  ln -sfn "$TARGET" "$ROOT/current"
  say "✓ current -> releases/$VERSION"
else
  echo "Aucun déploiement dans $ROOT/current : installez d'abord une version." >&2
  exit 1
fi

# ── 2. Le lien .env.local et la base restent dans data/ ──────────────────────────────────────
# Ils y sont déjà (le workflow de déploiement les y avait mis) ; on ne fait que rétablir les liens
# dans la release courante, au cas où le déplacement les aurait laissés en fichiers réguliers.
RELEASE_DIR="$(readlink -f "$ROOT/current")"
if [ -f "$ROOT/data/.env.local" ]; then
  ln -sfn "$ROOT/data/.env.local" "$RELEASE_DIR/server/.env.local"
  say "✓ .env.local lié depuis data/"
fi
if [ -f "$ROOT/data/guestflow.db" ]; then
  ln -sfn "$ROOT/data/guestflow.db" "$RELEASE_DIR/server/guestflow.db"
  say "✓ base liée depuis data/"
fi

# ── 3. ecosystem.config.js : la définition PM2, versionnée sur l'hôte ────────────────────────
# `cwd` pointe sur le lien symbolique et non sur la release : PM2 le résout au démarrage, donc un
# simple `startOrRestart` après bascule lance bien la NOUVELLE version.
if [ -f "$ROOT/ecosystem.config.js" ]; then
  say "✓ ecosystem.config.js déjà présent (laissé tel quel)"
else
  cat > "$ROOT/ecosystem.config.js" <<ECOSYSTEM
// GuestFlow — définition du process PM2 (specs/self-update-and-releases.md §4.6).
//
// Écrit une seule fois par scripts/bootstrap-vm.sh, puis maintenu à la main sur l'hôte.
// Le moteur de mise à jour ne le modifie jamais : il se contente de faire pointer le lien
// « current » sur la nouvelle release puis de lancer
//   pm2 startOrRestart ecosystem.config.js --update-env
//
// « cwd » vise le LIEN, pas la release : PM2 le résout au démarrage, donc le redémarrage suivant
// une bascule lance bien le nouveau code.
module.exports = {
  apps: [
    {
      name: '${APP_NAME}',
      cwd: '${ROOT}/current/server',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: '${NODE_ENV_VALUE}',
        PORT: '${PORT_VALUE}',
        // Derrière Caddy : l'application ne sert pas son propre TLS mais doit compter le hop.
        HTTPS_ENABLED: '${HTTPS_ENABLED_VALUE}',
        TRUST_PROXY_HOPS: '${TRUST_PROXY_HOPS_VALUE}',
        DB_PATH: '${ROOT}/data/guestflow.db',
        SKIP_MIGRATIONS: 'false',
        // Racine du déploiement, lue par le moteur de mise à jour.
        GUESTFLOW_DEPLOY_ROOT: '${ROOT}',
      },
    },
  ],
};
ECOSYSTEM
  say "✓ ecosystem.config.js créé"
fi

# ── 4. Ré-enregistrement PM2 depuis le fichier ecosystem ─────────────────────────────────────
if command -v pm2 >/dev/null 2>&1; then
  say "→ (ré)enregistrement du process PM2 depuis ecosystem.config.js"
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  pm2 start "$ROOT/ecosystem.config.js" --update-env
  pm2 save
  say "✓ PM2 relancé depuis la définition persistante"
else
  say "⚠ pm2 introuvable : installez-le puis lancez « pm2 start $ROOT/ecosystem.config.js && pm2 save »"
fi

cat <<'NEXT'

Migration terminée.

Il reste à faire, une seule fois, pour refermer la faille :
  1. Désinstaller le runner GitHub Actions de cette machine :
       cd ~/actions-runner && sudo ./svc.sh stop && sudo ./svc.sh uninstall && ./config.sh remove
  2. Supprimer le runner et son jeton dans GitHub :
       Settings → Actions → Runners → (ce runner) → Remove
  3. Vérifier dans l'application : Réglages → Système et mises à jour
     doit afficher la version installée et proposer « Vérifier maintenant ».
NEXT
