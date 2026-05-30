# server/certs/

Holds the self-signed TLS cert + key for production HTTPS. **The actual cert / key files are
gitignored** — every environment generates its own via:

```bash
./server/scripts/generate-self-signed-cert.sh
```

Files written here:
- `server.crt` — public certificate (PEM)
- `server.key` — private key (PEM, mode 0600)

In production, the GitHub Actions deploy workflow runs the script automatically on the
Raspberry Pi if no cert exists yet, and stores the result in `~/guestflow/certs/` (persistent
across deploys, **not** under `current/`). The runtime points at the persistent location via
`TLS_CERT_PATH` and `TLS_KEY_PATH` set in the PM2 env. See `.github/workflows/deploy.yml`
and the README §HTTPS for the full setup.

In dev, the same script writes to this folder by default — invoke it manually only if you want
to test the HTTPS code path locally; the dev server stays on plain HTTP by default
(`HTTPS_ENABLED` unset).
