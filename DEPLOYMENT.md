# Deployment and operations runbook

This guide documents production startup and release checks. It does not claim that external error monitoring or automated backups are provisioned by this repository; configure those in your hosting platform.

## Supported runtime and build

- Node.js 26.8.2 or newer patch releases within Node 26 only (the server rejects Node 27+).
- npm 11.19.x.
- Install from lockfiles with npm ci; do not use npm install in CI or production deploys.
- Production backend entry point: npm start after npm run build.
- GET /api/health is the liveness endpoint; GET /api/health/ready checks database readiness.

~~~bash
cd server
npm ci
npm run build
npm test
npm run test:integration
npm start
~~~

In another terminal, verify both health endpoints with curl against localhost:4000. Production mode requires NODE_ENV=production, a unique ADMIN_JWT_SECRET of at least 32 characters, a non-default ADMIN_PASSWORD, and the exact public frontend origin in CORS_ORIGIN. Set PORT and DATABASE_PATH to host-provided values. Do not expose the API without HTTPS termination at a trusted platform proxy or reverse proxy.

## Environment variable inventory

| Variable | Purpose | Production guidance |
| --- | --- | --- |
| NODE_ENV | Runtime mode | Set to production |
| PORT | HTTP listen port | Use the host-assigned port |
| DATABASE_PATH | SQLite file path | Use persistent storage, not ephemeral deploy storage |
| CORS_ORIGIN | Allowed browser origin | Exact HTTPS frontend origin; no wildcard |
| ADMIN_JWT_SECRET | Signs admin access tokens | Unique random secret, 32+ characters |
| ADMIN_USERNAME / ADMIN_PASSWORD | Initial admin account | Unique username and strong password |
| RPC_ETHEREUM | Ethereum JSON-RPC URL | Treat key-bearing URLs as secrets |
| RPC_SEPOLIA | Sepolia JSON-RPC URL | Use a provider with appropriate quota |
| RPC_ARBITRUM | Arbitrum JSON-RPC URL | Use a provider with appropriate quota |
| RPC_BASE | Base JSON-RPC URL | Use a provider with appropriate quota |
| GITHUB_TOKEN | Higher GitHub API quota for public repo analysis | Optional; store as a secret |
| MAX_ZIP_MB | Upload size limit | Keep within service memory budget |
| BILLING_WEBHOOK_SECRET | Optional webhook HMAC secret | Leave unset to disable webhook processing |

SESSION_SECRET appears in the example environment file for compatibility; it does not replace ADMIN_JWT_SECRET.

## Persistence, restarts, and schema changes

SQLite is a single-file database using WAL mode. The app creates the database parent directory, but the storage volume must be persistent and mounted before startup. An ephemeral filesystem can lose analyses, users, watchlists, and organizations on restart or redeploy.

The current database setup creates missing tables and applies additive ALTER TABLE ADD COLUMN changes at startup. It is not a versioned migration framework. Before a release that changes the schema:

1. Stop writes or put the service into maintenance mode.
2. Create a consistent SQLite backup using SQLite's online backup API/tool, or stop the service and back up the database and WAL state consistently. Do not copy only the live database file while writes are active.
3. Verify the backup by restoring it to a separate path and running the readiness check.
4. Deploy, inspect startup logs, and retain the backup until post-deploy verification passes.

Example offline backup while the API is stopped:

~~~bash
sqlite3 /var/data/tdm.sqlite ".backup '/var/backups/tdm-backup.sqlite'"
~~~

Automate encrypted off-host backups and periodic restore drills in the hosting platform. A persistent disk is not a backup.

## HTTPS, CORS, secrets, logging, and monitoring

- Terminate HTTPS at the hosting platform or a maintained reverse proxy. Redirect HTTP to HTTPS there. Do not enable Express proxy-trust settings unless the trusted proxy chain is configured.
- Limit CORS to the frontend origin and update it when the frontend domain changes.
- Put RPC, GitHub, admin, and billing credentials in the platform secret store. Rotate exposed credentials; never commit .env files or tokens.
- The API writes startup and unexpected-error messages to stdout/stderr. Collect logs centrally and alert on repeated 5xx responses, startup crashes, readiness failures, and sustained provider errors.
- This repository does not ship an external error-monitoring SDK or managed alert destination. Configure these in the host before considering production error monitoring active.
- Monitor disk capacity, backup success, HTTP 429/5xx rates, latency, and RPC provider quotas. Never log authorization headers, passwords, tokens, or full secret-bearing URLs.

## RPC provider and rate-limit verification

CI is deterministic and does not depend on third-party RPC uptime. Before release, configure each intended RPC URL in staging and verify its returned chain ID. Keep secret-bearing URLs out of logs and issue reports.

~~~bash
curl -fsS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  "$RPC_URL"
~~~

Expected chain IDs: Ethereum 0x1, Sepolia 0xaa36a7, Arbitrum One 0xa4b1, Base 0x2105. Also exercise a known deployed contract read in staging; eth_chainId alone does not prove trace-method support. Test provider rate limits using the provider's documented quota or a controlled staging load test; do not overload public endpoints.

## Pull-request merge gate

The GitHub Actions workflow runs backend build/self-tests/integration tests, Playwright smoke and full browser journeys, and frontend build on pull requests. To make GitHub block merges when CI fails, repository administrators must enable branch protection/rulesets for main and mark the required CI job/check as required. A workflow alone does not enforce merge blocking when branch protection is disabled.

Keep PR checks green before merging; inspect Playwright diagnostics artifacts if a browser job fails.
