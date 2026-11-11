# Real-host check of the hosting

A throwaway reconstruction of the production host (specs/hosting-h1-fleet-runtime.md, runbook in
`../README.md`), to prove what unit tests cannot: systemd sandboxing, Caddy, Litestream 0.3.13 and
rclone against an S3 endpoint, and the isolation between instances.

| File | Role |
|---|---|
| `Dockerfile` | Debian 12 with systemd as PID 1 |
| `docker-compose.yml` | the host (privileged, host cgroups) and SeaweedFS's S3 gateway (`s3:9000`, keys in `s3.json`) |
| `run.sh` | bundles the committed branch, starts both, runs `inside.sh`, removes everything (`KEEP=1` keeps it) |
| `inside.sh` | `bootstrap-host.sh` exactly as the runbook says (`GUESTFLOW_TEST_LOCAL_CERTS=1`: Caddy's own CA), then the lab's environment, release 9.0.0, the operator, the console |
| `scenarios.js` | every scenario through the console's API behind Caddy, checked on the host; one PASS/FAIL line each |
| `weekly.js` | the weekly restore check, run now |

Requirements: Docker with privileged containers (Colima or Docker Desktop), network access for apt,
NodeSource, Caddy's repository and the Litestream release. About 6 minutes. Never in CI.
